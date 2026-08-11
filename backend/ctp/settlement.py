"""Settlement bill cache, parse, and analytics (no live CTP session)."""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime
from typing import Any

from ctp.config import load_config
from ctp.constants import (
    BEIJING,
    SETTLEMENT_CACHE_FILE,
    _MAX_RANGE_DAYS,
    _SETTLEMENT_CACHE_LOCK,
)
from ctp.state import _now, add_log

def _normalize_trading_day(day: str) -> str:
    """Accept 2026-08-04 / 20260804 / 202608 -> CTP TradingDay string."""
    s = (day or "").strip().replace("-", "").replace("/", "")
    if not re.fullmatch(r"\d{6}|\d{8}", s):
        raise CtpError("交易日格式应为 YYYYMMDD (日结算) 或 YYYYMM (月结算)")
    return s


def _normalize_ymd(day: str) -> str:
    """Normalize to YYYYMMDD only (range / cache keys)."""
    s = _normalize_trading_day(day)
    if len(s) != 8:
        raise CtpError("日期区间仅支持日结算 YYYYMMDD")
    return s


def _today_ymd() -> str:
    return datetime.now(BEIJING).strftime("%Y%m%d")


def _ymd_to_date(s: str):
    return datetime.strptime(s, "%Y%m%d").date()


def _fmt_display_day(ymd: str) -> str:
    return f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:8]}"


def _account_cache_id() -> str:
    cfg = load_config()
    if not cfg:
        return "_unknown"
    return f"{cfg.get('broker', '')}:{cfg.get('user', '')}"


def _load_settlement_store() -> dict[str, Any]:
    if not os.path.isfile(SETTLEMENT_CACHE_FILE):
        return {"accounts": {}}
    try:
        with open(SETTLEMENT_CACHE_FILE, encoding="utf-8-sig") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"accounts": {}}
        if "accounts" not in data or not isinstance(data["accounts"], dict):
            data["accounts"] = {}
        return data
    except (OSError, json.JSONDecodeError) as e:
        add_log(f"Settlement cache read fail: {e}", "warn")
        return {"accounts": {}}


def _save_settlement_store(store: dict[str, Any]) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = SETTLEMENT_CACHE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)
    os.replace(tmp, SETTLEMENT_CACHE_FILE)


def _get_cached_settlement(day: str) -> dict[str, Any] | None:
    with _SETTLEMENT_CACHE_LOCK:
        store = _load_settlement_store()
        acct = store["accounts"].get(_account_cache_id()) or {}
        days = acct.get("days") or {}
        rec = days.get(day)
        return dict(rec) if isinstance(rec, dict) else None


def _put_cached_settlement(day: str, record: dict[str, Any]) -> None:
    with _SETTLEMENT_CACHE_LOCK:
        store = _load_settlement_store()
        aid = _account_cache_id()
        acct = store["accounts"].setdefault(aid, {"days": {}})
        days = acct.setdefault("days", {})
        days[day] = record
        acct["updated"] = _now()
        _save_settlement_store(store)


def _iter_range_days(start: str, end: str) -> list[str]:
    """Inclusive calendar days; skip weekends (futures settle on trading days)."""
    a = _ymd_to_date(start)
    b = _ymd_to_date(end)
    if a > b:
        raise CtpError("开始日期不能晚于结束日期")
    if (b - a).days + 1 > _MAX_RANGE_DAYS:
        raise CtpError(f"日期跨度最多 {_MAX_RANGE_DAYS} 个自然日")
    out: list[str] = []
    cur = a
    while cur <= b:
        # 0=Mon ... 5=Sat 6=Sun
        if cur.weekday() < 5:
            out.append(cur.strftime("%Y%m%d"))
        cur += timedelta(days=1)
    return out


def _series_point(
    day: str, rec: dict[str, Any] | None, *, from_cache: bool, error: str | None = None
) -> dict[str, Any]:
    parsed = (rec or {}).get("parsed") or {}
    status = (rec or {}).get("status") or ("missing" if rec is None else "ok")
    if error:
        status = "error"
    return {
        "trading_day": day,
        "date": _fmt_display_day(day),
        "equity": parsed.get("equity"),
        "market_equity": parsed.get("market_equity"),
        "client_equity": parsed.get("client_equity"),
        "balance": parsed.get("balance"),
        "available": parsed.get("available"),
        "deposit_withdraw": parsed.get("deposit_withdraw"),
        "close_profit": parsed.get("close_profit"),
        "position_profit": parsed.get("position_profit"),
        "commission": parsed.get("commission"),
        "curr_margin": parsed.get("curr_margin"),
        "risk_ratio": parsed.get("risk_ratio"),
        "status": status,
        "from_cache": from_cache,
        "error": error,
        "updated": (rec or {}).get("updated"),
    }


def build_settlement_analytics(series: list[dict[str, Any]]) -> dict[str, Any]:
    """Derive NAV / returns / calendar from settlement equity series.

    Daily PnL strips net deposit/withdrawal:
      pnl_t = equity_t - equity_{t-1} - deposit_withdraw_t
      ret_t = pnl_t / equity_{t-1}
      nav_t = nav_{t-1} * (1 + ret_t)   (nav_0 = 1)
    """
    pts = [p for p in series if p.get("status") == "ok" and p.get("equity") is not None]
    pts = sorted(pts, key=lambda x: x["trading_day"])

    perf: list[dict[str, Any]] = []
    nav = 1.0
    cum_pnl = 0.0
    cum_income = 0.0
    total_commission = 0.0
    peak_nav = 1.0
    max_dd = 0.0
    win_days = 0
    loss_days = 0
    flat_days = 0
    best: dict[str, Any] | None = None
    worst: dict[str, Any] | None = None
    sum_ret = 0.0
    ret_count = 0
    total_deposit = 0.0

    for i, p in enumerate(pts):
        eq = float(p["equity"])
        dw = float(p.get("deposit_withdraw") or 0)
        # Prefer explicit commission; fall back to 0 when missing/null
        raw_comm = p.get("commission")
        comm = float(raw_comm) if raw_comm is not None else 0.0
        total_deposit += dw
        total_commission = round(total_commission + comm, 2)
        nav_before = nav
        if i == 0:
            daily_pnl = 0.0
            daily_ret = 0.0
        else:
            prev_eq = float(pts[i - 1]["equity"])
            daily_pnl = round(eq - prev_eq - dw, 2)
            daily_ret = (daily_pnl / prev_eq) if prev_eq else 0.0
            nav = nav_before * (1.0 + daily_ret)
            cum_pnl = round(cum_pnl + daily_pnl, 2)
            sum_ret += daily_ret
            ret_count += 1
            if daily_pnl > 1e-9:
                win_days += 1
            elif daily_pnl < -1e-9:
                loss_days += 1
            else:
                flat_days += 1
            row_cmp = {
                "date": p["date"],
                "trading_day": p["trading_day"],
                "daily_pnl": daily_pnl,
                "daily_return": daily_ret,
            }
            if best is None or daily_pnl > best["daily_pnl"]:
                best = row_cmp
            if worst is None or daily_pnl < worst["daily_pnl"]:
                worst = row_cmp

        # income = pnl - commission (calendar "收益")
        daily_income = round(daily_pnl - comm, 2)
        cum_income = round(cum_income + daily_income, 2)

        peak_nav = max(peak_nav, nav)
        dd = (nav / peak_nav - 1.0) if peak_nav > 0 else 0.0
        max_dd = min(max_dd, dd)
        cum_ret = nav - 1.0
        perf.append({
            "date": p["date"],
            "trading_day": p["trading_day"],
            "equity": eq,
            "deposit_withdraw": dw,
            "commission": round(comm, 2),
            "daily_pnl": daily_pnl,
            "daily_income": daily_income,
            "daily_return": round(daily_ret, 8),
            "cum_pnl": cum_pnl,
            "cum_pnl_wan": round(cum_pnl / 10000.0, 4),
            "cum_income": cum_income,
            "cum_income_wan": round(cum_income / 10000.0, 4),
            "cum_return": round(cum_ret, 8),
            "nav": round(nav, 8),
            "drawdown": round(dd, 8),
        })

    # Monthly rollup (return = product of daily factors in month)
    months: dict[str, dict[str, Any]] = {}
    for row in perf:
        ym = row["trading_day"][:6]
        m = months.setdefault(
            ym,
            {
                "month": f"{ym[:4]}-{ym[4:6]}",
                "trading_day_start": row["trading_day"],
                "trading_day_end": row["trading_day"],
                "pnl": 0.0,
                "income": 0.0,
                "deposit_withdraw": 0.0,
                "commission": 0.0,
                "days": 0,
                "win_days": 0,
                "loss_days": 0,
                "ret_factor": 1.0,
                "equity_start": row["equity"],
                "equity_end": row["equity"],
            },
        )
        m["trading_day_end"] = row["trading_day"]
        m["pnl"] = round(m["pnl"] + row["daily_pnl"], 2)
        m["income"] = round(m["income"] + float(row.get("daily_income") or 0), 2)
        m["deposit_withdraw"] = round(
            m["deposit_withdraw"] + row["deposit_withdraw"], 2
        )
        m["commission"] = round(m["commission"] + float(row.get("commission") or 0), 2)
        m["days"] += 1
        m["ret_factor"] *= 1.0 + float(row["daily_return"])
        m["equity_end"] = row["equity"]
        if row["daily_pnl"] > 1e-9:
            m["win_days"] += 1
        elif row["daily_pnl"] < -1e-9:
            m["loss_days"] += 1
    month_list = []
    for ym in sorted(months):
        m = months[ym]
        m["return"] = round(m.pop("ret_factor") - 1.0, 8)
        m["pnl_wan"] = round(m["pnl"] / 10000.0, 4)
        # Keep income consistent if series lacked the field
        if abs(float(m.get("income") or 0) - (m["pnl"] - m["commission"])) > 0.02:
            m["income"] = round(m["pnl"] - m["commission"], 2)
        month_list.append(m)

    n = len(perf)
    start_eq = perf[0]["equity"] if n else None
    end_eq = perf[-1]["equity"] if n else None
    avg_ret = (sum_ret / ret_count) if ret_count else 0.0
    # Annualize with 242 China futures trading days approx
    ann_ret = ((1.0 + avg_ret) ** 242 - 1.0) if ret_count else None
    # Simple vol / sharpe from daily returns (rf=0)
    if ret_count >= 2:
        mean = avg_ret
        var = sum((perf[i]["daily_return"] - mean) ** 2 for i in range(1, n)) / (
            ret_count - 1
        )
        std = var**0.5
        sharpe = (mean / std) * (242**0.5) if std > 1e-12 else None
    else:
        std = None
        sharpe = None

    summary = {
        "days": n,
        "start_date": perf[0]["date"] if n else None,
        "end_date": perf[-1]["date"] if n else None,
        "start_equity": start_eq,
        "end_equity": end_eq,
        "total_pnl": cum_pnl if n else 0.0,
        "total_pnl_wan": round(cum_pnl / 10000.0, 4) if n else 0.0,
        "total_income": cum_income if n else 0.0,
        "total_commission": total_commission if n else 0.0,
        "total_return": round(nav - 1.0, 8) if n else 0.0,
        "nav": round(nav, 8) if n else 1.0,
        "max_drawdown": round(max_dd, 8) if n else 0.0,
        "win_days": win_days,
        "loss_days": loss_days,
        "flat_days": flat_days,
        "win_rate": round(win_days / (win_days + loss_days), 4)
        if (win_days + loss_days)
        else None,
        "avg_daily_return": round(avg_ret, 8),
        "daily_volatility": round(std, 8) if std is not None else None,
        "ann_return": round(ann_ret, 8) if ann_ret is not None else None,
        "sharpe": round(sharpe, 4) if sharpe is not None else None,
        "best_day": best,
        "worst_day": worst,
        "total_deposit_withdraw": round(total_deposit, 2),
        "method": (
            "盈亏 pnl = Δequity - 出入金; "
            "收益 income = 盈亏 - 手续费; "
            "nav 复利; 年化按 242 交易日"
        ),
    }

    return {
        "perf": perf,
        "monthly": month_list,
        "calendar_daily": [
            {
                "date": r["date"],
                "trading_day": r["trading_day"],
                "pnl": r["daily_pnl"],
                "income": r["daily_income"],
                "return": r["daily_return"],
                "commission": float(r.get("commission") or 0.0),
                "equity": r["equity"],
            }
            for r in perf
        ],
        "summary": summary,
        "charts": {
            "equity": [{"date": r["date"], "value": r["equity"]} for r in perf],
            "nav": [{"date": r["date"], "value": r["nav"]} for r in perf],
            "cum_return": [
                {"date": r["date"], "value": round(r["cum_return"] * 100, 4)}
                for r in perf
            ],
            # 累计收益 chart uses income (pnl - commission), in 万元
            "cum_pnl_wan": [
                {"date": r["date"], "value": r["cum_income_wan"]} for r in perf
            ],
        },
    }


def _decode_settlement_chunk(raw: Any) -> str:
    """Copy+decode Content immediately (CTP may reuse the buffer)."""
    if raw is None:
        return ""
    if isinstance(raw, (bytes, bytearray)):
        for enc in ("gbk", "gb18030", "utf-8"):
            try:
                return bytes(raw).decode(enc)
            except UnicodeDecodeError:
                continue
        return bytes(raw).decode("gbk", errors="replace")
    s = str(raw)
    # Some bindings expose GBK bytes as latin-1 str
    if s and "权益" not in s and "结存" not in s and "Balance" not in s:
        try:
            return s.encode("latin1").decode("gbk")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return s


# Amount: "779151.49" or "779,151.49". Do NOT prefer \d{1,3} first -- that truncates
# 779151.49 to 779 when the bill has no thousand separators (common in CTP text).
_AMOUNT_RE = (
    r"([-+]?\d{1,3}(?:,\d{3})+\.\d+|[-+]?\d{1,3}(?:,\d{3})+|[-+]?\d+\.\d+|[-+]?\d+)"
)


def _settlement_summary_block(text: str) -> str:
    """Keep Account Summary only; trade/position tables also contain 平仓盈亏 etc."""
    if not text:
        return ""
    cut = len(text)
    for marker in (
        "成交记录",
        "Transaction Record",
        "持仓明细",
        "Positions Detail",
        "持仓汇总",
        "Positions\n",
        "Position Summary",
        "期权对冲",
    ):
        i = text.find(marker)
        if 0 < i < cut:
            cut = i
    return text[:cut]


def _pick_amount(text: str, labels: list[str]) -> float | None:
    for lab in labels:
        m = re.search(
            lab + r"[^\d\-+]{0,80}" + _AMOUNT_RE,
            text,
            flags=re.IGNORECASE,
        )
        if m:
            try:
                return round(float(m.group(1).replace(",", "")), 2)
            except ValueError:
                continue
    return None


def parse_settlement_text(content: str) -> dict[str, Any]:
    """Extract key equity figures from CTP settlement bill text."""
    text = _settlement_summary_block(content or "")
    fields = {
        "pre_balance": _pick_amount(text, [r"期初结存", r"Balance\s*B/F"]),
        "balance": _pick_amount(text, [r"期末结存", r"Balance\s*C/F"]),
        "client_equity": _pick_amount(text, [r"客户权益", r"Client\s*Equity"]),
        "market_equity": _pick_amount(
            text, [r"市值权益", r"Market\s*Value\s*\(\s*equity\s*\)"]
        ),
        "available": _pick_amount(text, [r"可用资金", r"Fund\s*Avail", r"Available"]),
        "deposit_withdraw": _pick_amount(
            text, [r"出\s*入\s*金", r"Deposit/Withdrawal", r"Deposit\s*/\s*Withdrawal"]
        ),
        "close_profit": _pick_amount(
            text, [r"平仓盈亏", r"Realized\s*P/L", r"Closed\s*P/L"]
        ),
        "position_profit": _pick_amount(text, [r"持仓盯市盈亏", r"MTM\s*P/L"]),
        # Prefer "手 续 费 Commission"; avoid matching 行权手续费 / 交割手续费 (often 0.00)
        "commission": _pick_amount(
            text,
            [
                r"手\s*续\s*费\s*Commission",
                r"(?<![权割])手\s*续\s*费",
                r"Commission",
            ],
        ),
        # Avoid matching 货币质押保证金占用 (often 0.00) before 保证金占用
        "curr_margin": _pick_amount(
            text, [r"(?<!货币质押)保证金占用", r"Margin\s*Occupied"]
        ),
        "risk_ratio": _pick_amount(text, [r"风险度", r"Risk\s*Degree"]),
        "option_long_value": _pick_amount(
            text, [r"多头期权市值", r"Market\s*Value\s*\(\s*long\s*\)"]
        ),
        "option_short_value": _pick_amount(
            text, [r"空头期权市值", r"Market\s*Value\s*\(\s*short\s*\)"]
        ),
    }
    # Prefer 市值权益 as the historical equity headline; fall back to 客户权益 / 期末结存
    equity = fields["market_equity"]
    if equity is None:
        equity = fields["client_equity"]
    if equity is None:
        equity = fields["balance"]
    fields["equity"] = equity
    return fields


def reparse_settlement_cache() -> dict[str, Any]:
    """Re-parse all cached settlement Content with the current parser (no CTP)."""
    with _SETTLEMENT_CACHE_LOCK:
        store = _load_settlement_store()
        fixed = 0
        scanned = 0
        for _aid, acct in (store.get("accounts") or {}).items():
            days = (acct or {}).get("days") or {}
            for day, rec in list(days.items()):
                if not isinstance(rec, dict):
                    continue
                scanned += 1
                content = rec.get("content") or ""
                if not content or rec.get("status") != "ok":
                    continue
                new_parsed = parse_settlement_text(content)
                old = rec.get("parsed") or {}
                if new_parsed != old:
                    rec["parsed"] = new_parsed
                    rec["reparsed"] = _now()
                    days[day] = rec
                    fixed += 1
        if fixed:
            _save_settlement_store(store)
        return {"scanned": scanned, "fixed": fixed, "cache_file": SETTLEMENT_CACHE_FILE}

