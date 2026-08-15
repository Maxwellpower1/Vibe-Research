"""A-share cross-section: change-pct percentiles + 8-band histogram.

Primary: Sina hs_a. Then Tencent quotes on a cached universe.
Does not persist the 5000-name map to API clients; callers that need it
(ths rotation) read pct_map() from the process cache.
"""
from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import astock
from cache import TTLCache, is_nonempty

UA = astock.UA
_UNIVERSE_TTL = 24 * 3600

_CACHE = TTLCache(maxsize=8, default_ttl=180, negative_ttl=15, name="breadth")

# Histogram edges in percent.
BANDS: tuple[tuple[str, float | None, float | None], ...] = (
    ("<-5%", None, -5.0),
    ("-5~-3%", -5.0, -3.0),
    ("-3~-1%", -3.0, -1.0),
    ("-1~0%", -1.0, 0.0),
    ("0~1%", 0.0, 1.0),
    ("1~3%", 1.0, 3.0),
    ("3~5%", 3.0, 5.0),
    (">5%", 5.0, None),
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
    if x != x:  # NaN
        return None
    return x


def quantile(xs: list[float], p: float) -> float | None:
    """Linear interpolation quantile. p in [0, 100]. xs must be sorted."""
    if not xs:
        return None
    if len(xs) == 1:
        return round(xs[0], 2)
    lo_p = max(0.0, min(100.0, float(p)))
    k = (lo_p / 100.0) * (len(xs) - 1)
    i = int(k)
    j = min(i + 1, len(xs) - 1)
    frac = k - i
    return round(xs[i] * (1.0 - frac) + xs[j] * frac, 2)


def compute_percentiles(pcts: list[float]) -> dict[str, Any]:
    xs = sorted(p for p in pcts if p is not None)
    n = len(xs)
    avg = round(sum(xs) / n, 2) if n else None
    return {
        "n": n,
        "p10": quantile(xs, 10),
        "p25": quantile(xs, 25),
        "p50": quantile(xs, 50),
        "p75": quantile(xs, 75),
        "p90": quantile(xs, 90),
        "avg": avg,
    }


def compute_histogram(pcts: list[float]) -> list[dict[str, Any]]:
    vals = [p for p in pcts if p is not None]
    total = len(vals) or 1
    out: list[dict[str, Any]] = []
    for label, low, high in BANDS:
        count = 0
        for v in vals:
            if low is None and high is not None and v < high:
                count += 1
            elif high is None and low is not None and v >= low:
                count += 1
            elif low is not None and high is not None and low <= v < high:
                count += 1
        out.append({"label": label, "count": count, "pct": round(count / total * 100, 2)})
    return out


def parse_sina_pcts(items: Any) -> dict[str, float]:
    """Sina getHQNodeData rows -> {code: change_pct}."""
    if not isinstance(items, list):
        return {}
    out: dict[str, float] = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        code = str(it.get("code") or "").strip()
        if not (code.isdigit() and len(code) == 6):
            continue
        pct = _finite(it.get("changepercent"))
        if pct is None:
            continue
        out[code] = pct
    return out


def _sina_hs_a(page: int, num: int, sort: str = "symbol", asc: int = 1) -> list:
    url = (
        "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        f"Market_Center.getHQNodeData?page={int(page)}&num={int(num)}"
        f"&sort={sort}&asc={int(asc)}&node=hs_a"
    )
    req = Request(url, headers={"User-Agent": UA, "Referer": "https://finance.sina.com.cn/"})
    with urlopen(req, timeout=15) as resp:
        arr = json.loads(resp.read().decode("utf-8", errors="replace"))
    return arr if isinstance(arr, list) else []


def _universe_path() -> Path:
    root = Path(os.environ.get("VR_DATA_DIR") or Path.home() / ".vibe-research")
    return root / "a-share-codes.json"


def _load_universe() -> list[str]:
    try:
        raw = json.loads(_universe_path().read_text(encoding="utf-8"))
        ts = float(raw.get("ts") or 0)
        codes = raw.get("codes") or []
        if time.time() - ts > _UNIVERSE_TTL:
            return []
        if not isinstance(codes, list) or len(codes) < 2000:
            return []
        return [c for c in codes if isinstance(c, str) and c.isdigit() and len(c) == 6]
    except Exception:
        return []


def _save_universe(codes: list[str]) -> None:
    uniq = []
    seen: set[str] = set()
    for c in codes:
        if c in seen or not (isinstance(c, str) and c.isdigit() and len(c) == 6):
            continue
        seen.add(c)
        uniq.append(c)
    if len(uniq) < 2000:
        return
    path = _universe_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"ts": time.time(), "codes": uniq}, ensure_ascii=False),
        encoding="utf-8",
    )


def _tencent_pcts(codes: list[str]) -> dict[str, float]:
    """Batch Tencent quotes. Does not write the 5s per-code quote cache."""
    chunks = [codes[i:i + 400] for i in range(0, len(codes), 400)]
    if not chunks:
        return {}

    def _one(chunk: list[str]) -> dict[str, float]:
        prefixed = [f"{astock.get_prefix(c)}{c}" for c in chunk]
        parsed = astock._parse_gtimg(astock._fetch_gtimg(prefixed))
        out: dict[str, float] = {}
        for code, q in parsed.items():
            pct = _finite((q or {}).get("change_pct"))
            if pct is None:
                continue
            out[code] = pct
        return out

    merged: dict[str, float] = {}
    with ThreadPoolExecutor(max_workers=min(6, len(chunks))) as pool:
        for part in pool.map(_one, chunks):
            merged.update(part)
    return merged


def fetch_market_pcts() -> dict[str, float]:
    """Full A-share change-pct map. Sina first, then Tencent universe."""
    pcts, _src = fetch_market_pcts_with_source()
    return pcts


def fetch_market_pcts_with_source() -> tuple[dict[str, float], str]:
    try:
        sina = parse_sina_pcts(_sina_hs_a(1, 4000))
    except Exception:
        sina = {}
    if len(sina) >= 2000:
        _save_universe(list(sina.keys()))
        return sina, "sina"

    codes = _load_universe()
    if len(codes) >= 2000:
        try:
            tencent = _tencent_pcts(codes)
        except Exception:
            tencent = {}
        if len(tencent) >= 1500:
            return tencent, "tencent"

    if sina:
        return sina, "sina"
    return {}, "none"


def _build_bundle() -> dict[str, Any]:
    pcts, source = fetch_market_pcts_with_source()
    vals = list(pcts.values())
    stats = compute_percentiles(vals)
    stats["histogram"] = compute_histogram(vals)
    stats["source"] = source
    return {"stats": stats, "pcts": pcts}


def get_bundle() -> dict[str, Any]:
    return _CACHE.get_or_set(
        "bundle",
        _build_bundle,
        ttl=180,
        valid=lambda v: bool(isinstance(v, dict) and v.get("pcts")),
        negative_ttl=15,
    )


def market_breadth() -> dict[str, Any]:
    """Public stats only (no per-code map)."""
    bundle = get_bundle()
    stats = bundle.get("stats") if isinstance(bundle, dict) else None
    return stats if isinstance(stats, dict) else {}


def pct_map() -> dict[str, float]:
    bundle = get_bundle()
    pcts = bundle.get("pcts") if isinstance(bundle, dict) else None
    return pcts if isinstance(pcts, dict) else {}
