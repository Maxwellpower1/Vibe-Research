"""Weather data layer: wttr.in (primary) + Open-Meteo (fallback).

No API key. Stdlib only. Returns a normalized payload for the frontend.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

UA = (
    "Mozilla/5.0 (compatible; Vibe-Research/0.2; +https://github.com/simonlin1212/Vibe-Research)"
)

# WMO weather interpretation codes (Open-Meteo) -> short zh label
_WMO_ZH: dict[int, str] = {
    0: "晴",
    1: "大体晴",
    2: "多云",
    3: "阴",
    45: "雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "大毛毛雨",
    56: "冻毛毛雨",
    57: "强冻毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    66: "冻雨",
    67: "强冻雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "雪粒",
    80: "阵雨",
    81: "强阵雨",
    82: "暴雨",
    85: "阵雪",
    86: "强阵雪",
    95: "雷雨",
    96: "雷雨伴冰雹",
    99: "强雷雨伴冰雹",
}


def _get(url: str, timeout: float = 12) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _num(v: Any, default: float | None = None) -> float | None:
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _first_val(arr: Any, key: str = "value") -> str:
    if isinstance(arr, list) and arr:
        item = arr[0]
        if isinstance(item, dict):
            return str(item.get(key) or "").strip()
        return str(item).strip()
    return ""


def _wttr_hour_label(date: str, time_raw: Any) -> str:
    """wttr hourly time is like 0 / 300 / 1200 -> YYYY-MM-DDTHH:MM."""
    try:
        t = int(str(time_raw).strip())
    except (TypeError, ValueError):
        t = 0
    hh, mm = divmod(t, 100)
    return f"{date}T{hh:02d}:{mm:02d}"


def _from_wttr(city: str) -> dict[str, Any]:
    q = urllib.parse.quote(city.strip())
    # j1 includes hourly slots; j2 is a lighter payload without hourly
    raw = json.loads(_get(f"https://wttr.in/{q}?format=j1&lang=zh").decode("utf-8", "replace"))
    cur = (raw.get("current_condition") or [{}])[0]
    area = (raw.get("nearest_area") or [{}])[0]
    days_raw = raw.get("weather") or []

    location = _first_val(area.get("areaName")) or city
    region = _first_val(area.get("region"))
    country = _first_val(area.get("country"))
    if region and region != location:
        location = f"{location}, {region}"
    if country:
        location = f"{location} · {country}"

    days: list[dict[str, Any]] = []
    hourly_points: list[dict[str, Any]] = []
    for d in days_raw[:7]:
        date = str(d.get("date") or "")
        hourly = d.get("hourly") or []
        mid = hourly[len(hourly) // 2] if hourly else {}
        cond = _first_val(mid.get("lang_zh")) or _first_val(mid.get("weatherDesc")) or "—"
        days.append(
            {
                "date": date,
                "max_c": _num(d.get("maxtempC")),
                "min_c": _num(d.get("mintempC")),
                "avg_c": _num(d.get("avgtempC")),
                "condition": cond,
                "chance_of_rain": _num(mid.get("chanceofrain")),
                "uv": _num(d.get("uvIndex")),
            }
        )
        for h in hourly:
            temp = _num(h.get("tempC"))
            if temp is None or not date:
                continue
            hourly_points.append(
                {
                    "time": _wttr_hour_label(date, h.get("time")),
                    "temp_c": temp,
                    "feels_like_c": _num(h.get("FeelsLikeC")),
                    "condition": _first_val(h.get("lang_zh"))
                    or _first_val(h.get("weatherDesc"))
                    or "",
                }
            )

    condition = (
        _first_val(cur.get("lang_zh"))
        or _first_val(cur.get("weatherDesc"))
        or "—"
    )

    return {
        "source": "wttr.in",
        "query": city,
        "location": location,
        "current": {
            "temp_c": _num(cur.get("temp_C")),
            "feels_like_c": _num(cur.get("FeelsLikeC")),
            "humidity": _num(cur.get("humidity")),
            "condition": condition,
            "wind_kmh": _num(cur.get("windspeedKmph")),
            "wind_dir": str(cur.get("winddir16Point") or ""),
            "visibility_km": _num(cur.get("visibility")),
            "pressure_mb": _num(cur.get("pressure")),
            "uv": _num(cur.get("uvIndex")),
            "precip_mm": _num(cur.get("precipMM")),
        },
        "forecast": days,
        "hourly": hourly_points,
    }


def _geocode_open_meteo(city: str) -> tuple[float, float, str]:
    q = urllib.parse.urlencode({"name": city.strip(), "count": 1, "language": "zh"})
    raw = json.loads(_get(f"https://geocoding-api.open-meteo.com/v1/search?{q}").decode("utf-8", "replace"))
    results = raw.get("results") or []
    if not results:
        raise ValueError(f"找不到地点: {city}")
    r0 = results[0]
    name = str(r0.get("name") or city)
    admin = str(r0.get("admin1") or "")
    country = str(r0.get("country") or "")
    label = name
    if admin and admin != name:
        label = f"{name}, {admin}"
    if country:
        label = f"{label} · {country}"
    return float(r0["latitude"]), float(r0["longitude"]), label


def _from_open_meteo(city: str, forecast_days: int = 7) -> dict[str, Any]:
    # Open-Meteo free forecast: 1..16 days
    forecast_days = max(1, min(int(forecast_days or 7), 16))
    lat, lon, location = _geocode_open_meteo(city)
    params = urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
            "hourly": "temperature_2m,apparent_temperature,weather_code",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max",
            "timezone": "auto",
            "forecast_days": forecast_days,
            "wind_speed_unit": "kmh",
        }
    )
    raw = json.loads(_get(f"https://api.open-meteo.com/v1/forecast?{params}").decode("utf-8", "replace"))
    cur = raw.get("current") or {}
    daily = raw.get("daily") or {}
    hourly = raw.get("hourly") or {}
    code = int(cur.get("weather_code") or 0)
    wind_dir_deg = _num(cur.get("wind_direction_10m"))
    dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    wind_dir = dirs[int((wind_dir_deg or 0) / 22.5 + 0.5) % 16] if wind_dir_deg is not None else ""

    days: list[dict[str, Any]] = []
    dates = daily.get("time") or []
    for i, date in enumerate(dates[:forecast_days]):
        d_code = int((daily.get("weather_code") or [0])[i] or 0)
        rains = daily.get("precipitation_probability_max") or []
        uvs = daily.get("uv_index_max") or []
        days.append(
            {
                "date": str(date),
                "max_c": _num((daily.get("temperature_2m_max") or [None])[i]),
                "min_c": _num((daily.get("temperature_2m_min") or [None])[i]),
                "avg_c": None,
                "condition": _WMO_ZH.get(d_code, f"code {d_code}"),
                "chance_of_rain": _num(rains[i]) if i < len(rains) else None,
                "uv": _num(uvs[i]) if i < len(uvs) else None,
            }
        )

    hourly_points: list[dict[str, Any]] = []
    times = hourly.get("time") or []
    temps = hourly.get("temperature_2m") or []
    feels = hourly.get("apparent_temperature") or []
    codes = hourly.get("weather_code") or []
    # Full hourly series for the requested forecast window (e.g. 7d -> 168 points)
    hour_cap = forecast_days * 24
    for i, t in enumerate(times[:hour_cap]):
        temp = _num(temps[i]) if i < len(temps) else None
        if temp is None:
            continue
        h_code = int(codes[i] or 0) if i < len(codes) else 0
        hourly_points.append(
            {
                "time": str(t),
                "temp_c": temp,
                "feels_like_c": _num(feels[i]) if i < len(feels) else None,
                "condition": _WMO_ZH.get(h_code, ""),
            }
        )

    return {
        "source": "open-meteo",
        "query": city,
        "location": location,
        "current": {
            "temp_c": _num(cur.get("temperature_2m")),
            "feels_like_c": _num(cur.get("apparent_temperature")),
            "humidity": _num(cur.get("relative_humidity_2m")),
            "condition": _WMO_ZH.get(code, f"code {code}"),
            "wind_kmh": _num(cur.get("wind_speed_10m")),
            "wind_dir": wind_dir,
            "visibility_km": None,
            "pressure_mb": None,
            "uv": None,
            "precip_mm": _num(cur.get("precipitation")),
        },
        "forecast": days,
        "hourly": hourly_points,
    }


def get_weather(city: str = "上海", days: int = 7) -> dict[str, Any]:
    """Fetch weather for city.

    Open-Meteo is primary for multi-day forecast (default 7, max 16).
    wttr.in fills richer current fields (visibility / pressure / UV) when available.
    """
    city = (city or "上海").strip() or "上海"
    days = max(1, min(int(days or 7), 16))
    errors: list[str] = []

    try:
        data = _from_open_meteo(city, forecast_days=days)
    except Exception as e:  # noqa: BLE001 - intentional fallback chain
        errors.append(f"open-meteo: {e}")
        try:
            data = _from_wttr(city)
            data["fallback_note"] = "; ".join(errors)
            return data
        except Exception as e2:  # noqa: BLE001
            errors.append(f"wttr.in: {e2}")
            raise RuntimeError("天气数据源均不可用: " + "; ".join(errors)) from e2

    # Enrich current metrics from wttr when possible (does not shrink the 7d forecast)
    try:
        wttr = _from_wttr(city)
        cur = data.get("current") or {}
        wcur = wttr.get("current") or {}
        for key in ("visibility_km", "pressure_mb", "uv", "precip_mm"):
            if cur.get(key) is None and wcur.get(key) is not None:
                cur[key] = wcur[key]
        if wcur.get("condition"):
            cur["condition"] = wcur["condition"]
        data["current"] = cur
        if wttr.get("location"):
            data["location"] = wttr["location"]
        data["source"] = "open-meteo + wttr.in"
    except Exception as e:  # noqa: BLE001 - enrichment is optional
        errors.append(f"wttr.in enrich: {e}")
        if errors:
            data["fallback_note"] = "; ".join(errors)

    return data
