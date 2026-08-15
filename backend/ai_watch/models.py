"""Artificial Analysis model table + TrakToken spend index."""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

import requests

from ai_watch.store import read_json, write_json
from gstock_deep.common import _UA

log = logging.getLogger("ai_watch.models")

_AA_FILE = "model-prices.json"
_TTSI_CSV = Path(__file__).resolve().parent.parent / "data" / "ttsi.csv"


def _aa_key() -> str:
    return (os.environ.get("ARTIFICIAL_ANALYSIS_API_KEY") or "").strip()


def _num(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _today() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def handle_aa_models() -> dict[str, Any]:
    key = _aa_key()
    hist = read_json(_AA_FILE, {}) or {}
    if not isinstance(hist, dict):
        hist = {}

    models: list[dict] = []
    if key:
        try:
            page = 1
            has_more = True
            while has_more and page <= 4:
                r = requests.get(
                    "https://artificialanalysis.ai/api/v2/language/models/free",
                    params={"page": page, "page_size": 200},
                    headers={"x-api-key": key, "User-Agent": _UA, "Referer": "https://artificialanalysis.ai/"},
                    timeout=30,
                )
                r.raise_for_status()
                j = r.json() or {}
                for d in j.get("data") or []:
                    intel_cost = d.get("artificial_analysis_intelligence_index_cost") or {}
                    cost = (intel_cost.get("cost_per_task") or {}).get("total_cost")
                    models.append({
                        "slug": d.get("slug"),
                        "name": d.get("name"),
                        "vendor": ((d.get("model_creator") or {}).get("name")) or "",
                        "release": d.get("release_date") or "",
                        "intel": (d.get("evaluations") or {}).get("artificial_analysis_intelligence_index"),
                        "input": (d.get("pricing") or {}).get("price_1m_input_tokens"),
                        "output": (d.get("pricing") or {}).get("price_1m_output_tokens"),
                        "cacheHit": (d.get("pricing") or {}).get("price_1m_cache_hit_tokens"),
                        "taskCost": cost,
                    })
                has_more = (j.get("pagination") or {}).get("has_more") is True
                page += 1
        except Exception as e:
            log.warning("aa-models upstream fail: %s", e)
            models = []

    if not models and hist:
        for slug, h in hist.items():
            pts = (h or {}).get("points") or []
            last = pts[-1] if pts else {}
            task = intel = None
            for p in reversed(pts):
                if task is None and p.get("task") is not None:
                    task = p.get("task")
                if intel is None and p.get("intel") is not None:
                    intel = p.get("intel")
                if task is not None and intel is not None:
                    break
            if last.get("i") is None and last.get("o") is None:
                continue
            models.append({
                "slug": slug,
                "name": (h or {}).get("name") or slug,
                "vendor": (h or {}).get("vendor") or "",
                "release": "",
                "intel": intel,
                "input": last.get("i"),
                "output": last.get("o"),
                "cacheHit": None,
                "taskCost": task,
            })
        return {
            "models": models,
            "history": hist,
            "source": "local snapshot (AA upstream unavailable)",
        }

    if not models:
        note = "未配置 ARTIFICIAL_ANALYSIS_API_KEY" if not key else "AA 暂无数据"
        return {"models": [], "history": hist, "source": note}

    today = _today()
    for m in models:
        if m.get("input") is None and m.get("output") is None:
            continue
        slug = m.get("slug") or ""
        arr = hist.get(slug) or {"name": m.get("name"), "vendor": m.get("vendor"), "points": []}
        pts = arr.setdefault("points", [])
        if pts and pts[-1].get("t") == today:
            pts[-1].update({"i": m.get("input"), "o": m.get("output"), "task": m.get("taskCost"), "intel": m.get("intel")})
        else:
            pts.append({"t": today, "i": m.get("input"), "o": m.get("output"), "task": m.get("taskCost"), "intel": m.get("intel")})
        if len(pts) > 730:
            del pts[:-730]
        hist[slug] = arr
    try:
        write_json(_AA_FILE, hist)
    except OSError as e:
        log.warning("aa-models save fail: %s", e)
    return {"models": models, "history": hist, "source": "Artificial Analysis free API"}


def _parse_ttsi_csv(text: str) -> list[dict]:
    points: list[dict] = []
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        f = line.split(",")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", f[0] if f else ""):
            continue
        points.append({
            "date": f[0],
            "ttsi": _num(f[3] if len(f) > 3 else None),
            "indexPoint": _num(f[1] if len(f) > 1 else None),
            "closed": _num(f[6] if len(f) > 6 else None),
            "open": _num(f[8] if len(f) > 8 else None),
            "premium": _num(f[9] if len(f) > 9 else None),
            "pct": None,
        })
    return points


def _strip_tag(block: str, tag: str) -> str:
    m = re.search(rf"<{tag}>([\s\S]*?)</{tag}>", block)
    if not m:
        return ""
    return re.sub(r"<[^>]+>", "", m.group(1)).replace("&amp;", "&").strip()


def handle_spend_index() -> dict[str, Any]:
    csv_points: list[dict] = []
    if _TTSI_CSV.is_file():
        try:
            csv_points = _parse_ttsi_csv(_TTSI_CSV.read_text(encoding="utf-8"))
        except OSError as e:
            log.warning("ttsi csv read: %s", e)
    csv_dates = {p["date"] for p in csv_points}

    r = requests.get(
        "https://www.traktoken.com/spend-index/feed.xml",
        headers={"User-Agent": _UA, "Referer": "https://www.traktoken.com/"},
        timeout=20,
    )
    r.raise_for_status()
    text = r.text
    rss_points: list[dict] = []
    events: list[dict] = []
    for m in re.finditer(r"<item>([\s\S]*?)</item>", text):
        it = m.group(1)
        title = _strip_tag(it, "title")
        desc = _strip_tag(it, "description")
        dm = re.match(r"^(\d{4}-\d{2}-\d{2})", title)
        if not dm:
            continue
        ttsi_m = re.search(r"\$([\d.]+)/M", title)
        pct_m = re.search(r"([+-][\d.]+)%", title)
        def _g(pat: str) -> float | None:
            mm = re.search(pat, desc)
            return _num(mm.group(1) if mm else None)
        rss_points.append({
            "date": dm.group(1),
            "ttsi": float(ttsi_m.group(1)) if ttsi_m else None,
            "pct": float(pct_m.group(1)) if pct_m else None,
            "indexPoint": _g(r"指数点位\s*([\d.]+)"),
            "closed": _g(r"闭源前沿\s*\$([\d.]+)/M"),
            "open": _g(r"开源权重\s*\$([\d.]+)/M"),
            "premium": _g(r"前沿溢价\s*([\d.]+)\s*倍"),
        })
        parts = [s.strip() for s in title.split("·")]
        if len(parts) >= 3 and not parts[2].startswith("TTSI"):
            events.append({"date": dm.group(1), "text": parts[2]})
    events.sort(key=lambda e: e["date"], reverse=True)
    merged = [*csv_points, *[p for p in rss_points if p["date"] not in csv_dates]]
    merged.sort(key=lambda p: p["date"])
    return {"points": merged, "events": events, "source": "TrakToken TTSI (CC BY 4.0)"}
