"""Yahoo Finance helpers: news / valuation / analyst / holders."""
from __future__ import annotations

import threading
from typing import Any

import requests

import gstock
from gstock_deep.common import DataNotAvailable, _YAHOO_UA

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

