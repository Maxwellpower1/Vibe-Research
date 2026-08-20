"""Global Fear & Greed board: crypto, US CNN, and vol-inverted regions.

One gauge list. HTTP / 问 AI / 宏观观察 tab read the same board.
Not an index-catalog or quote-hub feed.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable

import astock

log = logging.getLogger("fear_greed")

ALT_FNG = "https://api.alternative.me/fng/?limit=1"
CNN_GRAPH = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
GF_US = "https://www.greedyfear.com/api/us"
GF_VIX = "https://www.greedyfear.com/api/vix?region={region}"

# key, title, subtitle, kind, optional vix region + invert range
GAUGES: tuple[dict[str, Any], ...] = (
    {"key": "crypto", "title": "加密", "subtitle": "Alternative.me", "kind": "crypto"},
    {"key": "us", "title": "美股", "subtitle": "CNN Fear & Greed", "kind": "us"},
    {"key": "jp", "title": "日本", "subtitle": "日经225 30d波动", "kind": "vix",
     "region": "jp", "vix_min": 10.0, "vix_max": 40.0},
    {"key": "hk", "title": "港股", "subtitle": "恒指波动率", "kind": "vix",
     "region": "hk", "vix_min": 15.0, "vix_max": 45.0},
    {"key": "gold", "title": "黄金", "subtitle": "CBOE GVZ", "kind": "vix",
     "region": "gold", "vix_min": 10.0, "vix_max": 40.0},
    {"key": "oil", "title": "原油", "subtitle": "CBOE OVX", "kind": "vix",
     "region": "oil", "vix_min": 25.0, "vix_max": 80.0},
)

GAUGE_KEYS: tuple[str, ...] = tuple(g["key"] for g in GAUGES)


def score_label(score: int) -> str:
    if score <= 25:
        return "极度恐惧"
    if score <= 45:
        return "恐惧"
    if score <= 54:
        return "中性"
    if score <= 74:
        return "贪婪"
    return "极度贪婪"


def vix_to_score(value: float, vmin: float, vmax: float) -> int:
    if vmax <= vmin:
        return 50
    raw = 100.0 - (value - vmin) / (vmax - vmin) * 100.0
    return max(0, min(100, int(round(raw))))


def board_ok(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    items = data.get("items")
    if not isinstance(items, list):
        return False
    return any(isinstance(it, dict) and it.get("score") is not None for it in items)


def _num(v: Any) -> float | None:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n != n:
        return None
    return n


def _score(v: Any) -> int | None:
    n = _num(v)
    if n is None:
        return None
    return max(0, min(100, int(round(n))))


def _ts(v: Any) -> str | None:
    if v is None or v == "":
        return None
    if isinstance(v, str):
        s = v.strip()
        if s.replace(".", "", 1).isdigit():
            v = float(s)
        else:
            return s or None
    if isinstance(v, (int, float)) and v == v:
        sec = float(v)
        if sec > 1e12:
            sec /= 1000.0
        if sec > 1e9:
            return datetime.fromtimestamp(sec, tz=timezone.utc).isoformat()
    s = str(v).strip()
    return s or None


def _blank(gauge: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": gauge["key"],
        "title": gauge["title"],
        "subtitle": gauge["subtitle"],
        "score": None,
        "label": None,
        "raw": None,
        "detail": None,
        "timestamp": None,
        "source": None,
    }


def _fill(gauge: dict[str, Any], *, score: int, raw: float | None = None,
          detail: str | None = None, timestamp: str | None = None,
          source: str | None = None) -> dict[str, Any]:
    row = _blank(gauge)
    row["score"] = score
    row["label"] = score_label(score)
    row["raw"] = raw
    row["detail"] = detail
    row["timestamp"] = timestamp
    row["source"] = source
    return row


def _get_json(url: str, timeout: float = 12.0) -> dict[str, Any]:
    import requests

    headers = {
        "User-Agent": astock.UA,
        "Accept": "application/json,text/plain,*/*",
    }
    if "dataviz.cnn.io" in url:
        headers["Origin"] = "https://www.cnn.com"
        headers["Referer"] = "https://www.cnn.com/markets/fear-and-greed"
    r = requests.get(url, headers=headers, timeout=timeout)
    r.raise_for_status()
    ctype = (r.headers.get("content-type") or "").lower()
    if "text/html" in ctype:
        raise ValueError("html instead of json")
    data = r.json()
    if not isinstance(data, dict):
        raise ValueError("unexpected json shape")
    return data


def parse_crypto(payload: dict[str, Any]) -> tuple[int, str | None, str]:
    rows = payload.get("data")
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
        raise ValueError("crypto shape")
    row = rows[0]
    score = _score(row.get("value"))
    if score is None:
        raise ValueError("crypto score")
    return score, _ts(row.get("timestamp")), "alternative.me"


def parse_us(payload: dict[str, Any]) -> tuple[int, str | None, str | None, str]:
    src = str(payload.get("source") or "").strip().lower()
    if src == "mock":
        raise ValueError("mock us")
    fg = payload.get("fear_and_greed")
    if isinstance(fg, dict):
        score = _score(fg.get("score"))
        if score is None:
            raise ValueError("cnn score")
        prev = _num(fg.get("previous_close"))
        detail = f"昨收 {prev:.1f}" if prev is not None else None
        return score, _ts(fg.get("timestamp")), detail, "cnn"
    score = _score(payload.get("score"))
    if score is None:
        raise ValueError("us score")
    prev = None
    previous = payload.get("previous")
    if isinstance(previous, dict):
        prev = _num(previous.get("close"))
    if prev is None:
        prev = _num(payload.get("previous_close"))
    detail = f"昨收 {prev:.1f}" if prev is not None else None
    source = src or "cnn"
    return score, _ts(payload.get("timestamp")), detail, source


def parse_vix(payload: dict[str, Any], gauge: dict[str, Any]) -> tuple[int, float, str | None, str]:
    src = str(payload.get("source") or "").strip().lower()
    if src == "mock":
        raise ValueError("mock vix")
    raw = _num(payload.get("value") if payload.get("value") is not None else payload.get("close"))
    if raw is None:
        raw = _num(payload.get("price"))
    if raw is None:
        raise ValueError("vix value")
    vmin = float(gauge.get("vix_min") or 10)
    vmax = float(gauge.get("vix_max") or 40)
    score = _score(payload.get("score"))
    if score is None:
        score = vix_to_score(raw, vmin, vmax)
    return score, raw, _ts(payload.get("timestamp")), src or "vix"


def _fetch_crypto(fetch: Callable[[str], dict[str, Any]]) -> tuple[int, str | None, str]:
    return parse_crypto(fetch(ALT_FNG))


def _fetch_us(fetch: Callable[[str], dict[str, Any]]) -> tuple[int, str | None, str | None, str]:
    last: Exception | None = None
    for url in (CNN_GRAPH, GF_US):
        try:
            return parse_us(fetch(url))
        except Exception as e:
            last = e
            log.info("us gauge %s failed: %s", url, e)
    raise last or RuntimeError("us gauge empty")


def _fetch_vix(fetch: Callable[[str], dict[str, Any]], gauge: dict[str, Any]) -> tuple[int, float, str | None, str]:
    region = str(gauge.get("region") or "")
    return parse_vix(fetch(GF_VIX.format(region=region)), gauge)


def _one(gauge: dict[str, Any], fetch: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
    kind = gauge.get("kind")
    try:
        if kind == "crypto":
            score, ts, src = _fetch_crypto(fetch)
            return _fill(gauge, score=score, timestamp=ts, source=src)
        if kind == "us":
            score, ts, detail, src = _fetch_us(fetch)
            return _fill(gauge, score=score, detail=detail, timestamp=ts, source=src)
        if kind == "vix":
            score, raw, ts, src = _fetch_vix(fetch, gauge)
            return _fill(
                gauge,
                score=score,
                raw=raw,
                detail=f"波动 {raw:.2f}",
                timestamp=ts,
                source=src,
            )
        raise ValueError(f"unknown kind {kind}")
    except Exception as e:
        log.info("gauge %s failed: %s", gauge.get("key"), e)
        return _blank(gauge)


def board(*, fetch: Callable[[str], dict[str, Any]] | None = None) -> dict[str, Any]:
    """Fetch all gauges. Missing rows stay in order with score=None."""
    fn = fetch or _get_json
    items: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=len(GAUGES)) as pool:
        futs = [pool.submit(_one, g, fn) for g in GAUGES]
        items = [f.result() for f in futs]
    return {
        "items": items,
        "updated": datetime.now(timezone.utc).isoformat(),
    }
