"""13F-HR holdings + quarter-over-quarter diff.

Traps:
- information table filename is not always infotable.xml; confirm root tag
- value units flipped from thousands to dollars around 2023-01-03; do not
  cut only on filing date -- check implied price
- ticker -> CUSIP has no official map; FTS by ticker lists managers
"""
from __future__ import annotations

import io
import logging
import re
import zipfile
from typing import Any
from xml.etree import ElementTree as ET

from cache import TTLCache
from gstock_deep.common import DataNotAvailable

logger = logging.getLogger(__name__)

_CACHE = TTLCache(maxsize=64, default_ttl=6 * 3600, negative_ttl=180, name="inst_13f")
_DOLLAR_FROM = "2023-01-03"
_TABLE_HINTS = ("infotable", "informationtable", "form13finfo", "info_table")
_MAX_CANDIDATES = 8
_MAX_ROWS = 20000
_FTD_INDEX = "https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data"
_FTD_HREF = re.compile(r'href="(/[^"]*cnsfails\d{6}[ab]\.zip)"')


def _to_number(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).replace(",", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _local(tag: Any) -> str:
    return str(tag).rsplit("}", 1)[-1]


def parse_information_table(raw: bytes, cusip_filter: str | None = None) -> list[dict[str, Any]]:
    """Stream an informationTable XML into position rows. Public for tests."""
    context = ET.iterparse(io.BytesIO(raw), events=("start", "end"))
    _, root = next(context)
    if _local(root.tag) != "informationTable":
        raise ValueError(f"document root is <{_local(root.tag)}>, not <informationTable>")
    wanted = cusip_filter.strip().upper() if cusip_filter else None
    rows: list[dict[str, Any]] = []
    for event, element in context:
        if event != "end" or _local(element.tag) != "infoTable":
            continue
        fields = {_local(node.tag): (node.text or "").strip() for node in element.iter()}
        element.clear()
        root.clear()
        cusip = (fields.get("cusip") or "").upper()
        if wanted and cusip != wanted:
            continue
        rows.append({
            "issuer": fields.get("nameOfIssuer") or None,
            "title_of_class": fields.get("titleOfClass") or None,
            "cusip": cusip or None,
            "value_raw": _to_number(fields.get("value")),
            "shares": _to_number(fields.get("sshPrnamt")),
            "share_type": fields.get("sshPrnamtType") or None,
            "put_call": fields.get("putCall") or None,
        })
        if len(rows) >= _MAX_ROWS:
            break
    return rows


def detect_value_units(rows: list[dict[str, Any]], filing_date: str | None) -> tuple[int, str]:
    """Return (multiplier_to_usd, units_label)."""
    dollars = str(filing_date or "9999-99-99") >= _DOLLAR_FROM
    implied = sorted(
        row["value_raw"] / row["shares"]
        for row in rows
        if row.get("share_type") in (None, "SH")
        and row.get("shares")
        and row.get("value_raw") is not None
        and row["shares"] > 0
    )
    if len(implied) >= 8:
        median = implied[len(implied) // 2]
        if dollars and median < 1.0:
            return 1000, "usd_thousands"
        if not dollars and median > 3.0:
            return 1, "usd"
    return (1, "usd") if dollars else (1000, "usd_thousands")


def aggregate_positions(rows: list[dict[str, Any]], multiplier: int) -> list[dict[str, Any]]:
    merged: dict[tuple[Any, Any], dict[str, Any]] = {}
    for row in rows:
        key = (row.get("cusip"), row.get("put_call"))
        slot = merged.setdefault(key, {
            "issuer": row.get("issuer"),
            "cusip": row.get("cusip"),
            "put_call": row.get("put_call"),
            "value_usd": 0.0,
            "shares": 0.0,
        })
        if row.get("issuer") and not slot.get("issuer"):
            slot["issuer"] = row["issuer"]
        if row.get("value_raw") is not None:
            slot["value_usd"] += float(row["value_raw"]) * multiplier
        if row.get("shares") is not None:
            slot["shares"] += float(row["shares"])
    out = list(merged.values())
    out.sort(key=lambda p: p["value_usd"], reverse=True)
    for p in out:
        p["value_usd"] = round(p["value_usd"], 2)
        p["shares"] = round(p["shares"], 4)
    return out


def diff_positions(current: list[dict], prior: list[dict]) -> list[dict[str, Any]]:
    """QoQ change keyed on (cusip, put_call). Unchanged rows omitted."""
    def index(positions: list[dict]) -> dict[tuple[Any, Any], dict]:
        out: dict[tuple[Any, Any], dict] = {}
        for p in positions:
            key = (p.get("cusip"), p.get("put_call"))
            slot = out.setdefault(key, {"issuer": p.get("issuer"), "value_usd": 0.0, "shares": 0.0})
            slot["value_usd"] += float(p.get("value_usd") or 0)
            slot["shares"] += float(p.get("shares") or 0)
        return out

    now, before = index(current), index(prior)
    changes: list[dict[str, Any]] = []
    for key in set(now) | set(before):
        cusip, put_call = key
        new_side, old_side = now.get(key), before.get(key)
        new_shares = new_side["shares"] if new_side else 0.0
        old_shares = old_side["shares"] if old_side else 0.0
        if new_side is None:
            action = "closed"
        elif old_side is None:
            action = "new"
        elif new_shares > old_shares:
            action = "increased"
        elif new_shares < old_shares:
            action = "reduced"
        else:
            continue
        new_value = new_side["value_usd"] if new_side else 0.0
        old_value = old_side["value_usd"] if old_side else 0.0
        changes.append({
            "action": action,
            "issuer": (new_side or old_side)["issuer"],
            "cusip": cusip,
            "put_call": put_call,
            "shares_before": round(old_shares, 4),
            "shares_after": round(new_shares, 4),
            "shares_change": round(new_shares - old_shares, 4),
            "shares_change_pct": round(100.0 * (new_shares - old_shares) / old_shares, 4)
            if old_shares else None,
            "value_usd_before": round(old_value, 2),
            "value_usd_after": round(new_value, 2),
            "value_usd_change": round(new_value - old_value, 2),
        })
    changes.sort(key=lambda c: abs(c["value_usd_change"]), reverse=True)
    return changes


def _list_from_submissions(cik: str) -> list[dict[str, Any]]:
    import research_sec

    data = research_sec.submissions(cik)
    recent = ((data or {}).get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    out: list[dict[str, Any]] = []
    for i, raw_form in enumerate(forms):
        form = str(raw_form or "")
        if not form.upper().startswith("13F-HR"):
            continue
        out.append({
            "accession": (recent.get("accessionNumber") or [None])[i]
            if i < len(recent.get("accessionNumber") or []) else None,
            "form": form,
            "filing_date": (recent.get("filingDate") or [None])[i]
            if i < len(recent.get("filingDate") or []) else None,
            "period_end": (recent.get("reportDate") or [None])[i]
            if i < len(recent.get("reportDate") or []) else None,
            "is_amendment": form.upper().endswith("/A"),
            "manager": data.get("name"),
        })
    return out


def _list_13f(cik: str) -> list[dict[str, Any]]:
    import research_sec

    filings: list[dict[str, Any]] = []
    try:
        for hit in research_sec.fts({"forms": "13F-HR", "ciks": cik})["hits"]:
            acc = hit.get("adsh")
            if not acc:
                continue
            form = str(hit.get("form") or "")
            filings.append({
                "accession": acc,
                "form": form,
                "filing_date": hit.get("file_date"),
                "period_end": hit.get("period_ending"),
                "is_amendment": form.upper().endswith("/A"),
            })
    except Exception as exc:  # noqa: BLE001
        logger.warning("13F FTS failed for %s: %s", cik, exc)
    if not filings:
        filings = _list_from_submissions(cik)
    unique: dict[str, dict] = {}
    for f in filings:
        if f.get("accession") and f["accession"] not in unique:
            unique[f["accession"]] = f
    return sorted(unique.values(), key=lambda f: str(f.get("filing_date") or ""), reverse=True)


def _table_urls(cik: str, accession: str) -> list[str]:
    import research_sec

    base = research_sec.archive_base(cik, accession)
    try:
        index = research_sec.get_json(f"{base}/index.json")
    except (RuntimeError, DataNotAvailable):
        return []
    items = ((index or {}).get("directory") or {}).get("item") or []
    ranked: list[tuple[int, int, int, str]] = []
    for order, item in enumerate(items):
        name = str((item or {}).get("name") or "")
        low = name.lower()
        if not low.endswith(".xml") or low == "primary_doc.xml":
            continue
        try:
            size = int(item.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        looks = any(h in low for h in _TABLE_HINTS)
        ranked.append((0 if looks else 1, -size, order, f"{base}/{name}"))
    return [e[-1] for e in sorted(ranked)[:_MAX_CANDIDATES]]


def _load_table(cik: str, accession: str, filing_date: str | None) -> tuple[list[dict], str]:
    import research_sec

    last_err = "no xml table"
    for url in _table_urls(cik, accession):
        try:
            text = research_sec.get_text(url)
            rows = parse_information_table(text.encode("utf-8", "replace"))
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            continue
        if rows:
            mult, units = detect_value_units(rows, filing_date)
            return aggregate_positions(rows, mult), units
    raise RuntimeError(last_err)


def _resolve_manager(manager: str | None, cik: str | None) -> tuple[str, str | None, list[dict]]:
    import research_sec

    if cik:
        padded = research_sec.pad_cik(cik)
        try:
            data = research_sec.submissions(padded)
            return padded, data.get("name"), []
        except Exception:
            return padded, None, []
    name = (manager or "").strip()
    if not name:
        raise ValueError("manager 或 cik 必填")
    if name.isdigit() and len(name) <= 10:
        return _resolve_manager(None, name)
    hits = research_sec.fts({"forms": "13F-HR", "q": f'"{name}"'})["hits"]
    seen: dict[str, str] = {}
    for hit in hits:
        for raw in hit.get("ciks") or []:
            padded = research_sec.pad_cik(str(raw))
            if padded not in seen:
                names = hit.get("display_names") or []
                seen[padded] = names[0] if names else name
        if len(seen) >= 6:
            break
    if not seen:
        raise ValueError(f"没有匹配到 13F 管理人 {name!r}")
    items = list(seen.items())
    others = [{"cik": c, "name": n} for c, n in items[1:]]
    return items[0][0], items[0][1], others


def _periods(filings: list[dict]) -> list[str]:
    seen: list[str] = []
    for f in filings:
        pe = f.get("period_end")
        if pe and pe not in seen:
            seen.append(pe)
    return seen


def _latest_for_period(filings: list[dict], period_end: str) -> dict | None:
    cands = [f for f in filings if f.get("period_end") == period_end]
    if not cands:
        return None
    cands.sort(key=lambda f: str(f.get("filing_date") or ""), reverse=True)
    return cands[0]


def manager_13f(manager: str | None = None, cik: str | None = None,
                top: int = 40) -> dict[str, Any]:
    """Latest two distinct quarters for one manager + QoQ diff."""
    key = f"mgr:{(cik or '').strip()}:{(manager or '').strip()}:{top}"
    return _CACHE.get_or_set(
        key, lambda: _manager_13f(manager, cik, top), ttl=6 * 3600
    ) or {}


def _manager_13f(manager: str | None, cik: str | None, top: int) -> dict[str, Any]:
    padded, name, others = _resolve_manager(manager, cik)
    filings = _list_13f(padded)
    periods = _periods(filings)
    if not periods:
        return {"error": f"CIK {padded} 没有带 period_end 的 13F-HR"}
    current_pe = periods[0]
    prior_pe = periods[1] if len(periods) > 1 else None
    cur_f = _latest_for_period(filings, current_pe)
    if not cur_f:
        return {"error": "无法定位最新季度申报"}
    current, units = _load_table(padded, cur_f["accession"], cur_f.get("filing_date"))
    prior: list[dict] = []
    prior_meta = None
    if prior_pe:
        prior_f = _latest_for_period(filings, prior_pe)
        if prior_f:
            try:
                prior, _ = _load_table(padded, prior_f["accession"], prior_f.get("filing_date"))
                prior_meta = {
                    "period_end": prior_pe,
                    "filing_date": prior_f.get("filing_date"),
                    "accession": prior_f.get("accession"),
                    "form": prior_f.get("form"),
                }
            except Exception as exc:  # noqa: BLE001
                logger.warning("prior 13F table failed: %s", exc)
    changes = diff_positions(current, prior) if prior else []
    n = max(5, min(int(top or 40), 200))
    return {
        "mode": "manager",
        "cik": padded,
        "manager": name,
        "other_matches": others,
        "current": {
            "period_end": current_pe,
            "filing_date": cur_f.get("filing_date"),
            "accession": cur_f.get("accession"),
            "form": cur_f.get("form"),
            "value_units": units,
            "positions": len(current),
            "holdings": current[:n],
        },
        "prior": prior_meta,
        "changes": changes[: min(80, n * 2)],
        "change_counts": {
            "new": sum(1 for c in changes if c["action"] == "new"),
            "increased": sum(1 for c in changes if c["action"] == "increased"),
            "reduced": sum(1 for c in changes if c["action"] == "reduced"),
            "closed": sum(1 for c in changes if c["action"] == "closed"),
        },
        "source": "SEC 13F-HR",
        "note": (
            "Newest filing_date wins for each period_end (amendments replace). "
            "Unchanged positions are omitted from changes."
        ),
    }


def ticker_holders(ticker: str, limit: int = 20) -> dict[str, Any]:
    """List 13F managers that mention a ticker in FTS. No share counts."""
    import research_sec

    t = (ticker or "").strip().upper()
    if not t:
        return {"error": "ticker 必填"}
    key = f"tk:{t}:{limit}"
    return _CACHE.get_or_set(key, lambda: _ticker_holders(t, limit), ttl=6 * 3600) or {}


def _ticker_holders(ticker: str, limit: int) -> dict[str, Any]:
    import research_sec

    hits = research_sec.fts({"forms": "13F-HR", "q": ticker})["hits"]
    managers: list[dict[str, Any]] = []
    seen: set[str] = set()
    for hit in hits:
        ciks = hit.get("ciks") or []
        names = hit.get("display_names") or []
        cik = research_sec.pad_cik(str(ciks[0])) if ciks else ""
        if not cik or cik in seen:
            continue
        seen.add(cik)
        managers.append({
            "cik": cik,
            "name": names[0] if names else None,
            "period_end": hit.get("period_ending"),
            "filing_date": hit.get("file_date"),
            "accession": hit.get("adsh"),
        })
        if len(managers) >= max(5, min(int(limit or 20), 40)):
            break
    cusip = None
    try:
        cusip, _desc = _cusip_for_ticker(ticker)
    except Exception as exc:  # noqa: BLE001
        logger.warning("FTD CUSIP lookup failed for %s: %s", ticker, exc)
    return {
        "mode": "ticker",
        "ticker": ticker,
        "cusip": cusip,
        "managers": managers,
        "source": "SEC FTS 13F-HR",
        "note": (
            "This is a mention list, not a complete holder census. "
            "Open a manager CIK for holdings + QoQ."
        ),
    }


def _cusip_for_ticker(ticker: str) -> tuple[str | None, str | None]:
    """Best-effort ticker -> CUSIP via the latest SEC FTD zip."""
    import research_sec

    html = research_sec.get_text(_FTD_INDEX)
    hrefs = _FTD_HREF.findall(html)
    if not hrefs:
        return None, None
    newest = sorted(set(hrefs), key=lambda h: h.rsplit("/", 1)[-1], reverse=True)[0]
    url = f"https://www.sec.gov{newest}"
    try:
        import requests
        from gstock_deep.common import _sec_contact
        from gstock_deep.official import _limiter_for

        contact = _sec_contact()
        _limiter_for(url).wait()
        r = requests.get(
            url,
            headers={"User-Agent": contact, "Accept-Encoding": "gzip, deflate"},
            timeout=40,
        )
        r.raise_for_status()
        archive = zipfile.ZipFile(io.BytesIO(r.content))
    except Exception as exc:  # noqa: BLE001
        logger.warning("FTD zip failed: %s", exc)
        return None, None
    want = ticker.upper().replace(".", "")
    for member in archive.namelist():
        for line in archive.read(member).decode("utf-8", "replace").splitlines()[1:]:
            parts = line.split("|")
            if len(parts) < 5:
                continue
            symbol = parts[2].strip().upper()
            if symbol == ticker.upper() or symbol == want:
                return parts[1].strip().upper(), parts[4].strip()
    return None, None


def query_13f(*, manager: str | None = None, cik: str | None = None,
              ticker: str | None = None, top: int = 40) -> dict[str, Any]:
    if ticker and not manager and not cik:
        return ticker_holders(ticker, limit=top)
    return manager_13f(manager=manager, cik=cik, top=top)
