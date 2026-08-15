"""shy313 Tonghuashun concept / industry membership.

Upstream (same JSON tickflow uses):
  https://shy313.com/api/plugins/market_flow/exports/ths-concepts
  https://shy313.com/api/plugins/market_flow/exports/ths-industries

24h file cache under VR_DATA_DIR / ths-ext.json. Failure keeps last good file.
"""
from __future__ import annotations

import json
import os
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

_CONCEPT_URL = "https://shy313.com/api/plugins/market_flow/exports/ths-concepts"
_INDUSTRY_URL = "https://shy313.com/api/plugins/market_flow/exports/ths-industries"
_ENVELOPE = ("data", "list", "rows", "result", "results")
_TTL = 24 * 3600
_MEM: dict[str, Any] = {"ts": 0.0, "concepts": {}, "industries": {}}


def _data_path() -> Path:
    root = Path(os.environ.get("VR_DATA_DIR") or Path.home() / ".vibe-research")
    return root / "ths-ext.json"


def _norm_code(raw: Any) -> str:
    s = str(raw or "").strip().upper()
    if not s:
        return ""
    if "." in s:
        s = s.split(".", 1)[0]
    if s.isdigit() and len(s) <= 6:
        return s.zfill(6)
    return s if s.isdigit() and len(s) == 6 else ""


def _label(v: Any) -> str:
    if v is None:
        return ""
    t = str(v).strip()
    if t.casefold() in {"", "nan", "none", "null"}:
        return ""
    return t


def unwrap_rows(raw: Any) -> list[dict]:
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if isinstance(raw, dict):
        for k in _ENVELOPE:
            inner = raw.get(k)
            if isinstance(inner, list):
                return [x for x in inner if isinstance(x, dict)]
        for v in raw.values():
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
    return []


def parse_concepts(raw: Any) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in unwrap_rows(raw):
        code = _norm_code(r.get("code") or r.get("symbol") or r.get("股票代码"))
        if not code:
            continue
        concepts = r.get("concepts") or r.get("所属概念") or []
        if isinstance(concepts, str):
            concepts = [x for x in concepts.replace("；", ";").split(";") if x.strip()]
        labels = [_label(c) for c in concepts]
        labels = [x for x in labels if x]
        out[code] = {
            "code": code,
            "name": _label(r.get("name") or r.get("股票简称")),
            "concepts": labels,
        }
    return out


def parse_industries(raw: Any) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in unwrap_rows(raw):
        code = _norm_code(r.get("code") or r.get("symbol") or r.get("股票代码"))
        if not code:
            continue
        inds = r.get("industries") or r.get("所属同花顺行业") or []
        if isinstance(inds, str):
            inds = [x for x in inds.replace("－", "-").split("-") if x.strip()]
        labels = [_label(i) for i in inds]
        labels = [x for x in labels if x]
        out[code] = {
            "code": code,
            "name": _label(r.get("name") or r.get("股票简称")),
            "industries": labels,
            "path": "-".join(labels),
        }
    return out


def _fetch_json(url: str) -> Any:
    import requests
    import astock

    r = requests.get(
        url,
        headers={"User-Agent": astock.UA, "Accept": "application/json"},
        timeout=25,
    )
    r.raise_for_status()
    return r.json()


def _read_file() -> dict[str, Any] | None:
    p = _data_path()
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def _write_file(payload: dict[str, Any]) -> None:
    p = _data_path()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(p)
    except OSError:
        pass


def _apply(payload: dict[str, Any]) -> None:
    _MEM["ts"] = float(payload.get("ts") or 0)
    _MEM["concepts"] = payload.get("concepts") or {}
    _MEM["industries"] = payload.get("industries") or {}


def _fresh(ts: float) -> bool:
    return ts > 0 and (time.time() - ts) < _TTL


def load(force: bool = False) -> dict[str, Any]:
    """Return {concepts, industries}. Uses memory then 24h file, else fetch."""
    if not force and _fresh(float(_MEM.get("ts") or 0)) and _MEM.get("concepts"):
        return _MEM
    disk = _read_file()
    if disk and not force and _fresh(float(disk.get("ts") or 0)) and disk.get("concepts"):
        _apply(disk)
        return _MEM
    try:
        concepts = parse_concepts(_fetch_json(_CONCEPT_URL))
        industries = parse_industries(_fetch_json(_INDUSTRY_URL))
        if concepts:
            payload = {"ts": time.time(), "concepts": concepts, "industries": industries}
            _write_file(payload)
            _apply(payload)
            return _MEM
    except Exception:
        if disk and disk.get("concepts"):
            _apply(disk)
            return _MEM
        raise
    if disk and disk.get("concepts"):
        _apply(disk)
        return _MEM
    return _MEM


def profile(code: str) -> dict[str, Any]:
    c = _norm_code(code)
    if not c:
        return {}
    data = load()
    con = (data.get("concepts") or {}).get(c) or {}
    ind = (data.get("industries") or {}).get(c) or {}
    if not con and not ind:
        return {"code": c, "name": "", "industry": "", "industries": [], "concepts": [], "source": "shy313 ths"}
    return {
        "code": c,
        "name": con.get("name") or ind.get("name") or "",
        "industry": ind.get("path") or "",
        "industries": list(ind.get("industries") or []),
        "concepts": list(con.get("concepts") or []),
        "source": "shy313 ths",
    }


def _invert(kind: str) -> dict[str, list[str]]:
    data = load()
    inv: dict[str, list[str]] = defaultdict(list)
    if kind == "industry":
        for code, rec in (data.get("industries") or {}).items():
            path = (rec or {}).get("path") or ""
            if path:
                inv[path].append(code)
    else:
        for code, rec in (data.get("concepts") or {}).items():
            for lab in (rec or {}).get("concepts") or []:
                if lab:
                    inv[lab].append(code)
    return inv


def rotation(kind: str = "concept", top: int = 15) -> dict[str, Any]:
    """Today avg change-pct of THS concept / industry members."""
    import cross_section

    k = "industry" if kind == "industry" else "concept"
    n = max(5, min(int(top or 15), 40))
    pcts = cross_section.pct_map()
    names = {}
    data = load()
    bucket = data.get("industries") if k == "industry" else data.get("concepts")
    for code, rec in (bucket or {}).items():
        if rec.get("name"):
            names[code] = rec["name"]
    inv = _invert(k)
    rows: list[dict[str, Any]] = []
    for label, members in inv.items():
        hits = [(c, pcts[c]) for c in members if c in pcts]
        if len(hits) < 3:
            continue
        vals = [p for _, p in hits]
        up = sum(1 for p in vals if p > 0)
        down = sum(1 for p in vals if p < 0)
        leads = sorted(hits, key=lambda x: -x[1])[:3]
        rows.append({
            "name": label,
            "count": len(hits),
            "avg_pct": round(sum(vals) / len(vals), 2),
            "up": up,
            "down": down,
            "leads": [
                {"code": c, "name": names.get(c) or c, "pct": p}
                for c, p in leads
            ],
        })
    rows.sort(key=lambda r: -r["avg_pct"])
    return {
        "kind": k,
        "source": "shy313 ths + eastmoney clist",
        "n": len(pcts),
        "rows": rows[:n],
    }
