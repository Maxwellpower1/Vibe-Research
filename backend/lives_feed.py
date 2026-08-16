"""Sina 7x24 zhibo + Wallstreetcn live (marketingdashboard /api/news).

CLS stays on the floating bubble. This is the extra live wire.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import astock

_UA = astock.UA


def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s or "").strip()


def parse_sina_item(it: dict) -> dict:
    raw = str(it.get("rich_text") or "")
    m = re.match(r"^【(.+?)】([\s\S]*)$", raw)
    return {
        "id": it.get("id"),
        "title": m.group(1) if m else "",
        "content": m.group(2) if m else raw,
        "time": it.get("create_time") or "",
    }


def parse_wscn_items(payload: dict, size: int) -> list[dict]:
    items = ((payload.get("data") or {}).get("items") or [])[:size]
    out: list[dict] = []
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        text = it.get("content_text") or it.get("content") or ""
        if not text:
            continue
        sec = it.get("display_time")
        ts = ""
        if isinstance(sec, (int, float)) and sec > 0:
            ts = datetime.fromtimestamp(sec, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        out.append({
            "id": it.get("id") or (int(sec) * 100 + i if isinstance(sec, (int, float)) else i),
            "title": it.get("title") or "",
            "content": _strip_html(str(text)),
            "time": ts,
        })
    return out


def sina_zhibo(page: int = 1, size: int = 40) -> list[dict]:
    import requests

    r = requests.get(
        "https://zhibo.sina.com.cn/api/zhibo/feed",
        params={"page": page, "page_size": size, "zhibo_id": 152, "tag_id": 0},
        headers={"User-Agent": _UA, "Referer": "https://finance.sina.com.cn/"},
        timeout=12,
    )
    r.raise_for_status()
    data: Any = r.json()
    rows = (((data.get("result") or {}).get("data") or {}).get("feed") or {}).get("list") or []
    return [parse_sina_item(it) for it in rows if isinstance(it, dict)]


def wscn_lives(size: int = 40) -> list[dict]:
    import requests

    r = requests.get(
        "https://api-one-wscn.awtmt.com/apiv1/content/lives",
        params={"channel": "global-channel", "limit": min(size, 50)},
        headers={"User-Agent": _UA},
        timeout=12,
    )
    r.raise_for_status()
    return parse_wscn_items(r.json() or {}, size)


def market_lives(page: int = 1, size: int = 40) -> dict:
    """Sina zhibo first; Wallstreetcn live if Sina is empty or down."""
    n = max(1, min(int(size or 40), 50))
    p = max(1, min(int(page or 1), 20))
    try:
        items = sina_zhibo(p, n)
        if items:
            return {"source": "sina", "count": len(items), "items": items}
    except Exception:
        items = []
    wscn = wscn_lives(n)
    return {"source": "wallstreetcn", "count": len(wscn), "items": wscn}
