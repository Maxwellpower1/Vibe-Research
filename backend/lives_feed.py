"""Sina 7x24 zhibo + Wallstreetcn live + Jin10 flash_newest.js.

CLS lives in the review news cell. This is the extra live wire.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

import astock

_UA = astock.UA
JIN10_JS = "https://www.jin10.com/flash_newest.js"
_HEADLINE_RE = re.compile(r"^【(.+?)】([\s\S]*)$")
_SKIP_RE = re.compile(r"直播间|正在直播|点击进入")
# Live dump: 5=English exclusive, 1=Chinese dump (not a topic),
# 3=listed-company CN, 2=macro/geo CN, 4=timed notice. Not 股票/商品/债券.
JIN10_CHANNELS = {2: "宏观", 3: "股票", 4: "预告", 5: "英文"}


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


def jin10_tags(it: dict) -> list[str]:
    """Map Jin10 channel ids. Channel 1 is the Chinese dump, not a topic."""
    ids: list[int] = []
    for c in it.get("channel") or []:
        try:
            ids.append(int(c))
        except (TypeError, ValueError):
            continue
    labels: list[str] = []
    if it.get("important") == 1:
        labels.append("重要")
    if 2 in ids and 3 in ids:
        ids = [i for i in ids if i != 3]
    labels.extend(JIN10_CHANNELS[i] for i in ids if i in JIN10_CHANNELS)
    seen: set[str] = set()
    out: list[str] = []
    for lab in labels:
        if lab not in seen:
            seen.add(lab)
            out.append(lab)
    return out


def parse_jin10_item(it: dict) -> dict | None:
    """Map one flash_newest.js row to the lives item shape. Skip ads (type=1)."""
    if not isinstance(it, dict) or it.get("type") == 1:
        return None
    data = it.get("data") if isinstance(it.get("data"), dict) else {}
    raw = _strip_html(str(data.get("content") or data.get("title") or ""))
    if not raw or _SKIP_RE.search(raw):
        return None
    m = _HEADLINE_RE.match(raw)
    title = (m.group(1) if m else "").strip() or _strip_html(str(data.get("title") or ""))
    content = (m.group(2) if m else raw).strip()
    if not title:
        title = content
        content = ""
    elif content == title:
        content = ""
    return {
        "id": it.get("id"),
        "title": title,
        "content": content,
        "time": str(it.get("time") or ""),
        "tags": jin10_tags(it),
    }


def parse_jin10_js(payload: str, size: int) -> list[dict]:
    body = (payload or "").split("=", 1)[-1].strip()
    if body.endswith(";"):
        body = body[:-1]
    rows = json.loads(body)
    if not isinstance(rows, list):
        return []
    out: list[dict] = []
    for it in rows:
        parsed = parse_jin10_item(it)
        if parsed:
            out.append(parsed)
        if len(out) >= size:
            break
    return out


def jin10_flash(size: int = 40) -> dict:
    """Jin10 flash_newest.js JSONP. Same item shape as market_lives."""
    import requests

    n = max(1, min(int(size or 40), 50))
    r = requests.get(
        JIN10_JS,
        headers={"User-Agent": _UA, "Referer": "https://www.jin10.com/"},
        timeout=12,
    )
    r.raise_for_status()
    items = parse_jin10_js(r.text, n)
    return {"source": "jin10", "count": len(items), "items": items}
