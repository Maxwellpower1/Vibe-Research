"""OpenRouter daily rankings -> vendor/country token share."""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests

from ai_watch.store import read_json, write_json

log = logging.getLogger("ai_watch.openrouter")

_FILE = "openrouter-usage.json"
_EARLIEST = date(2025, 1, 1)
_MAX_SPAN = 200

VENDOR_MAP = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "google": "Google",
    "deepseek": "DeepSeek",
    "qwen": "通义千问",
    "minimax": "MiniMax",
    "z-ai": "智谱GLM",
    "moonshotai": "月之暗面",
    "stepfun": "阶跃星辰",
    "xiaomi": "小米",
    "tencent": "腾讯",
    "nvidia": "NVIDIA",
    "meta-llama": "Meta",
    "mistralai": "Mistral",
    "cohere": "Cohere",
    "x-ai": "xAI",
    "poolside": "Poolside",
    "meituan": "美团",
    "nex-agi": "nex-agi",
    "inclusionai": "inclusionai",
    "bytedance": "字节跳动",
    "baai": "BAAI",
    "perplexity": "Perplexity",
}

COUNTRY_MAP = {
    "腾讯": "🇨🇳中国",
    "小米": "🇨🇳中国",
    "DeepSeek": "🇨🇳中国",
    "智谱GLM": "🇨🇳中国",
    "月之暗面": "🇨🇳中国",
    "MiniMax": "🇨🇳中国",
    "阶跃星辰": "🇨🇳中国",
    "通义千问": "🇨🇳中国",
    "美团": "🇨🇳中国",
    "nex-agi": "🇨🇳中国",
    "字节跳动": "🇨🇳中国",
    "BAAI": "🇨🇳中国",
    "OpenAI": "🇺🇸美国",
    "Anthropic": "🇺🇸美国",
    "Google": "🇺🇸美国",
    "Meta": "🇺🇸美国",
    "NVIDIA": "🇺🇸美国",
    "xAI": "🇺🇸美国",
    "Cohere": "🇺🇸美国",
    "Poolside": "🇺🇸美国",
    "inclusionai": "🇺🇸美国",
    "Perplexity": "🇺🇸美国",
}


def _or_key() -> str:
    return (os.environ.get("OPENROUTER_API_KEY") or os.environ.get("VR_OPENROUTER_API_KEY") or "").strip()


def vendor_slug(slug: str) -> str:
    if slug == "other":
        return "其他"
    prefix = (slug or "").split("/")[0]
    return VENDOR_MAP.get(prefix, prefix)


def country_of(name: str) -> str:
    return COUNTRY_MAP.get(name, "🌍其他")


def _yesterday() -> date:
    return datetime.now(timezone.utc).date() - timedelta(days=1)


def _ranges(cached: list[dict]) -> list[tuple[str, str]]:
    today = datetime.now(timezone.utc).date()
    yesterday = _yesterday()
    yesterday_s = yesterday.isoformat()
    if not cached:
        out: list[tuple[str, str]] = []
        s = _EARLIEST
        while s < today:
            e = min(s + timedelta(days=_MAX_SPAN - 1), yesterday)
            out.append((s.isoformat(), e.isoformat()))
            s = s + timedelta(days=_MAX_SPAN)
        return out
    last = max(r["date"] for r in cached if r.get("date"))
    nxt = date.fromisoformat(last) + timedelta(days=1)
    if nxt.isoformat() < yesterday_s:
        return [(nxt.isoformat(), yesterday_s)]
    return []


def _share_rows(vmap: dict[str, int]) -> tuple[list[dict], list[dict], int]:
    total = sum(vmap.values())
    if total <= 0:
        return [], [], 0
    providers = [
        {"name": name, "tokens": tok, "pct": round(tok * 10000 / total) / 100}
        for name, tok in sorted(vmap.items(), key=lambda x: -x[1])
    ]
    by_c: dict[str, int] = {}
    for p in providers:
        c = country_of(p["name"])
        by_c[c] = by_c.get(c, 0) + int(p["tokens"])
    countries = [
        {"name": name, "tokens": tok, "pct": round(tok * 10000 / total) / 100}
        for name, tok in sorted(by_c.items(), key=lambda x: -x[1])
    ]
    return providers, countries, total


def handle_openrouter_usage() -> list[dict[str, Any]]:
    cached = read_json(_FILE, [])
    if not isinstance(cached, list):
        cached = []
    cached_dates = {r.get("date") for r in cached if isinstance(r, dict)}
    ranges = _ranges(cached)
    if not ranges:
        return cached

    key = _or_key()
    if not key:
        log.warning("OPENROUTER_API_KEY missing; serving %s cached days", len(cached))
        return cached

    try:
        for start, end in ranges:
            url = "https://openrouter.ai/api/v1/datasets/rankings-daily"
            resp = requests.get(
                url,
                params={"start_date": start, "end_date": end},
                headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
                timeout=120,
            )
            resp.raise_for_status()
            rows = (resp.json() or {}).get("data") or []
            by_dv: dict[str, dict[str, int]] = {}
            for r in rows:
                if not isinstance(r, dict):
                    continue
                dt = r.get("date")
                if not dt or dt in cached_dates:
                    continue
                v = vendor_slug(str(r.get("model_permaslug") or "other"))
                tok = int(round(float(r.get("total_tokens") or 0)))
                bucket = by_dv.setdefault(str(dt), {})
                bucket[v] = bucket.get(v, 0) + tok
            for dt, vmap in by_dv.items():
                providers, countries, total = _share_rows(vmap)
                cached.append({
                    "date": dt,
                    "total": total,
                    "providers": providers,
                    "countries": countries,
                })
                cached_dates.add(dt)
        cached.sort(key=lambda r: r.get("date") or "")
        write_json(_FILE, cached)
        return cached
    except Exception as e:
        log.warning("openrouter fetch failed: %s", e)
        if cached:
            return cached
        return [{"date": _yesterday().isoformat(), "total": 0, "providers": [], "countries": []}]
