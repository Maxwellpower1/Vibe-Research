"""A-share earnings window: disclosure calendar, forecasts, profit ranks, company F10.

Ported from marketingdashboard eastmoney-fin. Parallel HTTP.
Objective snapshots only; no recommendation.
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any

import astock

UA = astock.UA
_DC = "https://datacenter-web.eastmoney.com/api/data/v1/get"
_SEC = "https://datacenter.eastmoney.com/securities/api/data/v1/get"
_EMWEB = "https://emweb.securities.eastmoney.com"

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


def _http_get(
    url: str,
    params: dict | None = None,
    *,
    timeout: int = 18,
    referer: str = "https://data.eastmoney.com/",
) -> Any:
    """Fin-window HTTP. Own session, parallel like marketingdashboard."""
    import requests

    r = requests.get(
        url,
        params=params,
        headers={"User-Agent": UA, "Referer": referer, "Accept": "application/json,text/plain,*/*"},
        timeout=timeout,
    )
    r.raise_for_status()
    return r


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
        d = _http_get(url, params).json()
    except Exception:
        return {}
    return (d or {}).get("result") or {}


def _dc_rows(*args, **kwargs) -> list[dict]:
    data = _dc_result(*args, **kwargs).get("data") or []
    return data if isinstance(data, list) else []


def finance_board(period: str | None = None) -> dict:
    """Stock profit TOP300 + industry from 500 rows + calendar 60. Four parallel GETs."""
    p = valid_period(period)
    filt = f"(REPORTDATE='{p}')"
    with ThreadPoolExecutor(max_workers=4) as pool:
        stock_f = pool.submit(_dc_rows, "RPT_LICO_FN_CPD", filt, 300, "PARENT_NETPROFIT")
        ind_f = pool.submit(_dc_rows, "RPT_LICO_FN_CPD", filt, 500, "PARENT_NETPROFIT")
        cal_f = pool.submit(_dc_rows, "RPT_LICO_FN_CPD", filt, 60, "NOTICE_DATE")
        pages_f = pool.submit(_dc_result, "RPT_LICO_FN_CPD", filt, 1, "NOTICE_DATE")
        stock_rows = stock_f.result()
        ind_rows = ind_f.result()
        cal_rows = cal_f.result()
        pages = (pages_f.result() or {}).get("pages") or 0

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
    for r in ind_rows:
        if not isinstance(r, dict):
            continue
        k = r.get("BOARD_NAME") or "其他"
        a = agg.setdefault(k, {"name": k, "net_profit": 0.0, "count": 0, "yoy_sum": 0.0, "yoy_n": 0})
        a["net_profit"] += _num(r.get("PARENT_NETPROFIT"))
        a["count"] += 1
        yoy = _num(r.get("SJLTZ"))
        if yoy:
            a["yoy_sum"] += yoy
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

    return {
        "period": p,
        "disclosed": int(pages) if pages else len(stocks),
        "stocks": stocks,
        "industries": industries,
        "calendar": calendar,
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


def _f10_rows(report_name: str, filt: str, page_size: int, sort_columns: str) -> list[dict]:
    """HSF10 securities API first; fall back to datacenter-web if empty."""
    rows = _dc_rows(report_name, filt, page_size, sort_columns, source="HSF10", url=_SEC)
    if rows:
        return rows
    return _dc_rows(report_name, filt, page_size, sort_columns, source="WEB", url=_DC)


def _pick_segments(rows: list[dict], cap: int) -> list[dict]:
    """Prefer product MAINOP_TYPE=2, else industry=1. Top cap by income."""
    def is_type(r: dict, t: int) -> bool:
        try:
            return int(float(r.get("MAINOP_TYPE") or 0)) == t
        except (TypeError, ValueError):
            return False

    typed = [r for r in rows if is_type(r, 2)] or [r for r in rows if is_type(r, 1)]
    typed.sort(key=lambda r: _num(r.get("MAIN_BUSINESS_INCOME")), reverse=True)
    out = []
    for r in typed[:cap]:
        out.append({
            "name": r.get("ITEM_NAME") or "",
            "income": _num(r.get("MAIN_BUSINESS_INCOME")),
            "income_ratio": _num(r.get("MBI_RATIO")),
            "profit": _num(r.get("MAIN_BUSINESS_RPOFIT")),
            "profit_ratio": _num(r.get("MBR_RATIO")),
            "margin": _num(r.get("GROSS_RPOFIT_RATIO")),
        })
    return out


def _emweb_json(url: str) -> dict | None:
    try:
        return _http_get(url, timeout=12, referer=f"{_EMWEB}/").json()
    except Exception:
        return None


def _emweb_extras(secu: str, latest_date: str) -> dict:
    """Mainop / balance / cash from emweb F10. Failures stay empty."""
    empty = {"mainop": [], "mainop_history": [], "balance": {}, "cash": {}}
    if not latest_date or not secu or "." not in secu:
        return empty
    code, ex = secu.split(".", 1)
    em_code = f"{ex}{code}"
    with ThreadPoolExecutor(max_workers=3) as pool:
        op_f = pool.submit(
            _emweb_json,
            f"{_EMWEB}/PC_HSF10/BusinessAnalysis/PageAjax?code={em_code}",
        )
        zc_f = pool.submit(
            _emweb_json,
            f"{_EMWEB}/PC_HSF10/NewFinanceAnalysis/zcfzbAjaxNew"
            f"?companyType=4&reportDateType=0&reportType=1&dates={latest_date}&code={em_code}",
        )
        xj_f = pool.submit(
            _emweb_json,
            f"{_EMWEB}/PC_HSF10/NewFinanceAnalysis/xjllbAjaxNew"
            f"?companyType=4&reportDateType=0&reportType=1&dates={latest_date}&code={em_code}",
        )
        op_json = op_f.result() or {}
        zc_json = zc_f.result() or {}
        xj_json = xj_f.result() or {}
    op_rows = op_json.get("zygcfx") or []
    dates = sorted({str(r.get("REPORT_DATE") or "")[:10] for r in op_rows if isinstance(r, dict)}, reverse=True)
    op_latest = dates[0] if dates else ""
    mainop = _pick_segments([r for r in op_rows if str(r.get("REPORT_DATE") or "")[:10] == op_latest], 8)
    by_period: dict[str, list[dict]] = {}
    for r in op_rows:
        if not isinstance(r, dict):
            continue
        key = str(r.get("REPORT_DATE") or "")[:10]
        if key:
            by_period.setdefault(key, []).append(r)
    mainop_history = [
        {"date": d, "segments": [{k: v for k, v in s.items() if k not in ("income_ratio", "profit_ratio")} for s in _pick_segments(rows, 6)]}
        for d, rows in sorted(by_period.items())[-40:]
    ]
    zc = (zc_json.get("data") or [{}])[0] if isinstance(zc_json.get("data"), list) else {}
    xj = (xj_json.get("data") or [{}])[0] if isinstance(xj_json.get("data"), list) else {}
    operate = _num(xj.get("NETCASH_OPERATE"))
    capex = _num(xj.get("CONSTRUCT_LONG_ASSET"))
    return {
        "mainop": mainop,
        "mainop_history": mainop_history,
        "balance": {
            "total_liabilities": _num(zc.get("TOTAL_LIABILITIES")),
            "accounts_receivable": _num(zc.get("ACCOUNTS_RECE")),
        },
        "cash": {"operate": operate, "capex": capex, "free": operate - capex},
    }


def finance_main(code: str) -> dict:
    """Last 12 F10 periods + emweb mainop/cash (MD finance-main)."""
    secu = secu_code(code)
    if not secu:
        raise ValueError(f"bad code: {code}")
    filt = f'(SECUCODE="{secu}")'
    with ThreadPoolExecutor(max_workers=2) as pool:
        fin_f = pool.submit(_f10_rows, "RPT_F10_FINANCE_MAINFINADATA", filt, 12, "REPORT_DATE")
        org_f = pool.submit(_f10_rows, "RPT_F10_ORG_BASICINFO", filt, 1, "SECUCODE")
        fin_rows = fin_f.result()
        org_rows = org_f.result()
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
            "roic": _num(r.get("ROIC")),
            "eps": _num(r.get("EPSJB")),
            "ocf_ps": _num(r.get("MGJYXJJE")),
        })
    name = (fin_rows[0].get("SECURITY_NAME_ABBR") if fin_rows else "") or ""
    latest = reports[0]["date"] if reports else ""
    extra = _emweb_extras(secu, latest)
    return {
        "code": bare_code(code),
        "name": name,
        "industry": industry,
        "reports": reports,
        **extra,
    }


def company_bundle(code: str) -> dict:
    """F10 + emweb extras only. No valuation / announcements / reports pile-on."""
    raw = bare_code(code)
    if not raw:
        raise ValueError(f"bad code: {code}")
    main = finance_main(raw)
    if not main.get("name"):
        q = astock.tencent_quote([raw]).get(raw) or {}
        main["name"] = q.get("name") or raw
    return {
        "main": main,
        "snapshot": None,
        "valuation": None,
        "percentile": None,
        "announcements": [],
        "reports": [],
    }


_HINT_RE = re.compile(r'v_hint="(.*)"', re.S)
_ASHARE_MKT = {"sh", "sz", "bj"}


def _unescape_hint(s: str) -> str:
    """Tencent smartbox names come as JS \\uXXXX."""
    if "\\u" not in s:
        return s
    try:
        return s.encode("ascii").decode("unicode_escape")
    except Exception:
        return s


def parse_tencent_hint(text: str, n: int = 8) -> list[dict]:
    """Parse smartbox `v_hint`. Keep A-share stocks / ETF; drop index / fund / US / HK."""
    raw = (text or "").strip()
    m = _HINT_RE.search(raw)
    body = m.group(1) if m else raw
    if not body or body == "N":
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for part in body.split("^"):
        bits = part.split("~")
        if len(bits) < 5:
            continue
        mkt, code, name, _py, typ = bits[0], bits[1], bits[2], bits[3], bits[4]
        if mkt not in _ASHARE_MKT or not re.fullmatch(r"\d{6}", code):
            continue
        if not (typ.startswith("GP-A") or typ == "ETF"):
            continue
        if code in seen:
            continue
        seen.add(code)
        out.append({"code": code, "name": _unescape_hint(name) or code})
        if len(out) >= n:
            break
    return out


def _suggest_tencent(q: str, n: int) -> list[dict]:
    try:
        r = _http_get(
            "https://smartbox.gtimg.cn/s3/",
            {"q": q, "t": "all"},
            timeout=6,
            referer="https://gu.qq.com/",
        )
        return parse_tencent_hint(r.text or "", n)
    except Exception:
        return []


def _suggest_eastmoney(q: str, n: int) -> list[dict]:
    """Legacy Eastmoney table. Current searchapi often returns guba JSONP, not this."""
    params = {
        "input": q,
        "type": 14,
        "token": "D43BF722C8E33BDC906FB84D85E326E8",
        "count": 10,
    }
    try:
        r = _http_get(
            "https://searchapi.eastmoney.com/api/suggest/get",
            params,
            timeout=8,
            referer="https://www.eastmoney.com/",
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
        if mkt not in ("1", "0", "90", "105"):
            if not code.startswith(("6", "0", "3", "8", "9", "2")):
                continue
        out.append({"code": code, "name": it.get("Name") or code})
        if len(out) >= n:
            break
    return out


def suggest_ashare(q: str, n: int = 8) -> list[dict]:
    """Name / code / pinyin initials. Tencent smartbox first (quote source); Eastmoney if empty."""
    q = (q or "").strip()
    if not q:
        return []
    return _suggest_tencent(q, n) or _suggest_eastmoney(q, n)
