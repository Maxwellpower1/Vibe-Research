"""Full-A cross-section snapshot for a later screener page.

Universe + uncached Tencent quotes + THS board tags. 180s, one key.
Does not write the 5s quote-hub cache. Not on review warmup / HTTP.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any

import astock
import ths_ext
import universe
from cache import TTLCache

BEIJING = timezone(timedelta(hours=8))
_CACHE = TTLCache(maxsize=4, default_ttl=180, negative_ttl=15, name="screener_snap")
_CHUNK = 400

ROW_FIELDS = (
    "code", "name", "price", "pct", "pe_ttm", "pb", "mcap_yi", "turnover",
    "industry", "concepts",
)


def _finite(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, str):
        v = v.strip()
        if not v or v == "-":
            return None
        try:
            v = float(v)
        except ValueError:
            return None
    if not isinstance(v, (int, float)):
        return None
    x = float(v)
    if x != x:
        return None
    return x


def _num(q: dict, key: str) -> float:
    v = _finite((q or {}).get(key))
    return 0.0 if v is None else v


def row_from_quote(code: str, q: dict | None) -> dict[str, Any] | None:
    """One snapshot row. Skip when price is missing or not positive."""
    if not q:
        return None
    price = _finite(q.get("price"))
    if price is None or price <= 0:
        return None
    name = str(q.get("name") or "").strip()
    return {
        "code": code,
        "name": name or code,
        "price": price,
        "pct": _num(q, "pct") if q.get("pct") is not None else _num(q, "change_pct"),
        "pe_ttm": _num(q, "pe_ttm"),
        "pb": _num(q, "pb"),
        "mcap_yi": _num(q, "mcap_yi"),
        "turnover": _num(q, "turnover") if q.get("turnover") is not None else _num(q, "turnover_pct"),
        "industry": "",
        "concepts": [],
    }


def _tencent_rows(codes: list[str]) -> dict[str, dict]:
    """Batch Tencent quotes. Does not write the 5s per-code quote cache."""
    chunks = [codes[i:i + _CHUNK] for i in range(0, len(codes), _CHUNK)]
    if not chunks:
        return {}

    def _one(chunk: list[str]) -> dict[str, dict]:
        prefixed = [f"{astock.get_prefix(c)}{c}" for c in chunk]
        parsed = astock._parse_gtimg(astock._fetch_gtimg(prefixed))
        return {c: q for c, q in parsed.items() if isinstance(q, dict)}

    merged: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=min(6, len(chunks))) as pool:
        for part in pool.map(_one, chunks):
            merged.update(part)
    return merged


def _attach_boards(rows: list[dict[str, Any]]) -> None:
    """Join THS industry/concepts. Missing dump or code -> empty tags, no raise."""
    try:
        names = universe.name_map()
    except Exception:
        names = {}
    try:
        data = ths_ext.load()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    cons = data.get("concepts") or {}
    inds = data.get("industries") or {}
    for row in rows:
        code = row.get("code") or ""
        ind = inds.get(code) or {}
        con = cons.get(code) or {}
        if not isinstance(ind, dict):
            ind = {}
        if not isinstance(con, dict):
            con = {}
        row["industry"] = str(ind.get("path") or "")
        row["concepts"] = [x for x in (con.get("concepts") or []) if x]
        if not row.get("name") or row.get("name") == code:
            row["name"] = (
                con.get("name") or ind.get("name")
                or names.get(code)
                or row.get("name") or code
            )


def build_snapshot(
    codes: list[str] | None = None,
    quotes: dict[str, dict] | None = None,
) -> dict[str, Any]:
    """Build once. Tests inject codes/quotes so this stays offline."""
    pool = universe.normalize(codes) if codes is not None else universe.load()
    fetched = quotes if quotes is not None else _tencent_rows(pool)
    rows: list[dict[str, Any]] = []
    for code in pool:
        row = row_from_quote(code, (fetched or {}).get(code))
        if row:
            rows.append(row)
    _attach_boards(rows)
    return {
        "n": len(rows),
        "updated": datetime.now(BEIJING).strftime("%Y-%m-%d %H:%M:%S"),
        "rows": rows,
    }


def get_snapshot() -> dict[str, Any]:
    """180s process cache. One key."""
    return _CACHE.get_or_set(
        "live",
        build_snapshot,
        ttl=180,
        valid=lambda v: bool(isinstance(v, dict) and v.get("rows")),
        negative_ttl=15,
    )
