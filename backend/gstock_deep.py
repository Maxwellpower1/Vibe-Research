"""美股 / 港股深度数据 —— 移植自 global-stock-data V2 子集。

覆盖:
- Yahoo: 估值 / 分析师 / 机构持仓
- 东财: 三表关键科目 + 日级资金流
- SEC EDGAR: 个股申报列表 / 全市场当日流 (需 VR_SEC_CONTACT)
- FINRA: 空头成交量时序
- Nasdaq: 财报日历

合规: 客观数据整理, 不推荐不预测. SEC 须声明 UA (VR_SEC_CONTACT).
"""

from __future__ import annotations

import csv
import io
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import requests

import astock
import gstock

_UA = astock.UA
_YAHOO_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

# SEC requires a real contact in User-Agent. Set VR_SEC_CONTACT="Name email@domain.com"
def _sec_contact() -> str:
    return (os.environ.get("VR_SEC_CONTACT") or "").strip()

_FORM_LABEL = {
    "4": "内部人交易", "8-K": "重大事件", "13F-HR": "机构持仓",
    "144": "限售股拟出售", "10-K": "年报", "10-Q": "季报",
    "SC 13D": "举牌(主动)", "SC 13G": "举牌(被动)", "S-1": "IPO注册",
}


class DataNotAvailable(RuntimeError):
    """Resource genuinely missing (non-trading day / not published yet)."""


# ── Yahoo session ──────────────────────────────────────────────────────────

_yahoo_session: requests.Session | None = None
_yahoo_lock = threading.Lock()


def _get_yahoo_session() -> requests.Session:
    global _yahoo_session
    with _yahoo_lock:
        if _yahoo_session is not None and getattr(_yahoo_session, "_crumb", None):
            return _yahoo_session
        s = requests.Session()
        s.headers["User-Agent"] = _YAHOO_UA
        s.get("https://fc.yahoo.com", timeout=10)
        r = s.get("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=10)
        r.raise_for_status()
        s._crumb = r.text  # type: ignore[attr-defined]
        _yahoo_session = s
        return s


def _yahoo_quote_summary(symbol: str, modules: list[str]) -> dict:
    s = _get_yahoo_session()
    r = s.get(
        f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}",
        params={"modules": ",".join(modules), "crumb": s._crumb},  # type: ignore[attr-defined]
        timeout=15,
    )
    r.raise_for_status()
    results = (r.json().get("quoteSummary") or {}).get("result") or [{}]
    return results[0] if results else {}


def _raw(d: dict, key: str):
    v = d.get(key, {})
    return v.get("raw") if isinstance(v, dict) else v


def to_yahoo_symbol(info: dict) -> str | None:
    """Map resolve_symbol info to Yahoo ticker. KR unsupported."""
    m = info.get("market")
    code = str(info.get("code") or "")
    if m in ("NASDAQ", "NYSE", "US"):
        return code.replace(".", "-")
    if m == "HK":
        n = code.lstrip("0") or "0"
        return f"{n.zfill(4)}.HK"
    return None


def _resolve_yahoo(query: str) -> tuple[dict, str] | None:
    info = gstock.resolve_symbol(query)
    if not info:
        return None
    ysym = to_yahoo_symbol(info)
    if not ysym:
        return None
    return info, ysym


def _yahoo_query_fallback(query: str) -> tuple[str, str, str, str] | None:
    """When Eastmoney resolve is down: (code, name, market, yahoo_symbol)."""
    raw = (query or "").strip().upper().removesuffix(".HK")
    if not raw:
        return None
    if re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,7}", raw):
        y = raw.replace(".", "-")
        return raw, raw, "US", y
    if raw.isdigit() and len(raw) <= 5:
        code = raw.zfill(5)
        n = code.lstrip("0") or "0"
        return code, code, "HK", f"{n.zfill(4)}.HK"
    return None


def stock_news(keyword: str, count: int = 10) -> dict:
    """Yahoo Finance news search by ticker/keyword (compliance C).

    Returns {code, name, market, yahoo_symbol, compliance, items:[...]}.
    """
    q = (keyword or "").strip()
    if not q:
        return {}
    n = max(1, min(int(count or 10), 30))
    hit = _resolve_yahoo(q)
    if hit:
        info, ysym = hit
        code = str(info.get("code") or ysym)
        name = str(info.get("name") or code)
        market = str(info.get("market") or "")
        search_q = ysym
    else:
        fb = _yahoo_query_fallback(q)
        if not fb:
            search_q = q
            code = name = q
            market = ""
            ysym = q
        else:
            code, name, market, ysym = fb
            search_q = ysym

    def _fetch(session: requests.Session) -> list[dict]:
        r = session.get(
            "https://query2.finance.yahoo.com/v1/finance/search",
            params={"q": search_q, "quotesCount": 0, "newsCount": n},
            timeout=12,
        )
        r.raise_for_status()
        return r.json().get("news") or []

    try:
        s = _get_yahoo_session()
        news = _fetch(s)
    except Exception:
        # Cookie/crumb stale: reset and retry once
        global _yahoo_session
        with _yahoo_lock:
            _yahoo_session = None
        try:
            s = _get_yahoo_session()
            news = _fetch(s)
        except Exception:
            return {}

    items: list[dict] = []
    for row in news:
        if not isinstance(row, dict):
            continue
        thumb = None
        th = row.get("thumbnail") or {}
        res = th.get("resolutions") if isinstance(th, dict) else None
        if isinstance(res, list) and res:
            thumb = res[0].get("url")
        ts = row.get("providerPublishTime")
        pub = None
        if isinstance(ts, (int, float)) and ts > 0:
            try:
                pub = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            except (OSError, OverflowError, ValueError):
                pub = None
        items.append({
            "title": row.get("title"),
            "publisher": row.get("publisher"),
            "link": row.get("link"),
            "publish_time": pub,
            "publish_ts": int(ts) if isinstance(ts, (int, float)) else None,
            "thumbnail": thumb,
        })
    return {
        "code": code,
        "name": name,
        "market": market,
        "yahoo_symbol": ysym,
        "compliance": "C",
        "source": "Yahoo Finance search",
        "items": items,
    }


# ── Valuation / analyst / holders (Yahoo) ─────────────────────────────────

def key_statistics(query: str) -> dict:
    """Yahoo PE/PB/PEG/target/beta etc. Empty dict if unavailable."""
    hit = _resolve_yahoo(query)
    if not hit:
        return {}
    info, ysym = hit
    try:
        data = _yahoo_quote_summary(
            ysym, ["financialData", "defaultKeyStatistics", "summaryDetail"]
        )
    except Exception:
        return {}
    fd, ks, sd = data.get("financialData") or {}, data.get("defaultKeyStatistics") or {}, data.get("summaryDetail") or {}
    return {
        "code": info["code"],
        "name": info["name"],
        "market": info["market"],
        "yahoo_symbol": ysym,
        "current_price": _raw(fd, "currentPrice"),
        "target_high": _raw(fd, "targetHighPrice"),
        "target_low": _raw(fd, "targetLowPrice"),
        "target_mean": _raw(fd, "targetMeanPrice"),
        "recommendation": fd.get("recommendationKey"),
        "trailing_pe": _raw(sd, "trailingPE"),
        "forward_pe": _raw(ks, "forwardPE"),
        "peg_ratio": _raw(ks, "pegRatio"),
        "price_to_book": _raw(ks, "priceToBook"),
        "enterprise_value": _raw(ks, "enterpriseValue"),
        "ev_to_ebitda": _raw(ks, "enterpriseToEbitda"),
        "ev_to_revenue": _raw(ks, "enterpriseToRevenue"),
        "profit_margin": _raw(ks, "profitMargins"),
        "operating_margin": _raw(fd, "operatingMargins"),
        "gross_margin": _raw(fd, "grossMargins"),
        "return_on_equity": _raw(fd, "returnOnEquity"),
        "return_on_assets": _raw(fd, "returnOnAssets"),
        "earnings_growth": _raw(fd, "earningsGrowth"),
        "revenue_growth": _raw(fd, "revenueGrowth"),
        "beta": _raw(ks, "beta"),
        "short_ratio": _raw(ks, "shortRatio"),
        "dividend_yield": _raw(sd, "dividendYield"),
        "payout_ratio": _raw(ks, "payoutRatio"),
        "market_cap": _raw(sd, "marketCap"),
        "total_revenue": _raw(fd, "totalRevenue"),
        "total_cash": _raw(fd, "totalCash"),
        "total_debt": _raw(fd, "totalDebt"),
    }


def analyst_estimates(query: str) -> dict:
    hit = _resolve_yahoo(query)
    if not hit:
        return {}
    info, ysym = hit
    try:
        data = _yahoo_quote_summary(ysym, [
            "earningsTrend", "recommendationTrend", "upgradeDowngradeHistory",
        ])
    except Exception:
        return {}
    eps_trend = []
    for t in (data.get("earningsTrend") or {}).get("trend") or []:
        eps_trend.append({
            "period": t.get("period"),
            "end_date": t.get("endDate"),
            "eps_estimate": ((t.get("earningsEstimate") or {}).get("avg") or {}).get("raw"),
            "eps_high": ((t.get("earningsEstimate") or {}).get("high") or {}).get("raw"),
            "eps_low": ((t.get("earningsEstimate") or {}).get("low") or {}).get("raw"),
            "revenue_estimate": ((t.get("revenueEstimate") or {}).get("avg") or {}).get("raw"),
            "num_analysts": ((t.get("earningsEstimate") or {}).get("numberOfAnalysts") or {}).get("raw"),
        })
    rating_trend = []
    for r_ in (data.get("recommendationTrend") or {}).get("trend") or []:
        rating_trend.append({
            "period": r_.get("period"),
            "strong_buy": r_.get("strongBuy"),
            "buy": r_.get("buy"),
            "hold": r_.get("hold"),
            "sell": r_.get("sell"),
            "strong_sell": r_.get("strongSell"),
        })
    upgrades = []
    for u in ((data.get("upgradeDowngradeHistory") or {}).get("history") or [])[:20]:
        upgrades.append({
            "date": u.get("epochGradeDate"),
            "firm": u.get("firm"),
            "to_grade": u.get("toGrade"),
            "from_grade": u.get("fromGrade"),
            "action": u.get("action"),
        })
    return {
        "code": info["code"], "name": info["name"], "market": info["market"],
        "eps_trend": eps_trend, "rating_trend": rating_trend, "upgrade_downgrade": upgrades,
    }


def institutional_holders(query: str) -> dict:
    hit = _resolve_yahoo(query)
    if not hit:
        return {}
    info, ysym = hit
    try:
        data = _yahoo_quote_summary(ysym, ["institutionOwnership", "majorHoldersBreakdown"])
    except Exception:
        return {}
    mhb = data.get("majorHoldersBreakdown") or {}
    overview = {
        "insiders_pct": _raw(mhb, "insidersPercentHeld"),
        "institutions_pct": _raw(mhb, "institutionsPercentHeld"),
        "institutions_float_pct": _raw(mhb, "institutionsFloatPercentHeld"),
        "institutions_count": _raw(mhb, "institutionsCount"),
    }
    top_holders = []
    for h in ((data.get("institutionOwnership") or {}).get("ownershipList") or [])[:10]:
        top_holders.append({
            "name": h.get("organization"),
            "shares": _raw(h, "position"),
            "value": _raw(h, "value"),
            "pct_held": _raw(h, "pctHeld"),
            "report_date": (h.get("reportDate") or {}).get("fmt")
            if isinstance(h.get("reportDate"), dict) else None,
        })
    return {
        "code": info["code"], "name": info["name"], "market": info["market"],
        "overview": overview, "top_holders": top_holders,
    }


def stock_fundamentals(query: str) -> dict:
    """Bundle valuation + analyst + holders for one stock page fetch."""
    info = gstock.resolve_symbol(query)
    if not info:
        return {}
    if info.get("market") == "KR":
        return {"code": info["code"], "name": info["name"], "market": "KR",
                "valuation": None, "analyst": None, "holders": None,
                "note": "韩股暂无 Yahoo 基本面"}
    val = key_statistics(query)
    ana = analyst_estimates(query)
    hold = institutional_holders(query)
    return {
        "code": info["code"],
        "name": info["name"],
        "market": info["market"],
        "valuation": val or None,
        "analyst": ana if ana.get("eps_trend") or ana.get("rating_trend") else None,
        "holders": hold if hold.get("top_holders") or any((hold.get("overview") or {}).values()) else None,
    }


# ── Financial statements (Eastmoney, key lines) ───────────────────────────

_STMT_REPORT = {
    "balance": {"us": "RPT_USF10_FN_BALANCE", "hk": "RPT_HKF10_FN_BALANCE"},
    "income": {"us": "RPT_USF10_FN_INCOME", "hk": "RPT_HKF10_FN_INCOME"},
    "cashflow": {"us": "RPT_USSK_FN_CASHFLOW", "hk": "RPT_HKSK_FN_CASHFLOW"},
}

# Preferred Chinese line items (exact match preferred, then contains).
_STMT_KEYS = {
    "income": [
        "营业收入", "营业总收入", "营业成本", "毛利", "营业利润",
        "利润总额", "净利润", "归属于母公司所有者的净利润",
        "基本每股收益", "稀释每股收益",
    ],
    "balance": [
        "资产总计", "资产合计", "流动资产合计", "货币资金", "现金及现金等价物",
        "负债合计", "负债总计", "流动负债合计",
        "股东权益合计", "所有者权益合计", "归属于母公司股东权益合计",
    ],
    "cashflow": [
        "经营活动产生的现金流量净额", "投资活动产生的现金流量净额",
        "筹资活动产生的现金流量净额", "现金及现金等价物净增加额",
        "期末现金及现金等价物余额", "期初现金及现金等价物余额",
    ],
}


def _match_stmt_item(name: str, keys: list[str]) -> str | None:
    if not name:
        return None
    if name in keys:
        return name
    for k in keys:
        if k in name:
            return k
    return None


def financial_statements(query: str, statement: str = "income", periods: int = 5) -> dict:
    """Eastmoney three-statement key lines, pivoted by report date."""
    statement = (statement or "income").lower()
    if statement not in _STMT_REPORT:
        return {}
    info = gstock.resolve_symbol(query)
    if not info or info.get("market") == "KR":
        return {}
    market = "hk" if info["secucode"].endswith(".HK") else "us"
    report = _STMT_REPORT[statement][market]
    rows = astock.eastmoney_datacenter(
        report,
        filter_str=f'(SECUCODE="{info["secucode"]}")',
        page_size=400,
        sort_columns="REPORT_DATE",
        sort_types="-1",
    )
    if not rows:
        return {}
    keys = _STMT_KEYS[statement]
    by_period: dict[str, dict] = {}
    for r in rows:
        rd = str(r.get("REPORT_DATE") or "")[:10]
        label = _match_stmt_item(str(r.get("ITEM_NAME") or ""), keys)
        if not rd or not label:
            continue
        p = by_period.setdefault(rd, {
            "report_date": rd,
            "report": r.get("REPORT"),
            "currency": r.get("CURRENCY"),
            "items": {},
        })
        # Keep first occurrence per label (rows already newest-first overall)
        if label in p["items"]:
            continue
        amt, yoy = r.get("AMOUNT"), r.get("YOY_RATIO")
        p["items"][label] = {
            "amount": amt if isinstance(amt, (int, float)) else None,
            "yoy": yoy if isinstance(yoy, (int, float)) else None,
        }
    if not by_period:
        return {}
    periods_out = sorted(by_period.values(), key=lambda x: x["report_date"], reverse=True)[:periods]
    # Stable item order: whitelist order, only those present in any period
    present: set[str] = set()
    for p in periods_out:
        present.update(p["items"].keys())
    item_order = [k for k in keys if k in present]
    return {
        "code": info["code"],
        "name": info["name"],
        "market": info["market"],
        "statement": statement,
        "currency": periods_out[0].get("currency"),
        "item_order": item_order,
        "periods": periods_out,
    }


# ── Fund flow ─────────────────────────────────────────────────────────────

def fund_flow_daily(query: str, limit: int = 60) -> dict:
    info = gstock.resolve_symbol(query)
    if not info or info.get("market") == "KR":
        return {}
    prefix = info["secid_prefix"]
    code = info["code"]
    url = "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get"
    params = {
        "secid": f"{prefix}.{code}",
        "klt": 101,
        "fields1": "f1,f2,f3,f7",
        "fields2": "f51,f52,f53,f54,f55,f56,f57",
        "lmt": max(5, min(int(limit or 60), 200)),
    }
    try:
        r = astock.em_get(url, params=params, headers={"User-Agent": _UA}, timeout=15)
        data = (r.json() or {}).get("data") or {}
        klines = data.get("klines") or []
    except Exception:
        return {}
    rows = []
    for line in klines:
        parts = str(line).split(",")
        if len(parts) < 6:
            continue
        try:
            rows.append({
                "date": parts[0],
                "main_net": float(parts[1]),
                "small_net": float(parts[2]),
                "mid_net": float(parts[3]),
                "big_net": float(parts[4]),
                "super_big_net": float(parts[5]),
                "main_pct": float(parts[6]) if len(parts) > 6 and parts[6] else None,
            })
        except (TypeError, ValueError):
            continue
    if not rows:
        return {}
    return {
        "code": info["code"], "name": info["name"], "market": info["market"],
        "rows": rows,
    }


# ── Official source helpers (SEC / FINRA / Nasdaq) ────────────────────────

class _RateLimiter:
    def __init__(self, max_per_sec: float):
        self._interval = 1.0 / float(max_per_sec)
        self._last = 0.0
        self._lock = threading.Lock()

    def wait(self) -> None:
        with self._lock:
            gap = self._interval - (time.monotonic() - self._last)
            if gap > 0:
                time.sleep(gap)
            self._last = time.monotonic()


_LIMITS = {
    "sec.gov": _RateLimiter(8),
    "finra.org": _RateLimiter(4),
    "cboe.com": _RateLimiter(4),
    "nasdaq.com": _RateLimiter(2),
    "_default": _RateLimiter(5),
}


def _limiter_for(url: str) -> _RateLimiter:
    for host, lim in _LIMITS.items():
        if host != "_default" and host in url:
            return lim
    return _LIMITS["_default"]


def _is_object_missing(resp) -> bool:
    if resp.status_code == 404:
        return True
    if resp.status_code != 403:
        return False
    ctype = (resp.headers.get("Content-Type") or "").lower()
    head = (resp.text or "")[:500]
    return "xml" in ctype and "<Code>AccessDenied</Code>" in head


def _require_sec_contact() -> str:
    contact = _sec_contact()
    if not contact or "your-email@example.com" in contact:
        raise RuntimeError(
            "请设置环境变量 VR_SEC_CONTACT='Your Name you@example.com' "
            "(SEC 要求 User-Agent 声明真实联系方式)"
        )
    return contact


def official_get(url: str, params: dict | None = None, headers: dict | None = None,
                 timeout: int = 30, as_json: bool = False):
    if "sec.gov" in url:
        contact = _require_sec_contact()
        h = {"User-Agent": contact, "Accept-Encoding": "gzip, deflate"}
    else:
        h = {"User-Agent": _UA}
    h.update(headers or {})
    _limiter_for(url).wait()
    try:
        r = requests.get(url, params=params, headers=h, timeout=timeout)
        r.raise_for_status()
    except requests.HTTPError as e:
        resp = e.response
        code = resp.status_code
        low = (resp.text or "")[:4000].lower()
        if _is_object_missing(resp):
            raise DataNotAvailable(
                f"HTTP {code} {url[:80]} — resource missing"
            ) from e
        if code == 403 and "undeclared" in low:
            raise RuntimeError(
                f"SEC rejected User-Agent. VR_SEC_CONTACT={_sec_contact()!r}"
            ) from e
        raise RuntimeError(f"HTTP {code} {url[:80]}") from e
    except requests.RequestException as e:
        raise RuntimeError(f"request failed {url[:80]}: {e}") from e
    return r.json() if as_json else r.text


def _recent_weekdays(days_back: int = 7) -> list[str]:
    d, out = datetime.now(), []
    while len(out) < days_back:
        if d.weekday() < 5:
            out.append(d.strftime("%Y%m%d"))
        d -= timedelta(days=1)
    return out


_cik_cache: dict | None = None


def ticker_to_cik(ticker: str) -> dict:
    global _cik_cache
    t = ticker.strip().upper()
    if not t:
        return {}
    if _cik_cache is None:
        raw = official_get("https://www.sec.gov/files/company_tickers.json", as_json=True)
        _cik_cache = raw if isinstance(raw, dict) else {}
    for _, v in (_cik_cache or {}).items():
        if (v or {}).get("ticker") == t:
            return {
                "ticker": t,
                "cik": str(v["cik_str"]).zfill(10),
                "company": v.get("title"),
            }
    return {}


def sec_filings(query: str, form_type: str | None = None, limit: int = 40) -> dict:
    """Company SEC filings (US only)."""
    info = gstock.resolve_symbol(query)
    if not info or info.get("market") not in ("NASDAQ", "NYSE", "US"):
        return {}
    mapping = ticker_to_cik(info["code"])
    if not mapping:
        return {}
    cik = mapping["cik"]
    data = official_get(f"https://data.sec.gov/submissions/CIK{cik}.json", as_json=True)
    recent = ((data or {}).get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    dates = recent.get("filingDate") or []
    accessions = recent.get("accessionNumber") or []
    primary_docs = recent.get("primaryDocument") or []
    descriptions = recent.get("primaryDocDescription") or []
    filings = []
    for i in range(len(forms)):
        if form_type and forms[i] != form_type:
            continue
        acc = accessions[i] if i < len(accessions) else ""
        doc = primary_docs[i] if i < len(primary_docs) else ""
        filings.append({
            "form": forms[i],
            "form_label": _FORM_LABEL.get(forms[i], ""),
            "date": dates[i] if i < len(dates) else "",
            "accession_number": acc,
            "description": descriptions[i] if i < len(descriptions) else "",
            "url": (
                f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                f"{acc.replace('-', '')}/{doc}"
                if acc and doc else None
            ),
        })
        if len(filings) >= limit:
            break
    return {
        "code": info["code"],
        "name": info["name"],
        "cik": cik,
        "company_name": (data or {}).get("name") or mapping.get("company"),
        "filings": filings,
    }


def daily_filings(date: str | None = None, forms: list[str] | None = None,
                  limit: int = 80) -> dict:
    """Market-wide EDGAR daily index (Form 4 / 8-K / 13F ...)."""
    want = forms or ["4", "8-K", "13F-HR"]
    for d in ([date] if date else _recent_weekdays(7)):
        dt = datetime.strptime(d, "%Y%m%d")
        url = (
            f"https://www.sec.gov/Archives/edgar/daily-index/"
            f"{dt.year}/QTR{(dt.month - 1) // 3 + 1}/form.{d}.idx"
        )
        try:
            raw = official_get(url)
        except DataNotAvailable:
            continue
        lines = raw.splitlines()
        start = next((i + 1 for i, L in enumerate(lines) if L.startswith("---")), 11)
        filings, by_form = [], {}
        for L in lines[start:]:
            if len(L) < 98:
                continue
            form, company = L[:12].strip(), L[12:74].strip()
            cik, filed, path = L[74:86].strip(), L[86:98].strip(), L[98:].strip()
            if not form:
                continue
            by_form[form] = by_form.get(form, 0) + 1
            if form not in want:
                continue
            if len(filings) < limit:
                filings.append({
                    "form": form,
                    "form_label": _FORM_LABEL.get(form, ""),
                    "company": company,
                    "cik": cik,
                    "date": filed,
                    "url": f"https://www.sec.gov/Archives/{path}" if path else None,
                })
        if by_form:
            return {
                "date": d,
                "total": sum(by_form.values()),
                "by_form": dict(sorted(by_form.items(), key=lambda x: -x[1])),
                "filings": filings,
            }
    raise DataNotAvailable("no EDGAR daily index in recent weekdays")


def short_volume_all(date: str | None = None, market: str = "CNMS") -> dict:
    for d in ([date] if date else _recent_weekdays(7)):
        try:
            raw = official_get(
                f"https://cdn.finra.org/equity/regsho/daily/{market}shvol{d}.txt"
            )
        except DataNotAvailable:
            continue
        rows = {}
        for line in raw.splitlines()[1:]:
            p = line.split("|")
            if len(p) < 5 or not p[1]:
                continue
            try:
                sv, se, tv = float(p[2]), float(p[3]), float(p[4])
            except ValueError:
                continue
            rows[p[1]] = {
                "short": sv, "short_exempt": se, "total": tv,
                "ratio": round(sv / tv, 4) if tv else None,
            }
        if rows:
            return {"date": d, "market": market, "count": len(rows), "data": rows}
    raise DataNotAvailable(f"no FINRA Reg SHO for {market}")


def short_volume_symbol(query: str, days: int = 10) -> dict:
    info = gstock.resolve_symbol(query)
    if not info or info.get("market") not in ("NASDAQ", "NYSE", "US"):
        return {}
    sym = info["code"].upper()
    out = []
    n = max(3, min(int(days or 10), 30))
    for d in _recent_weekdays(n * 2 + 5):
        if len(out) >= n:
            break
        try:
            snap = short_volume_all(date=d)
        except DataNotAvailable:
            continue
        rec = (snap.get("data") or {}).get(sym)
        if rec:
            out.append({"date": d, **rec})
    if not out:
        return {}
    return {
        "code": info["code"], "name": info["name"], "market": info["market"],
        "note": "short volume != short interest; use for daily trend only",
        "rows": out,
    }


def earnings_calendar(date: str | None = None) -> dict:
    """Nasdaq earnings calendar for one day. date=YYYY-MM-DD, default US/Eastern today."""
    day = date or _et_today()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        return {}
    j = official_get(
        "https://api.nasdaq.com/api/calendar/earnings",
        params={"date": day},
        headers={
            "Accept": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Origin": "https://www.nasdaq.com",
            "Referer": "https://www.nasdaq.com/",
        },
        as_json=True,
    )
    rows = ((j.get("data") or {}).get("rows")) or []
    return {
        "date": day,
        "count": len(rows),
        "rows": [{
            "symbol": r.get("symbol"),
            "name": r.get("name"),
            "time": r.get("time"),
            "eps_forecast": r.get("epsForecast"),
            "market_cap": r.get("marketCap"),
        } for r in rows],
    }


def earnings_calendar_range(
    start: str | None = None,
    days: int = 7,
    *,
    skip_weekends: bool = True,
) -> dict:
    """Upcoming Nasdaq earnings over a date window (per-day API, aggregated).

    start: YYYY-MM-DD (default US/Eastern today).
    days: number of calendar days to cover (1..14); weekends skipped by default.
    """
    n = max(1, min(int(days or 7), 14))
    start_s = start or _et_today()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start_s):
        return {}
    cur = datetime.strptime(start_s, "%Y-%m-%d").date()
    by_day: list[dict] = []
    flat: list[dict] = []
    covered = 0
    guard = 0
    while covered < n and guard < n + 10:
        guard += 1
        if skip_weekends and cur.weekday() >= 5:
            cur += timedelta(days=1)
            continue
        day = cur.strftime("%Y-%m-%d")
        try:
            one = earnings_calendar(day)
        except Exception:
            one = {"date": day, "count": 0, "rows": []}
        rows = one.get("rows") or []
        by_day.append({"date": day, "count": len(rows), "rows": rows})
        for r in rows:
            flat.append({"date": day, **r})
        covered += 1
        cur += timedelta(days=1)
    if not by_day:
        return {}
    return {
        "start": by_day[0]["date"],
        "end": by_day[-1]["date"],
        "days": len(by_day),
        "total": len(flat),
        "by_day": by_day,
        # Backward-compatible single-day fields (first day)
        "date": f"{by_day[0]['date']}~{by_day[-1]['date']}",
        "count": len(flat),
        "rows": flat,
    }


# Display order for the yield curve (skip rarely used 1.5 Month in UI points).
_TREASURY_TENORS = (
    ("1 Mo", "1M"), ("2 Mo", "2M"), ("3 Mo", "3M"), ("4 Mo", "4M"),
    ("6 Mo", "6M"), ("1 Yr", "1Y"), ("2 Yr", "2Y"), ("3 Yr", "3Y"),
    ("5 Yr", "5Y"), ("7 Yr", "7Y"), ("10 Yr", "10Y"), ("20 Yr", "20Y"),
    ("30 Yr", "30Y"),
)


def treasury_yield_curve(year: int | None = None) -> list[dict]:
    """Raw Treasury daily CSV rows (newest first). S-tier government data."""
    year = year or datetime.now().year
    url = (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        f"daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
        f"&field_tdr_date_value={year}&page&_format=csv"
    )
    raw = official_get(url)
    return list(csv.DictReader(io.StringIO(raw)))


def _parse_yield(row: dict, key: str) -> float | None:
    v = row.get(key)
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _norm_treasury_date(s: str) -> str:
    """MM/DD/YYYY -> YYYY-MM-DD."""
    try:
        return datetime.strptime(s.strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
    except Exception:
        return s


def treasury_curve_overview(year: int | None = None) -> dict:
    """Latest US Treasury yield curve (1M~30Y) + key spreads vs prior day."""
    rows = treasury_yield_curve(year)
    if not rows:
        # Jan 1-few days: prior year file may still hold the latest print
        y = year or datetime.now().year
        if y == datetime.now().year:
            rows = treasury_yield_curve(y - 1)
    if not rows:
        return {}
    latest, prev = rows[0], rows[1] if len(rows) > 1 else None
    points = []
    for csv_key, label in _TREASURY_TENORS:
        val = _parse_yield(latest, csv_key)
        if val is None:
            continue
        prev_v = _parse_yield(prev, csv_key) if prev else None
        points.append({
            "tenor": label,
            "yield": val,
            "chg": round(val - prev_v, 2) if prev_v is not None else None,
        })
    y2 = _parse_yield(latest, "2 Yr")
    y10 = _parse_yield(latest, "10 Yr")
    y30 = _parse_yield(latest, "30 Yr")
    y3m = _parse_yield(latest, "3 Mo")
    return {
        "date": _norm_treasury_date(str(latest.get("Date") or "")),
        "prev_date": _norm_treasury_date(str(prev.get("Date") or "")) if prev else None,
        "source": "U.S. Department of the Treasury",
        "compliance": "S",
        "points": points,
        "spreads": {
            "ten_two": round(y10 - y2, 2) if y10 is not None and y2 is not None else None,
            "thirty_ten": round(y30 - y10, 2) if y30 is not None and y10 is not None else None,
            "ten_three_month": round(y10 - y3m, 2) if y10 is not None and y3m is not None else None,
        },
    }


# ── CBOE options (C-tier: personal research only) ─────────────────────────

CBOE_BASE = "https://cdn.cboe.com/api/global/delayed_quotes"
_OSI = re.compile(
    r"^(?P<root>[A-Z][A-Z0-9]*)(?P<y>\d{2})(?P<m>\d{2})(?P<d>\d{2})"
    r"(?P<cp>[CP])(?P<strike>\d{8})$"
)

try:
    from zoneinfo import ZoneInfo
    _ET_TZ = ZoneInfo("America/New_York")
except Exception:
    _ET_TZ = None


def assert_us_ticker(ticker: str) -> str:
    t = str(ticker).strip().upper()
    if t.endswith(".HK") or (t.isdigit() and len(t) in (4, 5)):
        raise ValueError(f"'{ticker}' looks like HK; CBOE options are US-only")
    if not t.replace(".", "").replace("-", "").isalnum():
        raise ValueError(f"invalid ticker: '{ticker}'")
    return t.replace(".", "-")


def parse_osi(symbol: str) -> dict:
    m = _OSI.match(symbol or "")
    if not m:
        return {}
    g = m.groupdict()
    return {
        "expiry": f"20{g['y']}-{g['m']}-{g['d']}",
        "type": "call" if g["cp"] == "C" else "put",
        "strike": int(g["strike"]) / 1000.0,
    }


def _et_today() -> str:
    now = datetime.now(timezone.utc)
    if _ET_TZ is not None:
        return now.astimezone(_ET_TZ).strftime("%Y-%m-%d")
    y = now.year
    mar8 = datetime(y, 3, 8, tzinfo=timezone.utc)
    dst_start = (mar8 + timedelta(days=(6 - mar8.weekday()) % 7)).replace(hour=7)
    nov1 = datetime(y, 11, 1, tzinfo=timezone.utc)
    dst_end = (nov1 + timedelta(days=(6 - nov1.weekday()) % 7)).replace(hour=6)
    offset = 4 if dst_start <= now < dst_end else 5
    return (now - timedelta(hours=offset)).strftime("%Y-%m-%d")


def options_chain_cboe(ticker: str) -> dict:
    """Full delayed CBOE chain. Personal research only (compliance tier C)."""
    ticker = assert_us_ticker(ticker)
    raw = official_get(f"{CBOE_BASE}/options/{ticker}.json", as_json=True)
    data = raw.get("data") or {}
    contracts = []
    for o in data.get("options") or []:
        meta = parse_osi(o.get("option", ""))
        if not meta:
            continue
        contracts.append({
            "symbol": o["option"], **meta,
            "bid": o.get("bid"), "ask": o.get("ask"),
            "volume": o.get("volume") or 0,
            "open_interest": o.get("open_interest") or 0,
            "iv": o.get("iv"), "delta": o.get("delta"), "gamma": o.get("gamma"),
            "vega": o.get("vega"), "theta": o.get("theta"), "rho": o.get("rho"),
            "last_trade_price": o.get("last_trade_price"),
        })
    if not contracts:
        raise DataNotAvailable(
            f"{ticker}: no option contracts (may be unsupported on CBOE)"
        )
    return {
        "ticker": ticker,
        "timestamp": raw.get("timestamp"),
        "spot": data.get("current_price"),
        "contracts": contracts,
    }


def filter_expiry(chain: dict, expiry: str | None = None,
                  dte_max: int | None = None) -> list[dict]:
    cs = chain["contracts"]
    if expiry == "0DTE":
        today = _et_today()
        return [c for c in cs if c["expiry"] == today]
    if expiry:
        return [c for c in cs if c["expiry"] == expiry]
    if dte_max is not None:
        today = datetime.strptime(_et_today(), "%Y-%m-%d")
        return [
            c for c in cs
            if 0 <= (datetime.strptime(c["expiry"], "%Y-%m-%d") - today).days <= dte_max
        ]
    return cs


def unusual_activity(contracts: list[dict], min_volume: int = 500,
                     vol_oi_min: float = 1.0) -> list[dict]:
    out = []
    for c in contracts:
        vol, oi = c["volume"], c["open_interest"]
        if vol < min_volume:
            continue
        ratio = vol / oi if oi > 0 else float("inf")
        if ratio >= vol_oi_min:
            out.append({
                **c,
                "vol_oi_ratio": round(ratio, 2) if oi > 0 else None,
            })
    return sorted(out, key=lambda x: -x["volume"])


def chain_summary(contracts: list[dict]) -> dict:
    calls = [c for c in contracts if c["type"] == "call"]
    puts = [c for c in contracts if c["type"] == "put"]
    cv = sum(c["volume"] for c in calls)
    pv = sum(c["volume"] for c in puts)
    coi = sum(c["open_interest"] for c in calls)
    poi = sum(c["open_interest"] for c in puts)
    traded = [c for c in contracts if c["volume"] > 0 and c.get("iv")]
    tot_v = sum(c["volume"] for c in traded)
    vwiv = sum(c["iv"] * c["volume"] for c in traded) / tot_v if tot_v else None
    net_delta = sum((c.get("delta") or 0) * c["volume"] * 100 for c in contracts)
    return {
        "call_volume": cv,
        "put_volume": pv,
        "put_call_volume_ratio": round(pv / cv, 3) if cv else None,
        "call_oi": coi,
        "put_oi": poi,
        "put_call_oi_ratio": round(poi / coi, 3) if coi else None,
        "volume_weighted_iv": round(vwiv, 4) if vwiv else None,
        "net_delta_exposure_shares": round(net_delta),
        "contracts_total": len(contracts),
        "contracts_traded": len([c for c in contracts if c["volume"] > 0]),
    }


def _slim_contract(c: dict) -> dict:
    return {
        "symbol": c.get("symbol"),
        "expiry": c.get("expiry"),
        "type": c.get("type"),
        "strike": c.get("strike"),
        "bid": c.get("bid"),
        "ask": c.get("ask"),
        "volume": c.get("volume"),
        "open_interest": c.get("open_interest"),
        "iv": c.get("iv"),
        "delta": c.get("delta"),
        "gamma": c.get("gamma"),
        "vega": c.get("vega"),
        "theta": c.get("theta"),
        "last_trade_price": c.get("last_trade_price"),
        "vol_oi_ratio": c.get("vol_oi_ratio"),
    }


def _atm_slice(contracts: list[dict], spot: float | None, n: int = 6) -> list[dict]:
    """Nearest strikes around spot (calls+puts), for a compact ATM view."""
    if not contracts or spot is None:
        return []
    strikes = sorted({c["strike"] for c in contracts if c.get("strike") is not None})
    if not strikes:
        return []
    nearest = sorted(strikes, key=lambda s: abs(s - spot))[: max(1, n)]
    want = set(nearest)
    rows = [c for c in contracts if c.get("strike") in want]
    rows.sort(key=lambda c: (c["strike"], 0 if c["type"] == "call" else 1))
    return [_slim_contract(c) for c in rows]


def options_overview(query: str, unusual_top: int = 15) -> dict:
    """Dashboard-friendly CBOE options package (US only).

    Returns summaries + unusual flow + ATM 0DTE slice; not the full chain
    (thousands of contracts) to keep API payload small.
    """
    info = gstock.resolve_symbol(query)
    if not info or info.get("market") not in ("NASDAQ", "NYSE", "US"):
        return {}
    ticker = assert_us_ticker(info["code"])
    try:
        chain = options_chain_cboe(ticker)
    except DataNotAvailable:
        return {}
    except Exception:
        return {}

    zero = filter_expiry(chain, expiry="0DTE")
    near = filter_expiry(chain, dte_max=7)
    expiries = sorted({c["expiry"] for c in chain["contracts"]})
    top_n = max(5, min(int(unusual_top or 15), 40))

    flow_0dte = [_slim_contract(c) for c in unusual_activity(zero, min_volume=200)[:top_n]]
    flow_near = [_slim_contract(c) for c in unusual_activity(near, min_volume=500)[:top_n]]

    return {
        "code": info["code"],
        "name": info["name"],
        "market": info["market"],
        "ticker": ticker,
        "timestamp": chain.get("timestamp"),
        "spot": chain.get("spot"),
        "et_today": _et_today(),
        "compliance": "C",
        "note": (
            "CBOE delayed quotes; personal research only. "
            "Commercial use requires Cboe license. Not for live trading."
        ),
        "expiries": expiries[:24],
        "summary_all": chain_summary(chain["contracts"]),
        "summary_0dte": chain_summary(zero) if zero else None,
        "summary_7d": chain_summary(near) if near else None,
        "unusual_0dte": flow_0dte,
        "unusual_7d": flow_near,
        "atm_0dte": _atm_slice(zero, chain.get("spot"), n=5),
    }


# ── EDGAR frames screener (S-tier) ────────────────────────────────────────

XBRL_TAGS = {
    "营业收入": "Revenues",
    "营业收入(合同)": "RevenueFromContractWithCustomerExcludingAssessedTax",
    "净利润": "NetIncomeLoss",
    "研发费用": "ResearchAndDevelopmentExpense",
    "毛利": "GrossProfit",
    "经营利润": "OperatingIncomeLoss",
    "总资产": "Assets",
    "股东权益": "StockholdersEquity",
    "现金及等价物": "CashAndCashEquivalentsAtCarryingValue",
    "经营现金流": "NetCashProvidedByUsedInOperatingActivities",
    "资本开支": "PaymentsToAcquirePropertyPlantAndEquipment",
    "长期负债": "LongTermDebtNoncurrent",
    "稀释EPS": "EarningsPerShareDiluted",
}
_INSTANT_TAGS = {
    "Assets",
    "StockholdersEquity",
    "CashAndCashEquivalentsAtCarryingValue",
    "LongTermDebtNoncurrent",
}


def _frame_period(year: int, quarter: int | None, instant: bool) -> str:
    if instant:
        return f"CY{year}Q{quarter}I" if quarter else f"CY{year}Q4I"
    return f"CY{year}Q{quarter}" if quarter else f"CY{year}"


def market_frame(
    tag: str,
    year: int,
    quarter: int | None = None,
    unit: str = "USD",
    instant: bool | None = None,
) -> dict:
    """Full-market XBRL frame. tag: Chinese key or raw us-gaap tag."""
    tag = XBRL_TAGS.get(tag, tag)
    guess = (tag in _INSTANT_TAGS) if instant is None else instant
    attempts = [guess] if instant is not None else [guess, not guess]
    last_err: Exception | None = None
    for is_instant in attempts:
        period = _frame_period(year, quarter, is_instant)
        try:
            j = official_get(
                f"https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/{unit}/{period}.json",
                timeout=45,
                as_json=True,
            )
        except DataNotAvailable as e:
            last_err = e
            continue
        rows = [{
            "cik": d.get("cik"),
            "entity": d.get("entityName"),
            "value": d.get("val"),
            "end": d.get("end"),
        } for d in (j.get("data") or [])]
        return {
            "tag": tag, "period": period, "unit": unit,
            "instant": is_instant, "count": len(rows), "data": rows,
        }
    if last_err:
        raise last_err
    raise DataNotAvailable(f"no frame for {tag} {year} Q{quarter}")


def frame_ranking(frame: dict, top: int = 20, ascending: bool = False) -> list[dict]:
    data = [r for r in (frame.get("data") or []) if r.get("value") is not None]
    return sorted(data, key=lambda x: x["value"], reverse=not ascending)[:top]


def edgar_screener(
    tag: str = "净利润",
    year: int | None = None,
    quarter: int | None = None,
    top: int = 20,
    ascending: bool = False,
) -> dict:
    """Dashboard helper: ranked EDGAR frame + tag catalog."""
    y = int(year or (datetime.now().year - 1))
    q = int(quarter) if quarter is not None else None
    if q is not None and q not in (1, 2, 3, 4):
        q = None
    n = max(5, min(int(top or 20), 50))
    try:
        frame = market_frame(tag, y, q)
    except Exception:
        # Fallback: try prior year annual if quarterly missing
        if q is not None:
            frame = market_frame(tag, y, None)
        else:
            frame = market_frame(tag, y - 1, None)
    ranking = frame_ranking(frame, top=n, ascending=ascending)
    label = next((k for k, v in XBRL_TAGS.items() if v == frame["tag"]), frame["tag"])
    return {
        "compliance": "S",
        "source": "SEC EDGAR frames",
        "tag": frame["tag"],
        "tag_label": label,
        "period": frame["period"],
        "unit": frame["unit"],
        "instant": frame["instant"],
        "universe": frame["count"],
        "ascending": ascending,
        "tags": [{"label": k, "tag": v} for k, v in XBRL_TAGS.items()],
        "rows": ranking,
    }


# ── Market movers (Eastmoney clist) ───────────────────────────────────────

_MKT_FS = {
    "us_nasdaq": "m:105",
    "us_nyse": "m:106",
    "us_etf": "m:107",
    "hk": "m:116",
}


def market_stock_list(
    market: str = "us_nasdaq",
    sort_field: str = "f3",
    sort_desc: bool = True,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """Eastmoney push2 clist ranking (change% / volume / amount).

    Uses fltt=2 (already-scaled floats) and push2 -> push2delay failover.
    """
    fs = _MKT_FS.get(market, market)
    if not fs.startswith("m:"):
        return {}
    fid = sort_field if sort_field in ("f2", "f3", "f5", "f6", "f7") else "f3"
    params = {
        "fs": fs,
        "fields": "f2,f3,f4,f5,f6,f7,f12,f14",
        "pn": max(1, int(page or 1)),
        "pz": max(5, min(int(page_size or 20), 50)),
        "fid": fid,
        "po": 1 if sort_desc else 0,
        "np": 1,
        "fltt": 2,
        "invt": 2,
    }
    data: dict = {}
    for host in ("push2.eastmoney.com", "push2delay.eastmoney.com"):
        try:
            r = astock.em_get(
                f"https://{host}/api/qt/clist/get",
                params=params,
                headers={"User-Agent": _UA},
                timeout=15,
            )
            data = (r.json() or {}).get("data") or {}
            if data.get("diff"):
                break
        except Exception:
            continue
    diff = data.get("diff") or []
    if isinstance(diff, dict):
        diff = list(diff.values())

    def _num(v):
        return float(v) if isinstance(v, (int, float)) else None

    stocks = []
    for item in diff:
        if not isinstance(item, dict):
            continue
        chg = _num(item.get("f3"))
        amp = _num(item.get("f7"))
        stocks.append({
            "code": item.get("f12"),
            "name": item.get("f14"),
            "price": _num(item.get("f2")),
            "change_pct": round(chg, 2) if chg is not None else None,
            "volume": _num(item.get("f5")),
            "amount": _num(item.get("f6")),
            "amplitude": round(amp, 2) if amp is not None else None,
        })
    return {
        "market": market,
        "sort_field": fid,
        "sort_desc": sort_desc,
        "total": data.get("total") or len(stocks),
        "stocks": stocks,
    }


def market_movers(board: str = "us_gainers", top: int = 20) -> dict:
    """Convenience boards for US/HK movers."""
    n = max(5, min(int(top or 20), 50))
    presets = {
        "us_gainers": ("us_nasdaq", "f3", True),
        "us_losers": ("us_nasdaq", "f3", False),
        "us_amount": ("us_nasdaq", "f6", True),
        "hk_gainers": ("hk", "f3", True),
        "hk_losers": ("hk", "f3", False),
        "hk_amount": ("hk", "f6", True),
    }
    if board not in presets:
        board = "us_gainers"
    market, fid, desc = presets[board]
    data = market_stock_list(market, fid, desc, page=1, page_size=n)
    data["board"] = board
    return data


def short_volume_ranking_overview(
    top: int = 20,
    min_total: float = 1_000_000,
) -> dict:
    """FINRA CNMS short-ratio leaders for the latest available day."""
    snap = short_volume_all()
    rows = short_volume_ranking(snap, min_total=min_total, top=top)
    return {
        "date": snap.get("date"),
        "market": snap.get("market"),
        "universe": snap.get("count"),
        "min_total": min_total,
        "note": "short volume != short interest; daily flow only",
        "rows": rows,
    }


def short_volume_ranking(
    snapshot: dict,
    min_total: float = 1_000_000,
    top: int = 20,
) -> list[dict]:
    rows = [{
        "symbol": s, **v,
    } for s, v in (snapshot.get("data") or {}).items()
        if v.get("total", 0) >= min_total and v.get("ratio") is not None]
    return sorted(rows, key=lambda x: -x["ratio"])[: max(1, min(int(top or 20), 50))]
