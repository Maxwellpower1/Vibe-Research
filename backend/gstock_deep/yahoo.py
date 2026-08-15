"""Yahoo Finance helpers: news / valuation / analyst / holders."""
from __future__ import annotations

import re
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from xml.etree import ElementTree as ET

import requests

import astock
import gstock
from gstock_deep.common import DataNotAvailable, _YAHOO_UA

_yahoo_session: requests.Session | None = None
_yahoo_lock = threading.Lock()
# After a 401/403, skip Yahoo crumb APIs for a while (RSS / Eastmoney still work).
_YAHOO_DOWN_SEC = 15 * 60
_yahoo_down_until = 0.0


def _yahoo_marked_down() -> bool:
    return time.monotonic() < _yahoo_down_until


def _mark_yahoo_down() -> None:
    global _yahoo_down_until
    _yahoo_down_until = time.monotonic() + _YAHOO_DOWN_SEC


def _clear_yahoo_down() -> None:
    global _yahoo_down_until
    _yahoo_down_until = 0.0


def _is_yahoo_block(exc: BaseException) -> bool:
    resp = getattr(exc, "response", None)
    status = getattr(resp, "status_code", None)
    if status in (401, 403):
        return True
    s = str(exc).lower()
    return "401" in s or "403" in s or "unauthorized" in s


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


def _reset_yahoo_session() -> None:
    global _yahoo_session
    with _yahoo_lock:
        _yahoo_session = None


def _yahoo_quote_summary(symbol: str, modules: list[str]) -> dict:
    """quoteSummary: query2 then query1. Latch process-wide after 401/403."""
    if _yahoo_marked_down():
        raise RuntimeError("403 latched")
    try:
        s = _get_yahoo_session()
        crumb = getattr(s, "_crumb", "")
    except Exception as e:
        if _is_yahoo_block(e):
            _mark_yahoo_down()
        _reset_yahoo_session()
        raise
    last_err: Exception | None = None
    params = {"modules": ",".join(modules), "crumb": crumb}
    for host in ("query2", "query1"):
        try:
            r = s.get(
                f"https://{host}.finance.yahoo.com/v10/finance/quoteSummary/{symbol}",
                params=params,
                timeout=15,
            )
            r.raise_for_status()
            results = (r.json().get("quoteSummary") or {}).get("result") or [{}]
            return results[0] if results else {}
        except Exception as e:
            last_err = e
            continue
    if last_err and _is_yahoo_block(last_err):
        _mark_yahoo_down()
        _reset_yahoo_session()
        raise last_err
    if last_err:
        raise last_err
    return {}


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


def _items_from_yahoo_search(news: list) -> list[dict]:
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
    return items


def _news_from_rss(ysym: str, n: int) -> list[dict]:
    """Headline RSS does not need a Yahoo crumb (search API often 403s)."""
    r = requests.get(
        "https://feeds.finance.yahoo.com/rss/2.0/headline",
        params={"s": ysym, "region": "US", "lang": "en-US"},
        headers={"User-Agent": _YAHOO_UA},
        timeout=12,
    )
    r.raise_for_status()
    root = ET.fromstring(r.content)
    items: list[dict] = []
    for it in root.findall(".//item"):
        title = (it.findtext("title") or "").strip()
        if not title:
            continue
        pub_raw = (it.findtext("pubDate") or "").strip()
        src = it.find("source")
        publisher = ((src.text if src is not None else None) or it.findtext("author") or "").strip() or None
        pub = None
        ts = None
        if pub_raw:
            try:
                dt = parsedate_to_datetime(pub_raw)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                pub = dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
                ts = int(dt.timestamp())
            except (TypeError, ValueError, OverflowError, OSError):
                pub = pub_raw
        items.append({
            "title": title,
            "publisher": publisher,
            "link": (it.findtext("link") or "").strip() or None,
            "publish_time": pub,
            "publish_ts": ts,
            "thumbnail": None,
        })
        if len(items) >= n:
            break
    return items


def stock_news(keyword: str, count: int = 10) -> dict:
    """Yahoo Finance news by ticker/keyword (compliance C).

    Search API needs a crumb and is often 403; RSS headline is the fallback.
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

    raw: list = []
    search_err: Exception | None = None
    if _yahoo_marked_down():
        raw = []
    else:
        try:
            raw = _fetch(_get_yahoo_session())
        except Exception as e:
            search_err = e
            if _is_yahoo_block(e):
                _mark_yahoo_down()
            _reset_yahoo_session()
            try:
                if not _yahoo_marked_down():
                    raw = _fetch(_get_yahoo_session())
                    search_err = None
                else:
                    raw = []
            except Exception as e2:
                search_err = e2
                if _is_yahoo_block(e2):
                    _mark_yahoo_down()
                raw = []

    items = _items_from_yahoo_search(raw)
    source = "Yahoo Finance search"
    if not items:
        try:
            items = _news_from_rss(ysym, n)
            if items:
                source = "Yahoo Finance RSS"
        except Exception as e:
            if search_err is not None:
                raise search_err from e
            raise

    return {
        "code": code,
        "name": name,
        "market": market,
        "yahoo_symbol": ysym,
        "compliance": "C",
        "source": source,
        "items": items,
    }


# ── Valuation / analyst / holders (Yahoo, Eastmoney PE/PB fallback) ───────

_VAL_CORE = (
    "trailing_pe", "forward_pe", "peg_ratio", "price_to_book",
    "market_cap", "current_price", "return_on_equity", "gross_margin",
    "target_mean", "beta",
)


def _valuation_has_core(d: dict) -> bool:
    return any(d.get(k) is not None for k in _VAL_CORE)


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    x = float(v)
    if x != x:  # NaN
        return None
    return x


def _sane_mult(v: Any, hi: float = 5000.0) -> float | None:
    x = _num(v)
    if x is None or x <= 0 or x > hi:
        return None
    return x


def _pct_to_ratio(v: Any) -> float | None:
    """Eastmoney GMAININDICATOR stores 46.2 for 46.2%. Yahoo uses 0.462."""
    x = _num(v)
    if x is None:
        return None
    return x / 100.0


def _empty_valuation(info: dict, ysym: str) -> dict:
    return {
        "code": info["code"],
        "name": info["name"],
        "market": info["market"],
        "yahoo_symbol": ysym,
        "current_price": None,
        "target_high": None,
        "target_low": None,
        "target_mean": None,
        "recommendation": None,
        "trailing_pe": None,
        "forward_pe": None,
        "peg_ratio": None,
        "price_to_book": None,
        "enterprise_value": None,
        "ev_to_ebitda": None,
        "ev_to_revenue": None,
        "profit_margin": None,
        "operating_margin": None,
        "gross_margin": None,
        "return_on_equity": None,
        "return_on_assets": None,
        "earnings_growth": None,
        "revenue_growth": None,
        "beta": None,
        "short_ratio": None,
        "dividend_yield": None,
        "payout_ratio": None,
        "market_cap": None,
        "total_revenue": None,
        "total_cash": None,
        "total_debt": None,
    }


def _map_quote_summary(info: dict, ysym: str, data: dict) -> dict:
    fd = data.get("financialData") or {}
    ks = data.get("defaultKeyStatistics") or {}
    sd = data.get("summaryDetail") or {}
    out = _empty_valuation(info, ysym)
    out.update({
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
        "source": "yahoo",
    })
    return out


def _yahoo_v7_quote_row(ysym: str) -> dict:
    """v7 quote often survives when quoteSummary crumb is 403."""
    last_err: Exception | None = None
    try:
        s = _get_yahoo_session()
        r = s.get(
            "https://query1.finance.yahoo.com/v7/finance/quote",
            params={"symbols": ysym, "crumb": getattr(s, "_crumb", "")},
            timeout=12,
        )
        r.raise_for_status()
        rows = ((r.json().get("quoteResponse") or {}).get("result") or [])
        if rows:
            return rows[0]
    except Exception as e:
        last_err = e
        _reset_yahoo_session()
    for host in ("query1", "query2"):
        try:
            r = requests.get(
                f"https://{host}.finance.yahoo.com/v7/finance/quote",
                params={"symbols": ysym},
                headers={"User-Agent": _YAHOO_UA},
                timeout=12,
            )
            r.raise_for_status()
            rows = ((r.json().get("quoteResponse") or {}).get("result") or [])
            if rows:
                return rows[0]
        except Exception as e:
            last_err = e
            continue
    if last_err:
        raise last_err
    return {}


def _map_v7_quote(info: dict, ysym: str, row: dict) -> dict:
    out = _empty_valuation(info, ysym)
    out.update({
        "current_price": _num(row.get("regularMarketPrice")),
        "target_mean": _num(row.get("targetMeanPrice")),
        "trailing_pe": _sane_mult(row.get("trailingPE")),
        "forward_pe": _sane_mult(row.get("forwardPE")),
        "price_to_book": _sane_mult(row.get("priceToBook")),
        "market_cap": _num(row.get("marketCap")),
        "dividend_yield": _num(row.get("dividendYield") or row.get("trailingAnnualDividendYield")),
        "beta": _num(row.get("beta")),
        "profit_margin": _num(row.get("profitMargins")),
        "source": "yahoo_quote",
    })
    return out


def _em_push2_val(info: dict) -> dict:
    prefix = info.get("secid_prefix")
    code = info.get("code")
    if prefix is None or not code:
        return {}
    params = {
        "secid": f"{prefix}.{code}",
        "fields": "f9,f23,f43,f57,f58,f59,f115,f116",
        "fltt": "2",
    }
    for host in ("push2.eastmoney.com", "push2delay.eastmoney.com"):
        try:
            r = astock.em_get(
                f"https://{host}/api/qt/stock/get",
                params=params,
                headers={"User-Agent": astock.UA},
                timeout=10,
            )
            d = (r.json() or {}).get("data")
            if isinstance(d, dict) and d:
                return d
        except Exception:
            continue
    return {}


def _em_gmain_row(info: dict) -> dict:
    secucode = info.get("secucode")
    if not secucode:
        return {}
    market = "HK" if str(secucode).endswith(".HK") else "US"
    rows = astock.eastmoney_datacenter(
        f"RPT_{market}F10_FN_GMAININDICATOR",
        filter_str=f'(SECUCODE="{secucode}")',
        page_size=1,
        sort_columns="REPORT_DATE",
        sort_types="-1",
    )
    return rows[0] if rows else {}


def _em_valuation_fallback(info: dict, ysym: str) -> dict:
    """PE/PB from Eastmoney quote; margins/ROE from GMAININDICATOR.

    Do not map revenue / net profit onto trailing_pe -- those are statement lines.
    """
    out = _empty_valuation(info, ysym)
    snap = _em_push2_val(info)
    row = _em_gmain_row(info)
    price = _num(snap.get("f43"))
    pe_ttm = _sane_mult(snap.get("f115"))
    pe_dyn = _sane_mult(snap.get("f9"))
    pb = _sane_mult(snap.get("f23"), hi=1000.0)
    if pe_ttm is None and pe_dyn is not None:
        pe_ttm = pe_dyn
        pe_dyn = None
    eps = _num(row.get("BASIC_EPS") or row.get("DILUTED_EPS"))
    if pe_ttm is None and price and eps and eps > 0:
        pe_ttm = round(price / eps, 4)
    bps = _num(row.get("BPS") or row.get("BPS_HKD"))
    if pb is None and price and bps and bps > 0:
        pb = round(price / bps, 4)
    out.update({
        "current_price": price,
        "trailing_pe": pe_ttm,
        "forward_pe": pe_dyn,
        "price_to_book": pb,
        "market_cap": _num(snap.get("f116")),
        "gross_margin": _pct_to_ratio(row.get("GROSS_PROFIT_RATIO")),
        "profit_margin": _pct_to_ratio(row.get("NET_PROFIT_RATIO")),
        "return_on_equity": _pct_to_ratio(row.get("ROE_AVG")),
        "return_on_assets": _pct_to_ratio(row.get("ROA")),
        "revenue_growth": _pct_to_ratio(row.get("OPERATE_INCOME_YOY")),
        "earnings_growth": _pct_to_ratio(row.get("BASIC_EPS_YOY")),
        "dividend_yield": _pct_to_ratio(row.get("DIVI_RATIO")),
        "source": "eastmoney",
    })
    return out


def key_statistics(query: str) -> dict:
    """PE/PB/PEG/target/beta. Yahoo quoteSummary, then v7 quote, then Eastmoney."""
    hit = _resolve_yahoo(query)
    if not hit:
        return {}
    info, ysym = hit
    if not _yahoo_marked_down():
        try:
            data = _yahoo_quote_summary(
                ysym, ["financialData", "defaultKeyStatistics", "summaryDetail"]
            )
            out = _map_quote_summary(info, ysym, data)
            if _valuation_has_core(out):
                return out
        except Exception:
            pass
        try:
            row = _yahoo_v7_quote_row(ysym)
            out = _map_v7_quote(info, ysym, row)
            if _valuation_has_core(out):
                return out
        except Exception as e:
            if _is_yahoo_block(e):
                _mark_yahoo_down()
    out = _em_valuation_fallback(info, ysym)
    if _valuation_has_core(out):
        return out
    return {}


def _map_analyst(info: dict, data: dict) -> dict:
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


def _map_holders(info: dict, data: dict) -> dict:
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


def analyst_estimates(query: str) -> dict:
    hit = _resolve_yahoo(query)
    if not hit or _yahoo_marked_down():
        return {}
    info, ysym = hit
    try:
        data = _yahoo_quote_summary(ysym, [
            "earningsTrend", "recommendationTrend", "upgradeDowngradeHistory",
        ])
    except Exception:
        return {}
    return _map_analyst(info, data)


def institutional_holders(query: str) -> dict:
    hit = _resolve_yahoo(query)
    if not hit or _yahoo_marked_down():
        return {}
    info, ysym = hit
    try:
        data = _yahoo_quote_summary(ysym, ["institutionOwnership", "majorHoldersBreakdown"])
    except Exception:
        return {}
    return _map_holders(info, data)


_FUND_MODULES = [
    "financialData", "defaultKeyStatistics", "summaryDetail",
    "earningsTrend", "recommendationTrend", "upgradeDowngradeHistory",
    "institutionOwnership", "majorHoldersBreakdown",
]


def stock_fundamentals(query: str) -> dict:
    """Bundle valuation + analyst + holders. One quoteSummary when Yahoo is up."""
    info = gstock.resolve_symbol(query)
    if not info:
        return {}
    if info.get("market") == "KR":
        return {"code": info["code"], "name": info["name"], "market": "KR",
                "valuation": None, "analyst": None, "holders": None,
                "note": "韩股暂无 Yahoo 基本面"}
    ysym = to_yahoo_symbol(info) or str(info.get("code") or "")
    val: dict = {}
    ana: dict = {}
    hold: dict = {}
    src: str | None = None
    if ysym and not _yahoo_marked_down():
        try:
            data = _yahoo_quote_summary(ysym, _FUND_MODULES)
            val = _map_quote_summary(info, ysym, data)
            ana = _map_analyst(info, data)
            hold = _map_holders(info, data)
            if _valuation_has_core(val):
                src = "yahoo"
        except Exception:
            val, ana, hold = {}, {}, {}
        if not _valuation_has_core(val) and not _yahoo_marked_down():
            try:
                row = _yahoo_v7_quote_row(ysym)
                val = _map_v7_quote(info, ysym, row)
                if _valuation_has_core(val):
                    src = "yahoo_quote"
                    ana, hold = {}, {}
            except Exception as e:
                if _is_yahoo_block(e):
                    _mark_yahoo_down()
    if not _valuation_has_core(val):
        val = _em_valuation_fallback(info, ysym)
        src = "eastmoney" if _valuation_has_core(val) else None
        ana, hold = {}, {}
    return {
        "code": info["code"],
        "name": info["name"],
        "market": info["market"],
        "source": src,
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

