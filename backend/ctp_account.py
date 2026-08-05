"""CTP futures account -- session login + read-only position query.

User clicks Login in the Portfolio page; we connect only then.
Logs are kept in a ring buffer for the UI.

Credentials (never commit):
  1) env: CTP_HOST / CTP_BROKER / CTP_USER / CTP_PASSWORD / CTP_APPID / CTP_AUTHCODE
  2) or local file: ~/.vibe-research/ctp.json

Optional: pip install openctp-ctp
Never inserts or cancels orders.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from collections import deque
from datetime import datetime, timezone, timedelta
from typing import Any

BEIJING = timezone(timedelta(hours=8))
CACHE_DIR = os.environ.get("VR_DATA_DIR") or os.path.join(os.path.expanduser("~"), ".vibe-research")
CTP_CFG_FILE = os.path.join(CACHE_DIR, "ctp.json")
# CTP writes DialogRsp.con / Private.con / ... under this directory (not project root)
CTP_FLOW_DIR = os.path.join(CACHE_DIR, "ctp_flow")
# Local settlement bills (parsed equity + raw text), keyed by broker:user
SETTLEMENT_CACHE_FILE = os.path.join(CACHE_DIR, "ctp_settlements.json")

_QRY_GAP = 1.05
_DEFAULT_TIMEOUT = 45.0
_LOG_MAX = 300
# Calendar-day cap for range pull (CTP rate-limits ~1 qry/s)
_MAX_RANGE_DAYS = 120
_SETTLEMENT_CACHE_LOCK = threading.Lock()

_DIR_MAP = {"1": "净", "2": "多", "3": "空"}
_HEDGE_MAP = {"1": "投机", "2": "套利", "3": "套保", "4": "做市商"}
_POS_DATE_MAP = {"1": "今仓", "2": "昨仓"}
# Order / trade (buy-sell direction, different from position long/short)
_BS_MAP = {"0": "买", "1": "卖"}
# CTP ProductClass: 1 Futures, 2 Options, 6 SpotOption (char / str)
_OPTION_PRODUCT_CLASSES = {"2", "6"}
# Common CN option InstrumentID shapes: IO2509-C-4000 / m2509-C-3000 / SR509C5500
_OPTION_ID_RE = re.compile(r"(?:-[CP]-|[CP]\d{3,}|购|沽)", re.IGNORECASE)
_OFFSET_MAP = {
    "0": "开仓", "1": "平仓", "2": "强平", "3": "平今",
    "4": "平昨", "5": "强减", "6": "本地强平",
}
_ORDER_STATUS_MAP = {
    "0": "全部成交",
    "1": "部分成交队列中",
    "2": "部分成交已撤",
    "3": "未成交队列中",
    "4": "未成交已撤",
    "5": "撤单",
    "a": "未知",
    "b": "尚未触发",
    "c": "已触发",
}
_PRICE_TYPE_MAP = {
    "1": "任意价", "2": "限价", "3": "最优价", "4": "最新价",
    "5": "最新价浮动上浮1", "6": "最新价浮动上浮2", "7": "最新价浮动上浮3",
    "8": "卖一价", "9": "卖一价浮动上浮1", "A": "卖一价浮动上浮2",
    "B": "卖一价浮动上浮3", "C": "买一价", "D": "买一价浮动上浮1",
    "E": "买一价浮动上浮2", "F": "买一价浮动上浮3", "G": "五档价",
}
_TIME_COND_MAP = {
    "1": "IOC", "2": "GFS", "3": "GFD", "4": "GTD", "5": "GTC", "6": "GFA",
}
_VOL_COND_MAP = {"1": "任何数量", "2": "最小数量", "3": "全部数量"}
_SUBMIT_STATUS_MAP = {
    "0": "已经提交", "1": "撤单已经提交", "2": "修改已经提交",
    "3": "已经接受", "4": "报单已经被拒绝", "5": "撤单已经被拒绝",
    "6": "改单已经被拒绝",
}
_TRADE_TYPE_MAP = {
    "0": "普通成交", "1": "期权执行", "2": "OTC成交",
    "3": "期转现衍生成交", "4": "组合衍生成交",
}
_PRICE_SOURCE_MAP = {"0": "前成交价", "1": "买成交价", "2": "卖成交价", "3": "场外成交价"}
_TRADE_SOURCE_MAP = {"0": "来自交易所普通回报", "1": "来自查询"}

_lock = threading.RLock()          # protects session pointer / flags / log buffer
_op_lock = threading.Lock()        # serializes login / query / logout (never held in SPI)
# Async market-equity job (option instrument + tick qry is slow due to CTP rate limit)
_me_lock = threading.Lock()
_me_seq = 0
_me_state: dict[str, Any] = {
    "status": "idle",  # idle | pending | running | ready | error
    "seq": 0,
    "result": None,
    "error": None,
    "updated": None,
    "trading_day": "",
}
_logs: deque[dict[str, Any]] = deque(maxlen=_LOG_MAX)
_log_seq = 0
_session: Any = None  # CtpSession | None
_logging_in = False


class CtpError(Exception):
    """CTP config / dependency / runtime error."""


def _now() -> str:
    return datetime.now(BEIJING).strftime("%Y-%m-%d %H:%M:%S")


def _now_ms() -> str:
    return datetime.now(BEIJING).strftime("%H:%M:%S.%f")[:-3]


def add_log(message: str, level: str = "info") -> None:
    """Append a log line visible to the frontend."""
    global _log_seq
    with _lock:
        _log_seq += 1
        entry = {
            "id": _log_seq,
            "ts": _now_ms(),
            "level": level,
            "message": str(message),
        }
        _logs.append(entry)


def get_logs(since: int = 0) -> dict[str, Any]:
    """Return logs with id > since (or all if since=0 and buffer small)."""
    with _lock:
        items = [e for e in _logs if e["id"] > since]
        return {"logs": items, "next_since": _log_seq, "logged_in": _is_logged_in_unlocked()}


def clear_logs() -> None:
    with _lock:
        _logs.clear()


def load_config() -> dict[str, str] | None:
    env_keys = {
        "host": os.environ.get("CTP_HOST", "").strip(),
        "broker": os.environ.get("CTP_BROKER", "").strip(),
        "user": os.environ.get("CTP_USER", "").strip(),
        "password": os.environ.get("CTP_PASSWORD", "").strip(),
        "appid": os.environ.get("CTP_APPID", "").strip(),
        "authcode": os.environ.get("CTP_AUTHCODE", "").strip(),
    }
    if all(env_keys.values()):
        return env_keys

    try:
        with open(CTP_CFG_FILE, encoding="utf-8-sig") as f:
            raw = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        raw = {}

    cfg = {
        "host": (env_keys["host"] or str(raw.get("host", ""))).strip(),
        "broker": (env_keys["broker"] or str(raw.get("broker", ""))).strip(),
        "user": (env_keys["user"] or str(raw.get("user", ""))).strip(),
        "password": (env_keys["password"] or str(raw.get("password", ""))).strip(),
        "appid": (env_keys["appid"] or str(raw.get("appid", ""))).strip(),
        "authcode": (env_keys["authcode"] or str(raw.get("authcode", ""))).strip(),
    }
    if not all(cfg.values()):
        return None
    return cfg


def _mask_user(user: str) -> str:
    return user[:2] + "***" + user[-2:] if len(user) > 4 else "***"


def _is_logged_in_unlocked() -> bool:
    return _session is not None and getattr(_session, "ready", False)


def config_status() -> dict[str, Any]:
    cfg = load_config()
    try:
        import openctp_ctp  # noqa: F401
        dep_ok = True
        dep_msg = ""
    except ImportError:
        dep_ok = False
        dep_msg = "未安装 openctp-ctp, 请执行: pip install openctp-ctp"

    with _lock:
        logged_in = _is_logged_in_unlocked()
        logging_in = _logging_in
        trading_day = getattr(_session, "trading_day", "") if _session else ""
        user_masked = _mask_user(cfg["user"]) if cfg else ""

    return {
        "configured": cfg is not None,
        "dependency_ok": dep_ok,
        "dependency_msg": dep_msg,
        "config_path": CTP_CFG_FILE,
        "user_masked": user_masked,
        "ready": cfg is not None and dep_ok,
        "logged_in": logged_in,
        "logging_in": logging_in,
        "trading_day": trading_day,
        "host": (cfg or {}).get("host", ""),
    }


def _field(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    return getattr(obj, name, default)


def _fnum(obj: Any, name: str, nd: int = 2) -> float:
    return round(float(_field(obj, name, 0) or 0), nd)


def _pos_row(p: Any) -> dict[str, Any]:
    direction = str(_field(p, "PosiDirection", "") or "")
    hedge = str(_field(p, "HedgeFlag", "") or "")
    pos_date = str(_field(p, "PositionDate", "") or "")
    position = float(_field(p, "Position", 0) or 0)
    open_cost = float(_field(p, "OpenCost", 0) or 0)
    position_cost = float(_field(p, "PositionCost", 0) or 0)
    # OpenCost / Position = price * volume_multiple (no multiplier in this field set)
    cost_per_lot = round(open_cost / position, 4) if position else 0.0
    return {
        "exchange": str(_field(p, "ExchangeID", "") or ""),
        "instrument": str(_field(p, "InstrumentID", "") or ""),
        "direction": _DIR_MAP.get(direction, direction),
        "direction_code": direction,
        "hedge": _HEDGE_MAP.get(hedge, hedge),
        "position_date": _POS_DATE_MAP.get(pos_date, pos_date),
        "position": position,
        "yd_position": float(_field(p, "YdPosition", 0) or 0),
        "today_position": float(_field(p, "TodayPosition", 0) or 0),
        "open_volume": float(_field(p, "OpenVolume", 0) or 0),
        "close_volume": float(_field(p, "CloseVolume", 0) or 0),
        "open_amount": _fnum(p, "OpenAmount"),
        "close_amount": _fnum(p, "CloseAmount"),
        "open_cost": round(open_cost, 2),
        "position_cost": round(position_cost, 2),
        "cost_per_lot": cost_per_lot,
        "use_margin": _fnum(p, "UseMargin"),
        "exchange_margin": _fnum(p, "ExchangeMargin"),
        "frozen_margin": _fnum(p, "FrozenMargin"),
        "frozen_cash": _fnum(p, "FrozenCash"),
        "frozen_commission": _fnum(p, "FrozenCommission"),
        "long_frozen": float(_field(p, "LongFrozen", 0) or 0),
        "short_frozen": float(_field(p, "ShortFrozen", 0) or 0),
        "close_profit": _fnum(p, "CloseProfit"),
        "close_profit_by_date": _fnum(p, "CloseProfitByDate"),
        "close_profit_by_trade": _fnum(p, "CloseProfitByTrade"),
        "position_profit": _fnum(p, "PositionProfit"),
        "settlement_price": float(_field(p, "SettlementPrice", 0) or 0),
        "pre_settlement_price": float(_field(p, "PreSettlementPrice", 0) or 0),
        "margin_rate_by_money": float(_field(p, "MarginRateByMoney", 0) or 0),
        "margin_rate_by_volume": float(_field(p, "MarginRateByVolume", 0) or 0),
        "commission": _fnum(p, "Commission"),
        "cash_in": _fnum(p, "CashIn"),
        "trading_day": str(_field(p, "TradingDay", "") or ""),
    }


def _account_row(a: Any) -> dict[str, Any]:
    balance = float(_field(a, "Balance", 0) or 0)
    curr_margin = float(_field(a, "CurrMargin", 0) or 0)
    risk_ratio = round(curr_margin / balance * 100, 2) if balance else 0.0
    return {
        "balance": round(balance, 2),
        # Balance is treated as 客户权益 / 动态权益 for live account
        "client_equity": round(balance, 2),
        "available": _fnum(a, "Available"),
        "curr_margin": round(curr_margin, 2),
        "exchange_margin": _fnum(a, "ExchangeMargin"),
        "frozen_margin": _fnum(a, "FrozenMargin"),
        "frozen_cash": _fnum(a, "FrozenCash"),
        "frozen_commission": _fnum(a, "FrozenCommission"),
        "pre_balance": _fnum(a, "PreBalance"),
        "pre_margin": _fnum(a, "PreMargin"),
        "deposit": _fnum(a, "Deposit"),
        "withdraw": _fnum(a, "Withdraw"),
        "withdraw_quota": _fnum(a, "WithdrawQuota"),
        "close_profit": _fnum(a, "CloseProfit"),
        "position_profit": _fnum(a, "PositionProfit"),
        "commission": _fnum(a, "Commission"),
        "credit": _fnum(a, "Credit"),
        "mortgage": _fnum(a, "Mortgage"),
        "cash_in": _fnum(a, "CashIn"),
        "interest": _fnum(a, "Interest"),
        "delivery_margin": _fnum(a, "DeliveryMargin"),
        "risk_ratio": risk_ratio,
        "currency": str(_field(a, "CurrencyID", "") or "CNY"),
        "trading_day": str(_field(a, "TradingDay", "") or ""),
        "account_id": str(_field(a, "AccountID", "") or ""),
    }


def _looks_like_option_id(instrument: str) -> bool:
    return bool(instrument and _OPTION_ID_RE.search(instrument))


def _is_option_meta(meta: dict[str, Any] | None, instrument: str) -> bool:
    if meta:
        pc = str(meta.get("product_class") or "").strip()
        if pc in _OPTION_PRODUCT_CLASSES:
            return True
        # Some builds return letter codes
        if pc.upper() in ("OPTIONS", "SPOTOPTION", "O"):
            return True
    return _looks_like_option_id(instrument)


def _sanitize_price(raw: Any) -> float:
    """CTP uses huge sentinels for empty prices."""
    try:
        v = float(raw or 0)
    except (TypeError, ValueError):
        return 0.0
    if v <= 0 or v > 1e15:
        return 0.0
    return v


def compute_market_equity(
    account: dict[str, Any],
    positions: list[dict[str, Any]],
    instruments: dict[str, dict[str, Any]],
    ticks: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """市值权益 = 客户权益 + 多头期权市值 - 空头期权市值.

    Option market value ≈ LastPrice * Position * VolumeMultiple.
    Price fallback: tick last -> position settlement_price.
    """
    client = float(account.get("client_equity") or account.get("balance") or 0)
    long_v = 0.0
    short_v = 0.0
    used = 0
    missing_px: list[str] = []
    for p in positions:
        inst = str(p.get("instrument") or "")
        if not inst:
            continue
        meta = instruments.get(inst)
        if not _is_option_meta(meta, inst):
            continue
        lots = float(p.get("position") or 0)
        if lots <= 0:
            continue
        mult = float((meta or {}).get("volume_multiple") or 0)
        if mult <= 0:
            # Derive mult from OpenCost / (cost_per_lot path): cost_per_lot ≈ open * mult
            # Without open price, fall back to 1 (wrong for most options) -- skip if unknown
            missing_px.append(f"{inst}:no_mult")
            continue
        tick = ticks.get(inst) or {}
        px = _sanitize_price(tick.get("last_price"))
        if px <= 0:
            px = _sanitize_price(p.get("settlement_price"))
        if px <= 0:
            missing_px.append(inst)
            continue
        mv = px * lots * mult
        used += 1
        # PosiDirection: 2 long / 3 short (mapped to 多/空)
        if p.get("direction") == "多" or str(p.get("direction_code") or "") == "2":
            long_v += mv
        else:
            short_v += mv

    long_v = round(long_v, 2)
    short_v = round(short_v, 2)
    market = round(client + long_v - short_v, 2)
    return {
        "client_equity": round(client, 2),
        "option_long_value": long_v,
        "option_short_value": short_v,
        "market_equity": market,
        "market_equity_method": "客户权益 + 多头期权市值 - 空头期权市值",
        "option_legs": used,
        "option_price_missing": missing_px[:12],
    }


def _offset_label(raw: Any) -> str:
    s = str(raw or "")
    # CombOffsetFlag is often a string whose first char is the flag
    code = s[:1] if s else ""
    return _OFFSET_MAP.get(code, code or "-")


def _order_row(o: Any) -> dict[str, Any]:
    direction = str(_field(o, "Direction", "") or "")
    status = str(_field(o, "OrderStatus", "") or "")
    price_type = str(_field(o, "OrderPriceType", "") or "")
    time_cond = str(_field(o, "TimeCondition", "") or "")
    vol_cond = str(_field(o, "VolumeCondition", "") or "")
    submit = str(_field(o, "OrderSubmitStatus", "") or "")
    insert_date = str(_field(o, "InsertDate", "") or "")
    insert_time = str(_field(o, "InsertTime", "") or "")
    return {
        "exchange": str(_field(o, "ExchangeID", "") or ""),
        "instrument": str(_field(o, "InstrumentID", "") or ""),
        "direction": _BS_MAP.get(direction, direction),
        "direction_code": direction,
        "offset": _offset_label(_field(o, "CombOffsetFlag", "")),
        "hedge": _HEDGE_MAP.get(str(_field(o, "CombHedgeFlag", "") or "")[:1], str(_field(o, "CombHedgeFlag", "") or "")),
        "price_type": _PRICE_TYPE_MAP.get(price_type, price_type),
        "limit_price": float(_field(o, "LimitPrice", 0) or 0),
        "stop_price": float(_field(o, "StopPrice", 0) or 0),
        "volume_total": float(_field(o, "VolumeTotalOriginal", 0) or 0),
        "volume_traded": float(_field(o, "VolumeTraded", 0) or 0),
        "volume_left": float(_field(o, "VolumeTotal", 0) or 0),
        "min_volume": float(_field(o, "MinVolume", 0) or 0),
        "time_condition": _TIME_COND_MAP.get(time_cond, time_cond),
        "volume_condition": _VOL_COND_MAP.get(vol_cond, vol_cond),
        "status": _ORDER_STATUS_MAP.get(status, status),
        "status_code": status,
        "submit_status": _SUBMIT_STATUS_MAP.get(submit, submit),
        "status_msg": str(_field(o, "StatusMsg", "") or ""),
        "order_sys_id": str(_field(o, "OrderSysID", "") or "").strip(),
        "order_ref": str(_field(o, "OrderRef", "") or ""),
        "order_local_id": str(_field(o, "OrderLocalID", "") or "").strip(),
        "broker_order_seq": int(_field(o, "BrokerOrderSeq", 0) or 0),
        "insert_time": f"{insert_date} {insert_time}".strip(),
        "update_time": str(_field(o, "UpdateTime", "") or ""),
        "cancel_time": str(_field(o, "CancelTime", "") or ""),
        "active_time": str(_field(o, "ActiveTime", "") or ""),
        "trading_day": str(_field(o, "TradingDay", "") or ""),
        "front_id": int(_field(o, "FrontID", 0) or 0),
        "session_id": int(_field(o, "SessionID", 0) or 0),
        "force_close_reason": str(_field(o, "ForceCloseReason", "") or ""),
        "user_force_close": bool(_field(o, "UserForceClose", 0)),
        "is_swap_order": bool(_field(o, "IsSwapOrder", 0)),
    }


def _trade_row(t: Any) -> dict[str, Any]:
    direction = str(_field(t, "Direction", "") or "")
    offset = str(_field(t, "OffsetFlag", "") or "")
    trade_type = str(_field(t, "TradeType", "") or "")
    price_src = str(_field(t, "PriceSource", "") or "")
    trade_src = str(_field(t, "TradeSource", "") or "")
    trade_date = str(_field(t, "TradeDate", "") or "")
    trade_time = str(_field(t, "TradeTime", "") or "")
    price = float(_field(t, "Price", 0) or 0)
    volume = float(_field(t, "Volume", 0) or 0)
    return {
        "exchange": str(_field(t, "ExchangeID", "") or ""),
        "instrument": str(_field(t, "InstrumentID", "") or ""),
        "exchange_inst_id": str(_field(t, "ExchangeInstID", "") or ""),
        "direction": _BS_MAP.get(direction, direction),
        "direction_code": direction,
        "offset": _OFFSET_MAP.get(offset, offset),
        "hedge": _HEDGE_MAP.get(str(_field(t, "HedgeFlag", "") or ""), str(_field(t, "HedgeFlag", "") or "")),
        "price": price,
        "volume": volume,
        "amount": round(price * volume, 2),
        "trade_id": str(_field(t, "TradeID", "") or "").strip(),
        "order_sys_id": str(_field(t, "OrderSysID", "") or "").strip(),
        "order_ref": str(_field(t, "OrderRef", "") or ""),
        "order_local_id": str(_field(t, "OrderLocalID", "") or "").strip(),
        "broker_order_seq": int(_field(t, "BrokerOrderSeq", 0) or 0),
        "trade_type": _TRADE_TYPE_MAP.get(trade_type, trade_type),
        "price_source": _PRICE_SOURCE_MAP.get(price_src, price_src),
        "trade_source": _TRADE_SOURCE_MAP.get(trade_src, trade_src),
        "trade_time": f"{trade_date} {trade_time}".strip(),
        "trading_day": str(_field(t, "TradingDay", "") or ""),
        "sequence_no": int(_field(t, "SequenceNo", 0) or 0),
    }


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


def _series_point(day: str, rec: dict[str, Any] | None, *, from_cache: bool, error: str | None = None) -> dict[str, Any]:
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
    pts = [
        p for p in series
        if p.get("status") == "ok" and p.get("equity") is not None
    ]
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
        m = months.setdefault(ym, {
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
        })
        m["trading_day_end"] = row["trading_day"]
        m["pnl"] = round(m["pnl"] + row["daily_pnl"], 2)
        m["income"] = round(m["income"] + float(row.get("daily_income") or 0), 2)
        m["deposit_withdraw"] = round(m["deposit_withdraw"] + row["deposit_withdraw"], 2)
        m["commission"] = round(m["commission"] + float(row.get("commission") or 0), 2)
        m["days"] += 1
        m["ret_factor"] *= (1.0 + float(row["daily_return"]))
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
        var = sum((perf[i]["daily_return"] - mean) ** 2 for i in range(1, n)) / (ret_count - 1)
        std = var ** 0.5
        sharpe = (mean / std) * (242 ** 0.5) if std > 1e-12 else None
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
        "win_rate": round(win_days / (win_days + loss_days), 4) if (win_days + loss_days) else None,
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
            "cum_return": [{"date": r["date"], "value": round(r["cum_return"] * 100, 4)} for r in perf],
            # 累计收益 chart uses income (pnl - commission), in 万元
            "cum_pnl_wan": [{"date": r["date"], "value": r["cum_income_wan"]} for r in perf],
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
_AMOUNT_RE = r"([-+]?\d{1,3}(?:,\d{3})+\.\d+|[-+]?\d{1,3}(?:,\d{3})+|[-+]?\d+\.\d+|[-+]?\d+)"


def _settlement_summary_block(text: str) -> str:
    """Keep Account Summary only; trade/position tables also contain 平仓盈亏 etc."""
    if not text:
        return ""
    cut = len(text)
    for marker in (
        "成交记录", "Transaction Record",
        "持仓明细", "Positions Detail",
        "持仓汇总", "Positions\n",
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
        "market_equity": _pick_amount(text, [r"市值权益", r"Market\s*Value\s*\(\s*equity\s*\)"]),
        "available": _pick_amount(text, [r"可用资金", r"Fund\s*Avail", r"Available"]),
        "deposit_withdraw": _pick_amount(text, [r"出\s*入\s*金", r"Deposit/Withdrawal", r"Deposit\s*/\s*Withdrawal"]),
        "close_profit": _pick_amount(text, [r"平仓盈亏", r"Realized\s*P/L", r"Closed\s*P/L"]),
        "position_profit": _pick_amount(text, [r"持仓盯市盈亏", r"MTM\s*P/L"]),
        # Prefer "手 续 费 Commission"; avoid matching 行权手续费 / 交割手续费 (often 0.00)
        "commission": _pick_amount(text, [
            r"手\s*续\s*费\s*Commission",
            r"(?<![权割])手\s*续\s*费",
            r"Commission",
        ]),
        # Avoid matching 货币质押保证金占用 (often 0.00) before 保证金占用
        "curr_margin": _pick_amount(text, [r"(?<!货币质押)保证金占用", r"Margin\s*Occupied"]),
        "risk_ratio": _pick_amount(text, [r"风险度", r"Risk\s*Degree"]),
        "option_long_value": _pick_amount(text, [r"多头期权市值", r"Market\s*Value\s*\(\s*long\s*\)"]),
        "option_short_value": _pick_amount(text, [r"空头期权市值", r"Market\s*Value\s*\(\s*short\s*\)"]),
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


def _detail_row(d: Any) -> dict[str, Any]:
    """Investor position detail (per open lot) -- has CloseProfitByTrade."""
    direction = str(_field(d, "Direction", "") or "")
    hedge = str(_field(d, "HedgeFlag", "") or "")
    trade_type = str(_field(d, "TradeType", "") or "")
    volume = float(_field(d, "Volume", 0) or 0)
    close_volume = float(_field(d, "CloseVolume", 0) or 0)
    open_price = float(_field(d, "OpenPrice", 0) or 0)
    return {
        "exchange": str(_field(d, "ExchangeID", "") or ""),
        "instrument": str(_field(d, "InstrumentID", "") or ""),
        "comb_instrument": str(_field(d, "CombInstrumentID", "") or ""),
        "direction": _BS_MAP.get(direction, direction),
        "direction_code": direction,
        "hedge": _HEDGE_MAP.get(hedge, hedge),
        "open_date": str(_field(d, "OpenDate", "") or ""),
        "trade_id": str(_field(d, "TradeID", "") or "").strip(),
        "trade_type": _TRADE_TYPE_MAP.get(trade_type, trade_type),
        "open_price": open_price,
        "volume": volume,
        "close_volume": close_volume,
        "close_amount": _fnum(d, "CloseAmount"),
        "close_profit_by_date": _fnum(d, "CloseProfitByDate"),
        "close_profit_by_trade": _fnum(d, "CloseProfitByTrade"),
        "position_profit_by_date": _fnum(d, "PositionProfitByDate"),
        "position_profit_by_trade": _fnum(d, "PositionProfitByTrade"),
        "margin": _fnum(d, "Margin"),
        "exch_margin": _fnum(d, "ExchMargin"),
        "margin_rate_by_money": float(_field(d, "MarginRateByMoney", 0) or 0),
        "margin_rate_by_volume": float(_field(d, "MarginRateByVolume", 0) or 0),
        "last_settlement_price": float(_field(d, "LastSettlementPrice", 0) or 0),
        "settlement_price": float(_field(d, "SettlementPrice", 0) or 0),
        "time_first_volume": float(_field(d, "TimeFirstVolume", 0) or 0),
        "trading_day": str(_field(d, "TradingDay", "") or ""),
    }


def _build_session(tdapi: Any, cfg: dict[str, str]):
    """SPI that stays connected after login until logout()."""

    class CtpSession(tdapi.CThostFtdcTraderSpi):
        def __init__(self) -> None:
            super().__init__()
            self.cfg = cfg
            self.trading_day = ""
            self.ready = False
            self.error: str | None = None
            self.logged_in_ev = threading.Event()
            self.settlement_done = threading.Event()
            self.account_done = threading.Event()
            self.position_done = threading.Event()
            self.order_done = threading.Event()
            self.trade_done = threading.Event()
            self.detail_done = threading.Event()
            self.settlement_qry_done = threading.Event()
            self.instrument_done = threading.Event()
            self.tick_done = threading.Event()
            self.account: dict[str, Any] | None = None
            self.positions: list[dict[str, Any]] = []
            self.orders: list[dict[str, Any]] = []
            self.trades: list[dict[str, Any]] = []
            self.details: list[dict[str, Any]] = []
            self._settlement_chunks: list[tuple[int, str]] = []
            self._instrument_buf: dict[str, dict[str, Any]] = {}
            self._tick_buf: dict[str, dict[str, Any]] = {}
            self._qry_error: str | None = None

            os.makedirs(CTP_FLOW_DIR, exist_ok=True)
            # Trailing sep => CTP creates DialogRsp.con etc. inside the folder
            flow = CTP_FLOW_DIR + os.sep
            self.api = tdapi.CThostFtdcTraderApi.CreateFtdcTraderApi(flow)
            self.api.RegisterSpi(self)
            self.api.RegisterFront(cfg["host"])
            self.api.SubscribePrivateTopic(tdapi.THOST_TERT_QUICK)
            self.api.SubscribePublicTopic(tdapi.THOST_TERT_QUICK)
            add_log(f"FlowPath {CTP_FLOW_DIR}")
            add_log(f"RegisterFront {cfg['host']}")

        def _fail_login(self, msg: str) -> None:
            self.error = msg
            self.ready = False
            add_log(msg, "error")
            self.logged_in_ev.set()

        def OnFrontConnected(self):
            add_log("OnFrontConnected")
            try:
                req = tdapi.CThostFtdcReqAuthenticateField()
                req.BrokerID = self.cfg["broker"]
                req.UserID = self.cfg["user"]
                req.AppID = self.cfg["appid"]
                req.AuthCode = self.cfg["authcode"]
                add_log(f"ReqAuthenticate user={_mask_user(self.cfg['user'])} appid={self.cfg['appid']}")
                self.api.ReqAuthenticate(req, 0)
            except Exception as e:  # noqa: BLE001
                self._fail_login(f"认证请求异常: {e}")

        def OnFrontDisconnected(self, nReason: int):
            add_log(f"OnFrontDisconnected nReason={nReason}", "warn")
            self.ready = False
            if not self.logged_in_ev.is_set():
                self._fail_login(f"前置断开 nReason={nReason}")

        def OnRspAuthenticate(self, pRspAuthenticateField, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo and pRspInfo.ErrorID != 0:
                    self._fail_login(f"认证失败: {pRspInfo.ErrorMsg}")
                    return
                add_log("Authenticate succeed")
                req = tdapi.CThostFtdcReqUserLoginField()
                req.BrokerID = self.cfg["broker"]
                req.UserID = self.cfg["user"]
                req.Password = self.cfg["password"]
                req.UserProductInfo = "vr"
                add_log("ReqUserLogin ...")
                self.api.ReqUserLogin(req, 0)
            except Exception as e:  # noqa: BLE001
                self._fail_login(f"登录请求异常: {e}")

        def OnRspUserLogin(self, pRspUserLogin, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._fail_login(f"登录失败: {pRspInfo.ErrorMsg}")
                    return
                if pRspUserLogin is not None:
                    self.trading_day = str(pRspUserLogin.TradingDay or "")
                    add_log(
                        f"Login succeed TradingDay={self.trading_day} "
                        f"FrontID={pRspUserLogin.FrontID} SessionID={pRspUserLogin.SessionID}"
                    )
                if bIsLast:
                    self.ready = True
                    self.logged_in_ev.set()
            except Exception as e:  # noqa: BLE001
                self._fail_login(f"登录回调异常: {e}")

        def OnRspSettlementInfoConfirm(self, pSettlementInfoConfirm, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    add_log(f"Settlement confirm warn: {pRspInfo.ErrorMsg}", "warn")
                elif bIsLast:
                    add_log("Settlement confirmed")
            finally:
                if bIsLast:
                    self.settlement_done.set()

        def OnRspQryTradingAccount(self, pTradingAccount, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查资金失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pTradingAccount is not None:
                    self.account = _account_row(pTradingAccount)
                    add_log(
                        f"Account Balance={self.account['balance']} "
                        f"Available={self.account['available']} "
                        f"Margin={self.account['curr_margin']}"
                    )
            finally:
                if bIsLast:
                    self.account_done.set()

        def OnRspQryInvestorPosition(self, pInvestorPosition, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查持仓失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pInvestorPosition is not None:
                    row = _pos_row(pInvestorPosition)
                    if row["position"] or row["yd_position"] or row["today_position"]:
                        self.positions.append(row)
                        add_log(
                            f"Position {row['instrument']} {row['direction']} "
                            f"{row['position']}手 margin={row['use_margin']}"
                        )
            finally:
                if bIsLast:
                    self.position_done.set()

        def OnRspQryOrder(self, pOrder, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查委托失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pOrder is not None:
                    row = _order_row(pOrder)
                    self.orders.append(row)
                    add_log(
                        f"Order {row['instrument']} {row['direction']}{row['offset']} "
                        f"{row['volume_traded']}/{row['volume_total']} @ {row['limit_price']} "
                        f"{row['status']}"
                    )
            finally:
                if bIsLast:
                    self.order_done.set()

        def OnRspQryTrade(self, pTrade, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查成交失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pTrade is not None:
                    row = _trade_row(pTrade)
                    self.trades.append(row)
                    add_log(
                        f"Trade {row['instrument']} {row['direction']}{row['offset']} "
                        f"{row['volume']}手 @ {row['price']}"
                    )
            finally:
                if bIsLast:
                    self.trade_done.set()

        def OnRspQryInvestorPositionDetail(self, pInvestorPositionDetail, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查持仓明细失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pInvestorPositionDetail is not None:
                    row = _detail_row(pInvestorPositionDetail)
                    if row["volume"] or row["close_volume"]:
                        self.details.append(row)
                        add_log(
                            f"Detail {row['instrument']} {row['direction']} "
                            f"open={row['open_price']} vol={row['volume']} "
                            f"closePnL={row['close_profit_by_trade']} "
                            f"posPnL={row['position_profit_by_trade']}"
                        )
            finally:
                if bIsLast:
                    self.detail_done.set()

        def OnRspQrySettlementInfo(self, pSettlementInfo, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查结算单失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pSettlementInfo is not None:
                    seq = int(_field(pSettlementInfo, "SequenceNo", 0) or 0)
                    chunk = _decode_settlement_chunk(_field(pSettlementInfo, "Content", ""))
                    # Must copy now: Content buffer may be reused on next callback
                    self._settlement_chunks.append((seq, chunk))
            finally:
                if bIsLast:
                    self.settlement_qry_done.set()

        def connect_and_login(self, timeout: float = _DEFAULT_TIMEOUT) -> None:
            add_log("Init trader api ...")
            self.api.Init()
            if not self.logged_in_ev.wait(timeout):
                raise CtpError("登录超时: 检查前置地址 / 网络 / 账号")
            if self.error:
                raise CtpError(self.error)

            self.settlement_done.clear()
            req = tdapi.CThostFtdcSettlementInfoConfirmField()
            req.BrokerID = self.cfg["broker"]
            req.InvestorID = self.cfg["user"]
            add_log("ReqSettlementInfoConfirm ...")
            self.api.ReqSettlementInfoConfirm(req, 0)
            if not self.settlement_done.wait(min(15.0, timeout)):
                add_log("Settlement confirm timeout, continue", "warn")

        def _wait_qry(self, done: threading.Event, label: str, timeout: float) -> None:
            if not done.wait(timeout):
                raise CtpError(f"查询{label}超时")
            if self._qry_error:
                raise CtpError(self._qry_error)

        def _wait_qry_soft(self, done: threading.Event, label: str, timeout: float) -> bool:
            """Optional qry: log failures, never abort portfolio."""
            if not done.wait(timeout):
                add_log(f"查询{label}超时", "warn")
                return False
            if self._qry_error:
                add_log(self._qry_error, "warn")
                self._qry_error = None
                return False
            return True

        def OnRspQryInstrument(self, pInstrument, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查合约失败: {pRspInfo.ErrorMsg}"
                elif pInstrument is not None:
                    iid = str(_field(pInstrument, "InstrumentID", "") or "")
                    if iid:
                        self._instrument_buf[iid] = {
                            "instrument": iid,
                            "exchange": str(_field(pInstrument, "ExchangeID", "") or ""),
                            "product_class": str(_field(pInstrument, "ProductClass", "") or ""),
                            "volume_multiple": int(_field(pInstrument, "VolumeMultiple", 0) or 0),
                            "options_type": str(_field(pInstrument, "OptionsType", "") or ""),
                            "underlying": str(_field(pInstrument, "UnderlyingInstrID", "") or ""),
                        }
            finally:
                if bIsLast:
                    self.instrument_done.set()

        def OnRspQryDepthMarketData(self, pDepthMarketData, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查行情失败: {pRspInfo.ErrorMsg}"
                elif pDepthMarketData is not None:
                    iid = str(_field(pDepthMarketData, "InstrumentID", "") or "")
                    if iid:
                        self._tick_buf[iid] = {
                            "instrument": iid,
                            "last_price": _sanitize_price(_field(pDepthMarketData, "LastPrice", 0)),
                            "settlement_price": _sanitize_price(
                                _field(pDepthMarketData, "SettlementPrice", 0)
                            ),
                            "exchange": str(_field(pDepthMarketData, "ExchangeID", "") or ""),
                        }
            finally:
                if bIsLast:
                    self.tick_done.set()

        def _qry_instrument(self, instrument: str, exchange: str = "", timeout: float = 12.0) -> None:
            self._qry_error = None
            self.instrument_done.clear()
            time.sleep(_QRY_GAP)
            req = tdapi.CThostFtdcQryInstrumentField()
            req.InstrumentID = instrument
            if exchange:
                req.ExchangeID = exchange
            add_log(f"ReqQryInstrument {instrument}")
            self.api.ReqQryInstrument(req, 0)
            self._wait_qry_soft(self.instrument_done, f"合约{instrument}", timeout)

        def _qry_tick(self, instrument: str, exchange: str = "", timeout: float = 12.0) -> None:
            self._qry_error = None
            self.tick_done.clear()
            time.sleep(_QRY_GAP)
            req = tdapi.CThostFtdcQryDepthMarketDataField()
            req.InstrumentID = instrument
            if exchange:
                req.ExchangeID = exchange
            add_log(f"ReqQryDepthMarketData {instrument}")
            self.api.ReqQryDepthMarketData(req, 0)
            self._wait_qry_soft(self.tick_done, f"行情{instrument}", timeout)

        def _load_option_meta_and_ticks(
            self,
            positions: list[dict[str, Any]],
            timeout: float = 12.0,
        ) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
            """Fetch instrument + last price for option-like positions only."""
            uniq: dict[str, str] = {}
            for p in positions:
                inst = str(p.get("instrument") or "")
                if not inst:
                    continue
                if inst not in uniq:
                    uniq[inst] = str(p.get("exchange") or "")

            # Avoid querying every futures contract: ID heuristic first
            candidates = [
                (iid, ex) for iid, ex in uniq.items() if _looks_like_option_id(iid)
            ]
            instruments: dict[str, dict[str, Any]] = {}
            ticks: dict[str, dict[str, Any]] = {}
            if not candidates:
                return instruments, ticks

            for iid, ex in candidates:
                self._qry_instrument(iid, ex, timeout=timeout)
                meta = self._instrument_buf.get(iid)
                if meta:
                    instruments[iid] = meta
                    ex = str(meta.get("exchange") or ex)
                if not _is_option_meta(meta, iid):
                    continue
                self._qry_tick(iid, ex, timeout=timeout)
                tick = self._tick_buf.get(iid)
                if tick:
                    ticks[iid] = tick

            add_log(
                f"Option meta instruments={len(instruments)} ticks={len(ticks)} "
                f"candidates={len(candidates)}"
            )
            return instruments, ticks

        def query_settlement(
            self,
            trading_day: str,
            timeout: float = _DEFAULT_TIMEOUT,
            *,
            allow_empty: bool = False,
        ) -> dict[str, Any]:
            """Query daily/monthly settlement bill and parse historical equity."""
            if not self.ready:
                raise CtpError("尚未登录或连接已断开, 请先点登录")
            day = _normalize_trading_day(trading_day)

            self._qry_error = None
            self._settlement_chunks = []
            self.settlement_qry_done.clear()

            time.sleep(_QRY_GAP)
            req = tdapi.CThostFtdcQrySettlementInfoField()
            req.BrokerID = self.cfg["broker"]
            req.InvestorID = self.cfg["user"]
            req.TradingDay = day
            add_log(f"ReqQrySettlementInfo TradingDay={day}")
            self.api.ReqQrySettlementInfo(req, 0)
            self._wait_qry(self.settlement_qry_done, "结算单", timeout)

            chunks = sorted(self._settlement_chunks, key=lambda x: x[0])
            content = "".join(c for _, c in chunks)
            if not content.strip():
                add_log(f"Settlement {day}: empty", "warn")
                if allow_empty:
                    return {
                        "trading_day": day,
                        "parsed": parse_settlement_text(""),
                        "content": "",
                        "chunk_count": 0,
                        "updated": _now(),
                        "status": "empty",
                    }
                raise CtpError(
                    f"结算单为空 (TradingDay={day}). "
                    "柜台可能未生成该日结算单, 或该日无结算数据"
                )
            parsed = parse_settlement_text(content)
            add_log(
                f"Settlement {day}: equity={parsed.get('equity')} "
                f"market={parsed.get('market_equity')} client={parsed.get('client_equity')} "
                f"chunks={len(chunks)} chars={len(content)}"
            )
            return {
                "trading_day": day,
                "parsed": parsed,
                "content": content,
                "chunk_count": len(chunks),
                "updated": _now(),
                "status": "ok",
            }

        def query_portfolio(self, timeout: float = _DEFAULT_TIMEOUT) -> dict[str, Any]:
            """Query account + positions + details + orders + trades (serial)."""
            if not self.ready:
                raise CtpError("尚未登录或连接已断开, 请先点登录")

            self._qry_error = None
            self.account = None
            self.positions = []
            self.orders = []
            self.trades = []
            self.details = []
            self.account_done.clear()
            self.position_done.clear()
            self.order_done.clear()
            self.trade_done.clear()
            self.detail_done.clear()

            time.sleep(_QRY_GAP)
            req_acc = tdapi.CThostFtdcQryTradingAccountField()
            req_acc.BrokerID = self.cfg["broker"]
            req_acc.InvestorID = self.cfg["user"]
            add_log("ReqQryTradingAccount ...")
            self.api.ReqQryTradingAccount(req_acc, 0)
            self._wait_qry(self.account_done, "资金账户", timeout)

            time.sleep(_QRY_GAP)
            req_pos = tdapi.CThostFtdcQryInvestorPositionField()
            req_pos.BrokerID = self.cfg["broker"]
            req_pos.InvestorID = self.cfg["user"]
            add_log("ReqQryInvestorPosition ...")
            self.api.ReqQryInvestorPosition(req_pos, 0)
            self._wait_qry(self.position_done, "持仓", timeout)

            time.sleep(_QRY_GAP)
            req_det = tdapi.CThostFtdcQryInvestorPositionDetailField()
            req_det.BrokerID = self.cfg["broker"]
            req_det.InvestorID = self.cfg["user"]
            add_log("ReqQryInvestorPositionDetail ...")
            self.api.ReqQryInvestorPositionDetail(req_det, 0)
            self._wait_qry(self.detail_done, "持仓明细", timeout)

            time.sleep(_QRY_GAP)
            req_ord = tdapi.CThostFtdcQryOrderField()
            req_ord.BrokerID = self.cfg["broker"]
            req_ord.InvestorID = self.cfg["user"]
            add_log("ReqQryOrder ...")
            self.api.ReqQryOrder(req_ord, 0)
            self._wait_qry(self.order_done, "委托", timeout)

            time.sleep(_QRY_GAP)
            req_trd = tdapi.CThostFtdcQryTradeField()
            req_trd.BrokerID = self.cfg["broker"]
            req_trd.InvestorID = self.cfg["user"]
            add_log("ReqQryTrade ...")
            self.api.ReqQryTrade(req_trd, 0)
            self._wait_qry(self.trade_done, "成交", timeout)

            positions = sorted(
                self.positions,
                key=lambda r: (r["instrument"], r["direction"], r["position_date"]),
            )
            details = sorted(
                self.details,
                key=lambda r: (r["instrument"], r["open_date"], r["trade_id"]),
                reverse=True,
            )
            orders = sorted(
                self.orders,
                key=lambda r: (r["insert_time"], r["order_sys_id"]),
                reverse=True,
            )
            trades = sorted(
                self.trades,
                key=lambda r: (r["trade_time"], r["trade_id"]),
                reverse=True,
            )

            # Fast path: provisional 市值权益 = 客户权益. Option ticks load in background
            # (CTP qry gap ~1s/leg would otherwise block the whole portfolio response).
            account = dict(self.account or {})
            client = float(account.get("client_equity") or account.get("balance") or 0)
            account["client_equity"] = round(client, 2)
            need_ticks = any(
                _looks_like_option_id(str(p.get("instrument") or "")) for p in positions
            )
            if need_ticks:
                account["market_equity"] = round(client, 2)
                account["option_long_value"] = 0.0
                account["option_short_value"] = 0.0
                account["option_legs"] = 0
                account["market_equity_pending"] = True
                account["market_equity_method"] = "客户权益(期权行情后台计算中)"
            else:
                me = compute_market_equity(account, positions, {}, {})
                account.update(me)
                account["market_equity_pending"] = False

            add_log(
                f"Query done: pos={len(positions)} details={len(details)} "
                f"orders={len(orders)} trades={len(trades)} "
                f"marketEquityPending={account.get('market_equity_pending')}"
            )
            return {
                "trading_day": self.trading_day,
                "account": account,
                "positions": positions,
                "details": details,
                "orders": orders,
                "trades": trades,
                "totals": {
                    "position_count": len(positions),
                    "detail_count": len(details),
                    "order_count": len(orders),
                    "trade_count": len(trades),
                    "use_margin": round(sum(p["use_margin"] for p in positions), 2),
                    "position_profit": round(sum(p["position_profit"] for p in positions), 2),
                    "close_profit": round(sum(p["close_profit"] for p in positions), 2),
                    "detail_close_profit": round(
                        sum(d["close_profit_by_trade"] for d in details), 2
                    ),
                    "detail_position_profit": round(
                        sum(d["position_profit_by_trade"] for d in details), 2
                    ),
                    "market_equity": float(account.get("market_equity") or 0),
                    "option_long_value": float(account.get("option_long_value") or 0),
                    "option_short_value": float(account.get("option_short_value") or 0),
                },
                "updated": _now(),
                "user_masked": _mask_user(self.cfg["user"]),
                "logged_in": True,
                "market_equity_pending": bool(account.get("market_equity_pending")),
            }

        def close(self) -> None:
            add_log("Release trader api")
            self.ready = False
            try:
                self.api.RegisterSpi(None)
                self.api.Release()
            except Exception as e:  # noqa: BLE001
                add_log(f"Release warn: {e}", "warn")

    return CtpSession()


def login(timeout: float = _DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Connect + authenticate + login; keep session open. Click-driven."""
    global _session, _logging_in

    cfg = load_config()
    if not cfg:
        raise CtpError(
            f"未配置 CTP 账户. 请写入 {CTP_CFG_FILE} 或设置环境变量 "
            "CTP_HOST/CTP_BROKER/CTP_USER/CTP_PASSWORD/CTP_APPID/CTP_AUTHCODE"
        )
    try:
        from openctp_ctp import thosttraderapi as tdapi
    except ImportError as e:
        raise CtpError("未安装 openctp-ctp, 请执行: pip install openctp-ctp") from e

    if not _op_lock.acquire(timeout=2):
        raise CtpError("已有操作进行中, 请稍候")
    td = None
    pending_me: dict[str, Any] | None = None
    try:
        with _lock:
            if _logging_in:
                raise CtpError("正在登录中, 请稍候")
            if _is_logged_in_unlocked():
                add_log("Already logged in, auto query ...", "warn")
                td_exist = _session
                # fall through to auto query below (still hold _op_lock)
            else:
                td_exist = None
                stale = _session
                _session = None
                _logging_in = True

        if td_exist is not None:
            try:
                portfolio = td_exist.query_portfolio(timeout=timeout)
                msg = "已登录, 已刷新持仓"
            except CtpError as e:
                add_log(f"Auto query failed: {e}", "error")
                portfolio = None
                msg = f"已登录, 但自动查询失败: {e}"
            pending_me = portfolio
            return {
                "logged_in": True,
                "trading_day": td_exist.trading_day,
                "user_masked": _mask_user(cfg["user"]),
                "message": msg,
                "portfolio": portfolio,
            }

        if stale is not None:
            try:
                stale.close()
            except Exception:  # noqa: BLE001
                pass

        os.makedirs(CACHE_DIR, exist_ok=True)
        add_log(f"Login start user={_mask_user(cfg['user'])}")
        td = _build_session(tdapi, cfg)
        td.connect_and_login(timeout=timeout)
        with _lock:
            _session = td
            _logging_in = False
        add_log("Login OK, session kept open; auto query account + positions")
        try:
            portfolio = td.query_portfolio(timeout=timeout)
            msg = "登录成功, 已拉取持仓"
        except CtpError as e:
            # Keep session even if first query fails
            add_log(f"Auto query failed: {e}", "error")
            portfolio = None
            msg = f"登录成功, 但自动查询失败: {e}"
        pending_me = portfolio
        return {
            "logged_in": True,
            "trading_day": td.trading_day,
            "user_masked": _mask_user(cfg["user"]),
            "message": msg,
            "portfolio": portfolio,
        }
    except Exception:
        with _lock:
            _logging_in = False
            # Login never finished: drop the half-open api
            if _session is None and td is not None:
                try:
                    td.close()
                except Exception:  # noqa: BLE001
                    pass
        raise
    finally:
        _op_lock.release()
        schedule_market_equity(pending_me)


def logout() -> dict[str, Any]:
    global _session, _logging_in
    if not _op_lock.acquire(timeout=2):
        raise CtpError("已有操作进行中, 请稍候")
    try:
        with _lock:
            td = _session
            _session = None
            _logging_in = False
        if td is not None:
            try:
                td.close()
            except Exception as e:  # noqa: BLE001
                add_log(f"Logout warn: {e}", "warn")
        add_log("Logged out")
        _reset_market_equity_state()
        return {"logged_in": False, "message": "已退出登录"}
    finally:
        _op_lock.release()


def _reset_market_equity_state() -> None:
    global _me_seq
    with _me_lock:
        _me_seq += 1
        _me_state.update({
            "status": "idle",
            "seq": _me_seq,
            "result": None,
            "error": None,
            "updated": None,
            "trading_day": "",
        })


def get_market_equity_job() -> dict[str, Any]:
    """Poll async 市值权益 job (option ticks loaded in background)."""
    with _me_lock:
        st = dict(_me_state)
    result = st.get("result")
    return {
        "status": st.get("status") or "idle",
        "seq": st.get("seq") or 0,
        "trading_day": st.get("trading_day") or "",
        "updated": st.get("updated"),
        "error": st.get("error"),
        "account_patch": result,
        "pending": st.get("status") in ("pending", "running"),
    }


def schedule_market_equity(portfolio: dict[str, Any] | None) -> None:
    """Start background option-tick load after portfolio returns (non-blocking)."""
    global _me_seq
    if not portfolio or not portfolio.get("market_equity_pending"):
        return
    positions = list(portfolio.get("positions") or [])
    account = dict(portfolio.get("account") or {})
    trading_day = str(portfolio.get("trading_day") or "")
    with _me_lock:
        _me_seq += 1
        seq = _me_seq
        _me_state.update({
            "status": "pending",
            "seq": seq,
            "result": None,
            "error": None,
            "updated": None,
            "trading_day": trading_day,
        })

    def worker() -> None:
        with _me_lock:
            if _me_state.get("seq") != seq:
                return
            _me_state["status"] = "running"
        add_log(f"MarketEquity bg start seq={seq} (option ticks, rate-limited)")
        # Wait for main portfolio / login to release op lock
        if not _op_lock.acquire(timeout=180):
            with _me_lock:
                if _me_state.get("seq") == seq:
                    _me_state.update({
                        "status": "error",
                        "error": "等待操作锁超时",
                        "updated": _now(),
                    })
            add_log("MarketEquity bg wait op_lock timeout", "warn")
            return
        try:
            with _me_lock:
                if _me_state.get("seq") != seq:
                    return
            with _lock:
                td = _session
                if td is None or not getattr(td, "ready", False):
                    raise CtpError("会话已断开")
            instruments, ticks = td._load_option_meta_and_ticks(positions)
            me = compute_market_equity(account, positions, instruments, ticks)
            me["market_equity_pending"] = False
            with _me_lock:
                if _me_state.get("seq") != seq:
                    return
                _me_state.update({
                    "status": "ready",
                    "result": me,
                    "error": None,
                    "updated": _now(),
                    "trading_day": trading_day,
                })
            add_log(
                f"MarketEquity bg ready seq={seq} "
                f"eq={me.get('market_equity')} long={me.get('option_long_value')} "
                f"short={me.get('option_short_value')} legs={me.get('option_legs')}"
            )
        except Exception as e:  # noqa: BLE001
            add_log(f"MarketEquity bg fail seq={seq}: {e}", "error")
            with _me_lock:
                if _me_state.get("seq") == seq:
                    _me_state.update({
                        "status": "error",
                        "error": str(e),
                        "updated": _now(),
                    })
        finally:
            _op_lock.release()

    threading.Thread(target=worker, name=f"ctp-me-{seq}", daemon=True).start()


def fetch_portfolio(timeout: float = _DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Query account + positions on the existing logged-in session."""
    if not _op_lock.acquire(timeout=2):
        raise CtpError("已有操作进行中, 请稍候")
    try:
        with _lock:
            td = _session
            if td is None or not getattr(td, "ready", False):
                raise CtpError("尚未登录, 请先点「登录」")
            if _logging_in:
                raise CtpError("正在登录中, 请稍候")
        result = td.query_portfolio(timeout=timeout)
    finally:
        _op_lock.release()
    schedule_market_equity(result)
    return result


def fetch_settlement(
    trading_day: str,
    timeout: float = _DEFAULT_TIMEOUT,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Query one settlement day; use local cache unless force=True."""
    day = _normalize_trading_day(trading_day)
    if len(day) == 8 and not force:
        cached = _get_cached_settlement(day)
        if cached and cached.get("status") == "ok":
            add_log(f"Settlement {day}: cache hit")
            return {
                "trading_day": day,
                "parsed": cached.get("parsed") or {},
                "content": cached.get("content") or "",
                "chunk_count": cached.get("chunk_count") or 0,
                "updated": cached.get("updated") or _now(),
                "status": "ok",
                "from_cache": True,
            }

    if not _op_lock.acquire(timeout=2):
        raise CtpError("已有操作进行中, 请稍候")
    try:
        with _lock:
            td = _session
            if td is None or not getattr(td, "ready", False):
                raise CtpError("尚未登录, 请先点「登录」")
            if _logging_in:
                raise CtpError("正在登录中, 请稍候")
        result = td.query_settlement(day, timeout=timeout, allow_empty=False)
        if len(day) == 8 and result.get("status") == "ok":
            _put_cached_settlement(day, {
                "status": "ok",
                "trading_day": day,
                "parsed": result.get("parsed") or {},
                "content": result.get("content") or "",
                "chunk_count": result.get("chunk_count") or 0,
                "updated": result.get("updated") or _now(),
            })
        result["from_cache"] = False
        return result
    finally:
        _op_lock.release()


def fetch_settlement_range(
    start: str,
    end: str | None = None,
    *,
    refresh: bool = True,
    force: bool = False,
    timeout: float = _DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Pull settlements for [start, end] (end defaults to today).

    Cached ok/empty days are skipped unless force=True.
    refresh=False: read cache only (no CTP).
    """
    # Fix historically truncated parses (e.g. 779151.49 -> 779) from old regex
    try:
        rep = reparse_settlement_cache()
        if rep.get("fixed"):
            add_log(f"Settlement cache reparsed: fixed={rep['fixed']}/{rep['scanned']}")
    except Exception as e:  # noqa: BLE001
        add_log(f"Settlement cache reparse warn: {e}", "warn")

    start_d = _normalize_ymd(start)
    end_d = _normalize_ymd(end) if end else _today_ymd()
    days = _iter_range_days(start_d, end_d)

    series: list[dict[str, Any]] = []
    stats = {
        "total_days": len(days),
        "cached": 0,
        "fetched": 0,
        "empty": 0,
        "errors": 0,
        "missing": 0,
    }

    need_fetch: list[str] = []
    for day in days:
        cached = None if force else _get_cached_settlement(day)
        if cached and cached.get("status") in ("ok", "empty"):
            # Today empty may become available later -- do not trust empty cache for today
            if cached.get("status") == "empty" and day >= _today_ymd() and refresh:
                need_fetch.append(day)
                continue
            pt = _series_point(day, cached, from_cache=True)
            series.append(pt)
            stats["cached"] += 1
            if cached.get("status") == "empty":
                stats["empty"] += 1
            continue
        if refresh:
            need_fetch.append(day)
        else:
            series.append(_series_point(day, None, from_cache=False))
            stats["missing"] += 1

    if need_fetch:
        # Hold op lock for the whole batch (CTP qry gap already serializes)
        lock_wait = max(5.0, min(30.0, 2.0 + len(need_fetch) * 0.05))
        if not _op_lock.acquire(timeout=lock_wait):
            raise CtpError("已有操作进行中, 请稍候")
        try:
            with _lock:
                td = _session
                if td is None or not getattr(td, "ready", False):
                    raise CtpError("尚未登录, 请先点「登录」后再拉取缺失结算单")
                if _logging_in:
                    raise CtpError("正在登录中, 请稍候")
            add_log(f"Settlement range fetch {len(need_fetch)} days ({start_d}..{end_d})")
            for day in need_fetch:
                try:
                    result = td.query_settlement(day, timeout=timeout, allow_empty=True)
                    status = result.get("status") or "ok"
                    rec = {
                        "status": status,
                        "trading_day": day,
                        "parsed": result.get("parsed") or {},
                        "content": result.get("content") or "",
                        "chunk_count": result.get("chunk_count") or 0,
                        "updated": result.get("updated") or _now(),
                    }
                    # Do not permanently cache empty for today (settlement may arrive later)
                    if status == "ok" or day < _today_ymd():
                        _put_cached_settlement(day, rec)
                    series.append(_series_point(day, rec, from_cache=False))
                    stats["fetched"] += 1
                    if status == "empty":
                        stats["empty"] += 1
                except CtpError as e:
                    add_log(f"Settlement {day} fail: {e}", "error")
                    series.append(_series_point(day, None, from_cache=False, error=str(e)))
                    stats["errors"] += 1
        finally:
            _op_lock.release()

    series.sort(key=lambda x: x["trading_day"])
    chart = [
        {
            "date": p["date"],
            "trading_day": p["trading_day"],
            "equity": p["equity"],
            "market_equity": p["market_equity"],
            "client_equity": p["client_equity"],
        }
        for p in series
        if p.get("status") == "ok" and p.get("equity") is not None
    ]
    analytics = build_settlement_analytics(series)
    return {
        "start": start_d,
        "end": end_d,
        "account": _account_cache_id(),
        "series": series,
        "chart": chart,
        "analytics": analytics,
        "stats": stats,
        "cache_file": SETTLEMENT_CACHE_FILE,
        "updated": _now(),
    }
