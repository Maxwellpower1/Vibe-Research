"""A-share earnings window: disclosure calendar, forecasts, profit ranks, company F10.

Ported from marketingdashboard eastmoney-fin (datacenter). Combined with
local financials / valuation / announcements / reports / live industry tape.
Objective snapshots only; no recommendation.
"""

from __future__ import annotations

import re
from datetime import date

import astock

UA = astock.UA
em_get = astock.em_get
_DC = "https://datacenter-web.eastmoney.com/api/data/v1/get"
_SEC = "https://datacenter.eastmoney.com/securities/api/data/v1/get"

FORECAST_TYPES = ("预增", "预减", "扭亏", "首亏", "略增", "略减", "减亏", "增亏")
FORECAST_GOOD = {"预增", "略增", "扭亏", "减亏"}
FORECAST_BAD = {"预减", "略减", "首亏", "增亏"}


def _num(v) -> float:
    try:
        if v is None or v == "" or v == "-":
            return 0.0
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def default_report_period(today: date | None = None) -> str:
    """Nearest report date by calendar month (same rule as marketingdashboard)."""
    d = today or date.today()
    y, m = d.year, d.month
    if m <= 3:
        return f"{y - 1}-09-30"
    if m <= 6:
        return f"{y}-03-31"
    if m <= 9:
        return f"{y}-06-30"
    return f"{y}-09-30"


def prev_report_period(period: str) -> str:
    y = period[:4]
    md = period[4:]
    prev_md = {
        "-03-31": "-12-31",
        "-06-30": "-03-31",
        "-09-30": "-06-30",
        "-12-31": "-09-30",
    }
    if md == "-03-31":
        return f"{int(y) - 1}-12-31"
    return f"{y}{prev_md.get(md, '-09-30')}"


def valid_period(raw: str | None) -> str:
    s = (raw or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    return default_report_period()


def secu_code(raw: str) -> str | None:
    """sh600519 / 600519 -> 600519.SH."""
    m = re.fullmatch(r"(?:(sh|sz|bj|nq))?(\d{6})", (raw or "").strip().lower())
    if not m:
        return None
    prefix, code = m.group(1), m.group(2)
    if prefix == "nq":
        ex = "BJ"
    elif prefix:
        ex = prefix.upper()
    else:
        ex = astock.get_prefix(code).upper()
    return f"{code}.{ex}"


def bare_code(raw: str) -> str:
    m = re.search(r"(\d{6})", raw or "")
    return m.group(1) if m else ""


def classify_forecast(typ: str, content: str = "") -> str:
    t = (typ or "").strip()
    if t in FORECAST_TYPES or t in ("续盈", "续亏", "不确定"):
        return t or "不确定"
    for name in FORECAST_TYPES:
        if name in (content or ""):
            return name
    return "不确定"


def forecast_bucket(typ: str) -> str:
    if typ in FORECAST_GOOD:
        return "good"
    if typ in FORECAST_BAD:
        return "bad"
    return "neutral"


def _dc_result(
    report_name: str,
    filter_str: str,
    page_size: int,
    sort_columns: str,
    *,
    source: str = "WEB",
    url: str = _DC,
) -> dict:
    params = {
        "reportName": report_name,
        "columns": "ALL",
        "filter": filter_str,
        "pageNumber": "1",
        "pageSize": str(page_size),
        "sortColumns": sort_columns,
        "sortTypes": "-1",
        "source": source,
        "client": "WEB" if source == "WEB" else "PC",
    }
    try:
        d = em_get(
            url,
            params=params,
            headers={"User-Agent": UA, "Referer": "https://data.eastmoney.com/"},
            timeout=18,
        ).json()
    except Exception:
        return {}
    return (d or {}).get("result") or {}


def _dc_rows(*args, **kwargs) -> list[dict]:
    data = _dc_result(*args, **kwargs).get("data") or []
    return data if isinstance(data, list) else []


def finance_board(period: str | None = None) -> dict:
    """Stock profit TOP + industry aggregates + disclosure calendar + live tape."""
    p = valid_period(period)
    filt = f"(REPORTDATE='{p}')"
    stock_rows = _dc_rows("RPT_LICO_FN_CPD", filt, 200, "PARENT_NETPROFIT")
    cal_rows = _dc_rows("RPT_LICO_FN_CPD", filt, 80, "NOTICE_DATE")
    pages = _dc_result("RPT_LICO_FN_CPD", filt, 1, "NOTICE_DATE").get("pages") or 0

    stocks = []
    for r in stock_rows:
        if not isinstance(r, dict) or not r.get("BOARD_NAME"):
            continue
        stocks.append({
            "code": r.get("SECURITY_CODE") or "",
            "name": r.get("SECURITY_NAME_ABBR") or "",
            "industry": r.get("BOARD_NAME") or "",
            "net_profit": _num(r.get("PARENT_NETPROFIT")),
            "profit_yoy": _num(r.get("SJLTZ")),
            "revenue_yoy": _num(r.get("YSTZ")),
            "roe": _num(r.get("WEIGHTAVG_ROE")),
            "eps": _num(r.get("BASIC_EPS")),
        })

    agg: dict[str, dict] = {}
    for s in stocks:
        k = s["industry"] or "其他"
        a = agg.setdefault(k, {"name": k, "net_profit": 0.0, "count": 0, "yoy_sum": 0.0, "yoy_n": 0})
        a["net_profit"] += s["net_profit"]
        a["count"] += 1
        if s["profit_yoy"]:
            a["yoy_sum"] += s["profit_yoy"]
            a["yoy_n"] += 1
    industries = sorted(agg.values(), key=lambda x: x["net_profit"], reverse=True)[:15]
    industries = [
        {
            "name": a["name"],
            "net_profit": a["net_profit"],
            "count": a["count"],
            "yoy": round(a["yoy_sum"] / a["yoy_n"], 2) if a["yoy_n"] else 0.0,
        }
        for a in industries
    ]

    calendar = []
    for r in cal_rows:
        if not isinstance(r, dict):
            continue
        calendar.append({
            "date": str(r.get("NOTICE_DATE") or "")[:10],
            "code": r.get("SECURITY_CODE") or "",
            "name": r.get("SECURITY_NAME_ABBR") or "",
            "period": r.get("QDATE") or "",
        })

    tape = {"top": [], "bottom": [], "total": 0}
    try:
        tape = astock.industry_comparison(15)
    except Exception:
        pass

    return {
        "period": p,
        "disclosed": int(pages) if pages else len(stocks),
        "stocks": stocks,
        "industries": industries,
        "calendar": calendar,
        "sector_tape": tape,
        "note": "公开披露/盈利榜,东财口径,仅客观呈现",
    }


def finance_forecast(period: str | None = None) -> dict:
    """Earnings pre-announcements for a report period."""
    p = valid_period(period)
    rows = _dc_rows(
        "RPT_PUBLIC_OP_PREDICT",
        f"(REPORTDATE='{p}')",
        80,
        "NOTICE_DATE",
    )
    items = []
    stats = {"good": 0, "bad": 0, "neutral": 0}
    for r in rows:
        if not isinstance(r, dict):
            continue
        typ = classify_forecast(str(r.get("FORECASTTYPE") or ""), str(r.get("FORECASTCONTENT") or ""))
        bucket = forecast_bucket(typ)
        stats[bucket] += 1
        items.append({
            "date": str(r.get("NOTICE_DATE") or "")[:10],
            "code": r.get("SECURITY_CODE") or "",
            "name": r.get("SECURITY_NAME_ABBR") or "",
            "type": typ,
            "profit_low": _num(r.get("FORECASTL")),
            "profit_high": _num(r.get("FORECASTT")),
            "yoy_low": _num(r.get("INCREASEL")),
            "yoy_high": _num(r.get("INCREASET")),
        })
    return {"period": p, "stats": stats, "items": items}


def finance_main(code: str) -> dict:
    """Last 12 F10 periods (revenue / profit / ROE / margins)."""
    secu = secu_code(code)
    if not secu:
        raise ValueError(f"bad code: {code}")
    filt = f'(SECUCODE="{secu}")'
    fin_rows = _dc_rows(
        "RPT_F10_FINANCE_MAINFINADATA",
        filt,
        12,
        "REPORT_DATE",
        source="HSF10",
        url=_SEC,
    )
    org_rows = _dc_rows(
        "RPT_F10_ORG_BASICINFO",
        filt,
        1,
        "SECUCODE",
        source="HSF10",
        url=_SEC,
    )
    org = org_rows[0] if org_rows else {}
    industry = (
        org.get("BOARD_NAME_2LEVEL")
        or org.get("BOARD_NAME_1LEVEL")
        or org.get("BOARD_NAME_3LEVEL")
        or org.get("CSRC_INDUSTRY_NAME")
        or ""
    )
    reports = []
    for r in fin_rows:
        if not isinstance(r, dict):
            continue
        reports.append({
            "label": r.get("REPORT_DATE_NAME") or "",
            "date": str(r.get("REPORT_DATE") or "")[:10],
            "revenue": _num(r.get("TOTALOPERATEREVE")),
            "net_profit": _num(r.get("PARENTNETPROFIT")),
            "revenue_yoy": _num(r.get("TOTALOPERATEREVETZ")),
            "profit_yoy": _num(r.get("PARENTNETPROFITTZ")),
            "roe": _num(r.get("ROEJQ")),
            "gross_margin": _num(r.get("XSMLL")),
            "net_margin": _num(r.get("XSJLL")),
            "debt_ratio": _num(r.get("ZCFZL")),
            "eps": _num(r.get("EPSJB")),
            "ocf_ps": _num(r.get("MGJYXJJE")),
        })
    name = (fin_rows[0].get("SECURITY_NAME_ABBR") if fin_rows else "") or ""
    return {
        "code": bare_code(code),
        "name": name,
        "industry": industry,
        "reports": reports,
    }


def _safe(fn, fallback):
    try:
        return fn()
    except Exception:
        return fallback


def company_bundle(code: str) -> dict:
    """F10 trend + local snapshot / valuation / filings / reports."""
    raw = bare_code(code)
    if not raw:
        raise ValueError(f"bad code: {code}")
    main = finance_main(raw)
    if not main.get("name"):
        q = astock.tencent_quote([raw]).get(raw) or {}
        main["name"] = q.get("name") or raw
    snapshot = _safe(lambda: astock.financials(raw), None)
    valuation = _safe(lambda: astock.full_valuation(raw), None)
    percentile = _safe(lambda: astock.valuation_percentile(raw), None)
    anns = _safe(lambda: astock.announcements(raw, limit=6), [])
    reports = _safe(lambda: astock.eastmoney_reports(raw, max_pages=1), [])
    slim_reports = []
    for r in reports[:4]:
        if not isinstance(r, dict):
            continue
        slim_reports.append({
            "title": r.get("title") or "",
            "publishDate": r.get("publishDate") or r.get("publish_date") or "",
            "orgSName": r.get("orgSName") or r.get("orgSname") or "",
            "pdfUrl": astock.pdf_url(r.get("infoCode", "")) if r.get("infoCode") else None,
        })
    return {
        "main": main,
        "snapshot": snapshot,
        "valuation": valuation,
        "percentile": percentile,
        "announcements": anns[:6] if isinstance(anns, list) else [],
        "reports": slim_reports,
    }


def suggest_ashare(q: str, n: int = 8) -> list[dict]:
    """Eastmoney suggest, A-share only."""
    q = (q or "").strip()
    if not q:
        return []
    params = {
        "input": q,
        "type": 14,
        "token": "D43BF722C8E33BDC906FB84D85E326E8",
        "count": 10,
    }
    try:
        r = em_get(
            "https://searchapi.eastmoney.com/api/suggest/get",
            params=params,
            headers={"User-Agent": UA},
            timeout=8,
        )
        payload = r.json() or {}
    except Exception:
        return []
    rows = ((payload.get("QuotationCodeTable") or {}).get("Data")) or []
    out = []
    for it in rows:
        if not isinstance(it, dict):
            continue
        code = str(it.get("Code") or "")
        if not re.fullmatch(r"\d{6}", code):
            continue
        mkt = str(it.get("MktNum") or "")
        if mkt not in ("1", "0", "90", "105"):  # SH / SZ / BJ-ish
            # still accept 6-digit A-share codes
            if not code.startswith(("6", "0", "3", "8", "9", "2")):
                continue
        out.append({"code": code, "name": it.get("Name") or code})
        if len(out) >= n:
            break
    return out
