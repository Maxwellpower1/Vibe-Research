"""SEC EDGAR filings."""
from __future__ import annotations

from datetime import datetime

import gstock
from gstock_deep import official as _official
from gstock_deep.common import DataNotAvailable, _FORM_LABEL
from gstock_deep.official import (
    _is_object_missing,
    _recent_weekdays,
    _require_sec_contact,
    official_get,
)
from gstock_deep.yahoo import _resolve_yahoo, to_yahoo_symbol


def ticker_to_cik(ticker: str) -> dict:
    t = ticker.strip().upper()
    if not t:
        return {}
    if _official._cik_cache is None:
        raw = official_get("https://www.sec.gov/files/company_tickers.json", as_json=True)
        _official._cik_cache = raw if isinstance(raw, dict) else {}
    for _, v in (_official._cik_cache or {}).items():
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

