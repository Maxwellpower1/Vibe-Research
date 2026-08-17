"""A-share universe. One file: VR_DATA_DIR / a-share-codes.json.

Codes plus optional names. Breadth, THS rotation, the cross-section
snapshot, and local suggest all read this list. Sina hs_a (when it fills)
is the writer. Stale or thin files look like empty for breadth; search
still reads a stale file. Not a second instruments file.
"""
from __future__ import annotations

import json
import os
import threading
import time
from functools import lru_cache
from pathlib import Path

FILE_NAME = "a-share-codes.json"
TTL = 24 * 3600
MIN_CODES = 2000


def data_path() -> Path:
    root = Path(os.environ.get("VR_DATA_DIR") or Path.home() / ".vibe-research")
    return root / FILE_NAME


def normalize(codes: list[str] | None) -> list[str]:
    """Keep unique 6-digit codes, first-seen order."""
    uniq: list[str] = []
    seen: set[str] = set()
    for raw in codes or []:
        c = str(raw or "").strip()
        if c in seen or not (c.isdigit() and len(c) == 6):
            continue
        seen.add(c)
        uniq.append(c)
    return uniq


def _clean_names(raw: object, allowed: set[str] | None = None) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, val in raw.items():
        c = str(key or "").strip()
        if c in out or not (c.isdigit() and len(c) == 6):
            continue
        if allowed is not None and c not in allowed:
            continue
        name = str(val or "").strip()
        if not name:
            continue
        out[c] = name
    return out


def _read_payload() -> dict:
    try:
        raw = json.loads(data_path().read_text(encoding="utf-8"))
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def _usable(raw: dict, *, fresh_only: bool) -> list[str]:
    ts = float(raw.get("ts") or 0)
    codes = raw.get("codes") or []
    if fresh_only and time.time() - ts > TTL:
        return []
    if not isinstance(codes, list) or len(codes) < MIN_CODES:
        return []
    return normalize([c for c in codes if isinstance(c, str)])


def read_codes(*, fresh_only: bool = True) -> list[str]:
    """Read the file. fresh_only=True treats a stale file as empty (breadth)."""
    return _usable(_read_payload(), fresh_only=fresh_only)


def read_names(*, fresh_only: bool = True) -> dict[str, str]:
    """Names keyed by 6-digit code. Same freshness gate as read_codes."""
    raw = _read_payload()
    codes = _usable(raw, fresh_only=fresh_only)
    if not codes:
        return {}
    return _clean_names(raw.get("names"), set(codes))


def load() -> list[str]:
    """Fresh list, or [] if missing / stale / thinner than MIN_CODES."""
    return read_codes(fresh_only=True)


def name_map() -> dict[str, str]:
    """Fresh code -> name. Missing names are omitted, not filled with the code."""
    return read_names(fresh_only=True)


def rows(*, fresh_only: bool = True) -> list[dict[str, str]]:
    """Instrument rows from the same file. name may be empty."""
    codes = read_codes(fresh_only=fresh_only)
    names = read_names(fresh_only=fresh_only)
    return [{"code": c, "name": names.get(c) or ""} for c in codes]


def save(codes: list[str], names: dict[str, str] | None = None) -> None:
    """Overwrite the file. No-op when the cleaned list is thinner than MIN_CODES.

    New names overlay the previous map; names for dropped codes are discarded.
    """
    uniq = normalize(codes)
    if len(uniq) < MIN_CODES:
        return
    allowed = set(uniq)
    merged = _clean_names(_read_payload().get("names"), allowed)
    if names:
        merged.update(_clean_names(names, allowed))
    path = data_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"ts": time.time(), "codes": uniq, "names": merged}, ensure_ascii=False),
        encoding="utf-8",
    )
    _invalidate_search()


_PINYIN_OK: bool | None = None
_INDEX_LOCK = threading.Lock()
# Same file, in-process. Not a second universe.
_INDEX: dict = {"path": "", "mtime": None, "rows": [], "named": 0, "py": False}


def _ensure_pinyin() -> bool:
    """Load pypinyin phrase hints once. Missing package skips the pinyin layer."""
    global _PINYIN_OK
    if _PINYIN_OK is not None:
        return _PINYIN_OK
    try:
        from pypinyin import load_phrases_dict

        load_phrases_dict({
            "重庆": [["zhong", "chong"], ["qing"]],
            "长安": [["chang", "zhang"], ["an"]],
            "长春": [["chang", "zhang"], ["chun"]],
            "长沙": [["chang", "zhang"], ["sha"]],
            "长城": [["chang", "zhang"], ["cheng"]],
            "长江": [["chang", "zhang"], ["jiang"]],
        })
        _PINYIN_OK = True
    except Exception:
        _PINYIN_OK = False
    return _PINYIN_OK


@lru_cache(maxsize=8192)
def _name_pinyin_keys(name: str) -> tuple[str, ...]:
    """First-letter keys, heteronyms expanded. '平安银行' -> ('PAYH',)."""
    if not name or not _ensure_pinyin():
        return ()
    from pypinyin import Style, pinyin

    keys = [""]
    for group in pinyin(name, style=Style.FIRST_LETTER, heteronym=True):
        keys = [k + g.upper() for k in keys for g in group]
    return tuple(keys)


def _invalidate_search() -> None:
    with _INDEX_LOCK:
        _INDEX.update(path="", mtime=None, rows=[], named=0, py=False)


def _pack_row(code: str, name: str, py: tuple[str, ...] = ()) -> tuple:
    return (code, name, code.upper(), name.upper(), py)


def _prepare_injected(rows: list[dict[str, str]]) -> list[tuple]:
    out: list[tuple] = []
    seen: set[str] = set()
    for raw in rows:
        code = str((raw or {}).get("code") or "").strip()
        if not code or code in seen:
            continue
        seen.add(code)
        name = str((raw or {}).get("name") or "").strip()
        py = _name_pinyin_keys(name) if name else ()
        out.append(_pack_row(code, name, py))
    return out


def _index_rows() -> tuple[list[tuple], int]:
    """Load the universe file once. Pinyin filled on demand / warm_search."""
    path = data_path()
    key = str(path)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        _invalidate_search()
        return [], 0
    with _INDEX_LOCK:
        if _INDEX["path"] == key and _INDEX["mtime"] == mtime and _INDEX["rows"]:
            return _INDEX["rows"], int(_INDEX["named"])
        raw = _read_payload()
        codes = _usable(raw, fresh_only=False)
        names = _clean_names(raw.get("names"), set(codes))
        packed = [_pack_row(c, names.get(c) or "") for c in codes]
        named = sum(1 for _c, name, _cu, _nu, _py in packed if name)
        _INDEX.update(path=key, mtime=mtime, rows=packed, named=named, py=False)
        return packed, named


def _index_with_pinyin() -> list[tuple]:
    packed, _named = _index_rows()
    with _INDEX_LOCK:
        if _INDEX["py"] and _INDEX["rows"]:
            return _INDEX["rows"]
        filled = []
        for code, name, _cu, _nu, py in packed:
            if name and not py:
                py = _name_pinyin_keys(name)
            filled.append(_pack_row(code, name, py))
        _INDEX["rows"] = filled
        _INDEX["py"] = True
        return filled


def warm_search() -> None:
    """Precompute search rows + pinyin. Same file, background-safe."""
    packed, named = _index_rows()
    if packed and named >= MIN_CODES:
        _index_with_pinyin()


def _scan(pool: list[tuple], keyword: str, n: int) -> list[dict[str, str]]:
    key = keyword.upper()
    want_pinyin = key.isalpha() and key.isascii()
    prefix: list[dict[str, str]] = []
    pinyin_hits: list[dict[str, str]] = []
    contain: list[dict[str, str]] = []
    for code, name, code_u, name_u, py in pool:
        item = {"code": code, "name": name or code}
        if code_u.startswith(key) or (name and name_u.startswith(key)):
            prefix.append(item)
            if len(prefix) >= n:
                return prefix
            continue
        if want_pinyin and py and any(k.startswith(key) for k in py):
            pinyin_hits.append(item)
            if len(prefix) + len(pinyin_hits) >= n:
                return prefix + pinyin_hits
            continue
        if key in code_u or (name and (key in name_u or keyword in name)):
            contain.append(item)
            if len(prefix) + len(pinyin_hits) + len(contain) >= n:
                return prefix + pinyin_hits + contain
    return (prefix + pinyin_hits + contain)[:n]


def search(q: str, n: int = 8, rows: list[dict[str, str]] | None = None) -> list[dict[str, str]]:
    """Local suggest: code/name prefix, then pinyin initials, then contains.

    Same file as load(), kept in process after the first read. Search ignores
    the 24h freshness gate. Thin names + non-digit query -> [] (Tencent).
    Inject rows in tests.
    """
    keyword = (q or "").strip()
    if not keyword or n <= 0:
        return []
    if rows is not None:
        return _scan(_prepare_injected(rows), keyword, n)
    packed, named = _index_rows()
    if not packed:
        return []
    key = keyword.upper()
    if not key.isdigit() and named < MIN_CODES:
        return []
    if key.isalpha() and key.isascii():
        packed = _index_with_pinyin()
    return _scan(packed, keyword, n)
