"""Thin SEC helpers for ETF N-PORT and 13F (needs VR_SEC_CONTACT)."""
from __future__ import annotations

from typing import Any

from gstock_deep.official import official_get

_FTS = "https://efts.sec.gov/LATEST/search-index"
_SUB = "https://data.sec.gov/submissions/CIK{cik}.json"
_ARCH = "https://www.sec.gov/Archives/edgar/data"


def fts(params: dict[str, Any]) -> dict[str, Any]:
    """EDGAR full-text search. Returns {total, hits} where hits are _source dicts."""
    payload = official_get(_FTS, params={"q": "", **params}, as_json=True)
    hits = payload.get("hits") if isinstance(payload, dict) else None
    if not isinstance(hits, dict):
        msg = payload.get("errorMessage") if isinstance(payload, dict) else payload
        raise RuntimeError(f"EDGAR FTS has no hits block: {msg}")
    rows: list[dict] = []
    for hit in hits.get("hits") or []:
        src = hit.get("_source") if isinstance(hit, dict) else None
        if isinstance(src, dict):
            rows.append({**src, "_id": hit.get("_id")})
    total = hits.get("total") if isinstance(hits.get("total"), dict) else {}
    return {
        "total": int(total.get("value") or 0),
        "total_is_lower_bound": total.get("relation") == "gte",
        "hits": rows,
    }


def submissions(cik: str) -> dict:
    padded = str(cik).zfill(10)
    data = official_get(_SUB.format(cik=padded), as_json=True)
    return data if isinstance(data, dict) else {}


def archive_base(cik: str, accession: str) -> str:
    digits = str(cik).lstrip("0") or "0"
    acc = str(accession).replace("-", "")
    return f"{_ARCH}/{digits}/{acc}"


def get_json(url: str, params: dict | None = None) -> Any:
    return official_get(url, params=params, as_json=True)


def get_text(url: str, params: dict | None = None) -> str:
    return official_get(url, params=params, as_json=False)


def pad_cik(cik: str) -> str:
    return "".join(ch for ch in str(cik) if ch.isdigit()).zfill(10)
