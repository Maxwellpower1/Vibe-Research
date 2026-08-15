"""ETF look-through: A-share Eastmoney archives + US SEC N-PORT.

CN traps (verified in Vibe-Trading):
- year out of range is silently ignored; always read as_of from the payload
- month=6,12 expands interim/annual full books; topline alone does not
- starred seq rows are issuer top-10 float holders, not fund disclosure
- repPdDate is the holdings as-of; repPdEnd is the fiscal year end
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any
from xml.etree import ElementTree as ET

import requests

from cache import TTLCache

logger = logging.getLogger(__name__)

_UA = "Mozilla/5.0 (compatible; Vibe-Research/0.3; +https://viberesearch.wiki)"
_CACHE = TTLCache(maxsize=64, default_ttl=6 * 3600, negative_ttl=120, name="etf_lookthrough")

_EM_HOLDINGS = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx"
_EM_JJGG = "https://api.fund.eastmoney.com/f10/JJGG"
_SERIES_CSV = (
    "https://www.sec.gov/files/investment/data/other/"
    "investment-company-series-class-information/"
    "investment-company-series-class-{year}.csv"
)

_APIDATA_RE = re.compile(r'content:"(?P<content>.*?)",\s*arryear:\[(?P<years>[^\]]*)\]', re.S)
_TAG_RE = re.compile(r"<[^>]+>")
_ROW_RE = re.compile(r"<tr>(?P<row>.*?)</tr>", re.S)
_CELL_RE = re.compile(r"<t[dh][^>]*>(?P<cell>.*?)(?=</t[dh]>|<t[dh][^>]*>|\Z)", re.S)
_QUOTE_LINK_RE = re.compile(r"quote\.eastmoney\.com/unify/r/(?P<market>\d)\.(?P<code>\d{6})")
_ASOF_RE = re.compile(r"截止至：\s*<font[^>]*>(?P<date>[\d-]+)</font>")
_FUND_NAME_RE = re.compile(r"title='(?P<name>[^']*)'")
_PERIOD_RE = re.compile(r"(?P<label>\d{4}年\d季度[^<]*)</label>")
_ANNUAL_RE = re.compile(r"(?P<year>\d{4})年年度报告(?!摘要)")
_INTERIM_RE = re.compile(r"(?P<year>\d{4})年(?:中期|半年度)报告(?!摘要)")
_EXPAND_LINK = "显示全部持仓明细"
_SOURCE_FUND = "fund_report"
_SOURCE_XREF = "issuer_cross_ref"
_QUARTERLY_CAP = 15
_CN_ETF_PREFIX = ("15", "16", "50", "51", "52", "56", "58")


def _to_float(raw: str | None) -> float | None:
    if raw is None:
        return None
    s = str(raw).replace(",", "").replace("%", "").strip()
    if not s or s in ("-", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _strip_html(fragment: str) -> str:
    return _TAG_RE.sub("", fragment).replace("&nbsp;", " ").replace("&amp;", "&").strip()


def _local(tag: Any) -> str:
    return str(tag).rsplit("}", 1)[-1]


def _child(node, name: str):
    if node is None:
        return None
    for el in list(node):
        if _local(el.tag) == name:
            return el
    return None


def _text_of(node, name: str) -> str | None:
    el = _child(node, name)
    if el is None or el.text is None:
        return None
    text = el.text.strip()
    return text or None


# ---------------------------------------------------------------------------
# A-share (Eastmoney)
# ---------------------------------------------------------------------------

def _cn_column_map(header_row: str) -> dict[str, tuple[int, float]]:
    columns: dict[str, tuple[int, float]] = {}
    for index, match in enumerate(_CELL_RE.finditer(header_row)):
        text = _strip_html(match.group("cell"))
        scale = 10_000.0 if "万" in text else 1.0
        if "序号" in text:
            columns["seq"] = (index, 1.0)
        elif "股票代码" in text:
            columns["code"] = (index, 1.0)
        elif "股票名称" in text:
            columns["name"] = (index, 1.0)
        elif "占净值" in text:
            columns["pct"] = (index, 1.0)
        elif "持股数" in text:
            columns["shares"] = (index, scale)
        elif "持仓市值" in text:
            columns["value"] = (index, scale)
    return columns


def parse_cn_period(block: str) -> dict[str, Any] | None:
    """Parse one Eastmoney boxitem holdings block. Public for tests."""
    rows = _ROW_RE.findall(block)
    if len(rows) < 2:
        return None
    columns = _cn_column_map(rows[0])
    if "code" not in columns or "pct" not in columns:
        return None
    width = len(_CELL_RE.findall(rows[0]))
    holdings: list[dict[str, Any]] = []
    malformed = 0
    for row in rows[1:]:
        cells = [m.group("cell") for m in _CELL_RE.finditer(row)]
        if len(cells) != width:
            malformed += 1
            continue

        def cell(key: str) -> tuple[str, float] | None:
            spec = columns.get(key)
            if spec is None or spec[0] >= len(cells):
                return None
            return _strip_html(cells[spec[0]]), spec[1]

        code_cell = cell("code")
        if code_cell is None or not code_cell[0]:
            continue
        link = _QUOTE_LINK_RE.search(row)
        suffix = {"1": "SH", "0": "SZ"}.get(link.group("market")) if link else None
        seq_cell = cell("seq")
        xref = bool(seq_cell and "*" in seq_cell[0])
        holding: dict[str, Any] = {
            "symbol": f"{code_cell[0]}.{suffix}" if suffix else code_cell[0],
            "disclosure_source": _SOURCE_XREF if xref else _SOURCE_FUND,
        }
        name_cell = cell("name")
        if name_cell and name_cell[0]:
            holding["name"] = name_cell[0]
        pct_cell = cell("pct")
        if pct_cell:
            holding["pct_of_net_assets"] = _to_float(pct_cell[0])
        shares_cell = cell("shares")
        shares = _to_float(shares_cell[0]) if shares_cell else None
        if shares is not None:
            holding["shares"] = round(shares * shares_cell[1], 2)
        value_cell = cell("value")
        value = _to_float(value_cell[0]) if value_cell else None
        if value is not None:
            holding["market_value_cny"] = round(value * value_cell[1], 2)
        holdings.append({k: v for k, v in holding.items() if v is not None})
    if not holdings:
        return None
    as_of = _ASOF_RE.search(block)
    label = _PERIOD_RE.search(block)
    name = _FUND_NAME_RE.search(block)
    fund_rows = [h for h in holdings if h["disclosure_source"] == _SOURCE_FUND]
    return {
        "as_of": as_of.group("date") if as_of else None,
        "report_label": label.group("label").strip() if label else None,
        "fund_name": name.group("name") if name else None,
        "holdings": holdings,
        "unparseable_rows": malformed,
        "expandable": _EXPAND_LINK in block,
        "source_labelled": "seq" in columns,
        "fund_report_holdings": len(fund_rows),
        "cross_referenced_holdings": len(holdings) - len(fund_rows),
        "pct_of_net_assets_disclosed": round(
            sum(h.get("pct_of_net_assets") or 0.0 for h in fund_rows), 4
        ),
        "pct_of_net_assets_cross_referenced": round(
            sum(
                h.get("pct_of_net_assets") or 0.0
                for h in holdings
                if h["disclosure_source"] == _SOURCE_XREF
            ),
            4,
        ),
    }


def parse_cn_archive(body: str) -> list[dict[str, Any]]:
    match = _APIDATA_RE.search(body or "")
    if match is None:
        return []
    blocks = match.group("content").split("<div class='boxitem")[1:]
    return [p for p in (parse_cn_period(b) for b in blocks) if p is not None]


def _em_get(url: str, params: dict, referer: str) -> str:
    r = requests.get(
        url,
        params=params,
        headers={"User-Agent": _UA, "Referer": referer},
        timeout=20,
    )
    r.raise_for_status()
    r.encoding = r.apparent_encoding or "utf-8"
    return r.text


def _cn_periodic_reports(code: str) -> dict[str, dict[str, str]]:
    try:
        body = _em_get(
            _EM_JJGG,
            {
                "fundcode": code,
                "pageIndex": "1",
                "pageSize": "80",
                "type": "3",
            },
            f"https://fundf10.eastmoney.com/jjgg_{code}_3.html",
        )
        payload = json.loads(body)
    except Exception as exc:  # noqa: BLE001 - corroboration only
        logger.warning("ETF periodic-report index failed for %s: %s", code, exc)
        return {}
    records = payload.get("Data") if isinstance(payload, dict) else None
    if payload.get("ErrCode") != 0 or not isinstance(records, list):
        return {}
    reports: dict[str, dict[str, str]] = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        title = str(rec.get("TITLE") or "")
        published = str(rec.get("PUBLISHDATEDesc") or "").strip()
        if annual := _ANNUAL_RE.search(title):
            period_end = f"{annual.group('year')}-12-31"
        elif interim := _INTERIM_RE.search(title):
            period_end = f"{interim.group('year')}-06-30"
        else:
            continue
        known = reports.get(period_end)
        if known is None or (published and published < known["published"]):
            reports[period_end] = {"report": title, "published": published}
    return reports


def annotate_cn_period(period: dict[str, Any], reports: dict[str, dict[str, str]]) -> None:
    """Mutate period with a conservative coverage label."""
    as_of = period.get("as_of") or ""
    report = reports.get(as_of)
    confirmed = None if not reports else report is not None
    mid_or_year = as_of.endswith(("-06-30", "-12-31"))
    fund_n = int(period.get("fund_report_holdings") or 0)
    full = (
        mid_or_year
        and not period.get("expandable")
        and period.get("source_labelled")
        and fund_n > _QUARTERLY_CAP
        and confirmed is not False
    )
    period["coverage"] = "full_portfolio" if full else "top_n_disclosed"
    period["periodic_report"] = report
    period["periodic_report_confirmed"] = confirmed


def _cn_holdings(code: str) -> dict[str, Any]:
    body = _em_get(
        _EM_HOLDINGS,
        {"type": "jjcc", "code": code, "topline": "6000", "year": "", "month": "6,12"},
        f"https://fundf10.eastmoney.com/ccmx_{code}.html",
    )
    periods = parse_cn_archive(body)
    reports = _cn_periodic_reports(code)
    for p in periods:
        annotate_cn_period(p, reports)
    if not periods:
        return {"error": f"东财未返回 {code} 的持仓表"}
    latest = periods[0]
    fund_holdings = [
        h for h in latest.get("holdings") or []
        if h.get("disclosure_source") == _SOURCE_FUND
    ]
    return {
        "market": "CN",
        "symbol": code,
        "fund_name": latest.get("fund_name"),
        "as_of": latest.get("as_of"),
        "report_label": latest.get("report_label"),
        "coverage": latest.get("coverage"),
        "pct_of_net_assets_disclosed": latest.get("pct_of_net_assets_disclosed"),
        "fund_report_holdings": latest.get("fund_report_holdings"),
        "cross_referenced_holdings": latest.get("cross_referenced_holdings"),
        "periodic_report": latest.get("periodic_report"),
        "holdings": fund_holdings,
        "periods": [
            {
                "as_of": p.get("as_of"),
                "report_label": p.get("report_label"),
                "coverage": p.get("coverage"),
                "fund_report_holdings": p.get("fund_report_holdings"),
                "pct_of_net_assets_disclosed": p.get("pct_of_net_assets_disclosed"),
            }
            for p in periods[:6]
        ],
        "source": "eastmoney fund archives",
        "note": (
            "Starred issuer cross-ref rows are excluded from coverage. "
            "as_of is read from the payload, not the request year."
        ),
    }


# ---------------------------------------------------------------------------
# US N-PORT
# ---------------------------------------------------------------------------

def parse_nport(xml_text: str) -> dict[str, Any]:
    """Parse N-PORT primary_doc.xml. as_of = repPdDate, not repPdEnd."""
    root = ET.fromstring(xml_text.encode("utf-8", "replace"))
    form_data = _child(root, "formData")
    gen_info = _child(form_data, "genInfo")
    fund_info = _child(form_data, "fundInfo")
    securities = _child(form_data, "invstOrSecs")
    holdings: list[dict[str, Any]] = []
    if securities is not None:
        for node in securities:
            if _local(node.tag) != "invstOrSec":
                continue
            identifiers = _child(node, "identifiers")
            isin = ticker = None
            if identifiers is not None:
                for el in identifiers:
                    loc = _local(el.tag)
                    if loc == "isin":
                        isin = (el.get("value") or "").strip() or None
                    elif loc == "ticker":
                        ticker = (el.get("value") or "").strip() or None
            row = {
                "name": _text_of(node, "name"),
                "cusip": _text_of(node, "cusip"),
                "isin": isin,
                "ticker": ticker,
                "pct_of_net_assets": _to_float(_text_of(node, "pctVal")),
                "value_usd": _to_float(_text_of(node, "valUSD")),
                "balance": _to_float(_text_of(node, "balance")),
                "asset_category": _text_of(node, "assetCat"),
            }
            holdings.append({k: v for k, v in row.items() if v is not None})
    return {
        "series_id": _text_of(gen_info, "seriesId"),
        "series_name": _text_of(gen_info, "seriesName"),
        "registrant": _text_of(gen_info, "regName"),
        "as_of": _text_of(gen_info, "repPdDate"),
        "fiscal_year_end": _text_of(gen_info, "repPdEnd"),
        "net_assets_usd": _to_float(_text_of(fund_info, "netAssets")),
        "holdings": holdings,
    }


def parse_series_csv(text: str, ticker: str) -> dict[str, str] | None:
    """Map a class ticker to CIK + series id from the SEC series-class CSV."""
    want = ticker.strip().upper()
    if not want:
        return None
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return None

    def col(*names: str) -> str | None:
        lower = { (n or "").strip().lower(): n for n in reader.fieldnames or [] }
        for name in names:
            if name.lower() in lower:
                return lower[name.lower()]
        for key, orig in lower.items():
            if any(n.lower() in key for n in names):
                return orig
        return None

    tcol = col("class ticker", "ticker symbol", "ticker")
    cik_col = col("cik number", "cik")
    series_col = col("series id", "series")
    sname_col = col("series name")
    ename_col = col("entity name")
    if not tcol or not cik_col or not series_col:
        return None
    for row in reader:
        if (row.get(tcol) or "").strip().upper() == want:
            return {
                "ticker": want,
                "cik": "".join(ch for ch in (row.get(cik_col) or "") if ch.isdigit()).zfill(10),
                "series_id": (row.get(series_col) or "").strip(),
                "series_name": (row.get(sname_col) or "").strip(),
                "entity_name": (row.get(ename_col) or "").strip(),
            }
    return None


def _us_series(ticker: str) -> dict[str, str] | None:
    import research_sec

    year = datetime.now(timezone.utc).year
    for y in (year, year - 1):
        try:
            text = research_sec.get_text(_SERIES_CSV.format(year=y))
        except Exception as exc:  # noqa: BLE001
            logger.warning("series-class CSV %s failed: %s", y, exc)
            continue
        hit = parse_series_csv(text, ticker)
        if hit:
            return hit
    return None


def _us_holdings(ticker: str) -> dict[str, Any]:
    import research_sec

    info = _us_series(ticker)
    if not info or not info.get("series_id"):
        return {"error": f"SEC series-class 未收录 {ticker} (多数 ETF 不在 company_tickers.json)"}
    hits = research_sec.fts({"forms": "NPORT-P", "q": f'"{info["series_id"]}"'})["hits"]
    ranked = sorted(
        [h for h in hits if h.get("adsh")],
        key=lambda h: str(h.get("period_ending") or h.get("file_date") or ""),
        reverse=True,
    )
    if not ranked:
        return {"error": f"未找到 {ticker} ({info['series_id']}) 的 NPORT-P"}
    chosen = ranked[0]
    acc = chosen["adsh"]
    xml = research_sec.get_text(
        f"{research_sec.archive_base(info['cik'], acc)}/primary_doc.xml"
    )
    parsed = parse_nport(xml)
    holdings = parsed.get("holdings") or []
    holdings.sort(key=lambda h: float(h.get("pct_of_net_assets") or 0), reverse=True)
    return {
        "market": "US",
        "symbol": ticker.upper(),
        "fund_name": parsed.get("series_name") or info.get("series_name"),
        "registrant": parsed.get("registrant") or info.get("entity_name"),
        "series_id": parsed.get("series_id") or info.get("series_id"),
        "cik": info["cik"],
        "as_of": parsed.get("as_of"),
        "fiscal_year_end": parsed.get("fiscal_year_end"),
        "filing_date": chosen.get("file_date"),
        "accession": acc,
        "net_assets_usd": parsed.get("net_assets_usd"),
        "coverage": "nport_full_book",
        "holdings": holdings,
        "source": "SEC NPORT-P",
        "note": "as_of is repPdDate (holdings date), not repPdEnd (fiscal year end).",
    }


def _looks_cn(symbol: str) -> bool:
    raw = (symbol or "").strip().upper().removesuffix(".SH").removesuffix(".SZ")
    return raw.isdigit() and len(raw) == 6 and raw[:2] in _CN_ETF_PREFIX


def etf_holdings(symbol: str, market: str = "auto") -> dict[str, Any]:
    """Look through one ETF. market=auto|CN|US."""
    raw = (symbol or "").strip().upper()
    if not raw:
        return {"error": "symbol 必填"}
    mkt = (market or "auto").upper()
    if mkt == "AUTO":
        mkt = "CN" if _looks_cn(raw) else "US"
    key = f"etf:{mkt}:{raw}"
    return _CACHE.get_or_set(key, lambda: _etf_fetch(raw, mkt), ttl=6 * 3600) or {}


def _etf_fetch(symbol: str, market: str) -> dict[str, Any]:
    if market == "CN":
        code = symbol.replace(".SH", "").replace(".SZ", "")
        if not (code.isdigit() and len(code) == 6):
            return {"error": "A 股 ETF 请用 6 位代码, 如 510300"}
        return _cn_holdings(code)
    try:
        return _us_holdings(symbol)
    except RuntimeError as exc:
        return {"error": str(exc)}
