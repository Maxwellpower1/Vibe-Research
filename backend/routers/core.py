from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

import weather as weather_layer
from version import read_version

router = APIRouter(tags=["core"])
__version__ = read_version()

@router.get("/api/health")
def health():
    return {"ok": True, "service": "vibe-research-api", "version": __version__}


@router.get("/api/weather")
def weather(
    city: str = Query("上海", description="城市名 / 机场代码, 如 上海 / Shanghai / JFK"),
    days: int = Query(7, ge=1, le=16, description="预报天数, 1-16, 默认 7"),
):
    """Current weather + multi-day forecast. Open-Meteo primary (up to 16d), wttr enrich. No API key."""
    try:
        return {"data": weather_layer.get_weather(city, days=days)}
    except Exception as e:
        raise HTTPException(502, f"天气查询失败: {e}") from e
