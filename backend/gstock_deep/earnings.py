"""Nasdaq earnings calendar."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from gstock_deep.common import DataNotAvailable
from gstock_deep.official import official_get

def earnings_calendar(date: str | None = None) -> dict:
    """Nasdaq earnings calendar for one day. date=YYYY-MM-DD, default US/Eastern today."""
    day = date or _et_today()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        return {}
    j = official_get(
        "https://api.nasdaq.com/api/calendar/earnings",
        params={"date": day},
        headers={
            "Accept": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Origin": "https://www.nasdaq.com",
            "Referer": "https://www.nasdaq.com/",
        },
        as_json=True,
    )
    rows = ((j.get("data") or {}).get("rows")) or []
    return {
        "date": day,
        "count": len(rows),
        "rows": [{
            "symbol": r.get("symbol"),
            "name": r.get("name"),
            "time": r.get("time"),
            "eps_forecast": r.get("epsForecast"),
            "market_cap": r.get("marketCap"),
        } for r in rows],
    }


def earnings_calendar_range(
    start: str | None = None,
    days: int = 7,
    *,
    skip_weekends: bool = True,
) -> dict:
    """Upcoming Nasdaq earnings over a date window (per-day API, aggregated).

    start: YYYY-MM-DD (default US/Eastern today).
    days: number of calendar days to cover (1..14); weekends skipped by default.
    """
    n = max(1, min(int(days or 7), 14))
    start_s = start or _et_today()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start_s):
        return {}
    cur = datetime.strptime(start_s, "%Y-%m-%d").date()
    by_day: list[dict] = []
    flat: list[dict] = []
    covered = 0
    guard = 0
    while covered < n and guard < n + 10:
        guard += 1
        if skip_weekends and cur.weekday() >= 5:
            cur += timedelta(days=1)
            continue
        day = cur.strftime("%Y-%m-%d")
        try:
            one = earnings_calendar(day)
        except Exception:
            one = {"date": day, "count": 0, "rows": []}
        rows = one.get("rows") or []
        by_day.append({"date": day, "count": len(rows), "rows": rows})
        for r in rows:
            flat.append({"date": day, **r})
        covered += 1
        cur += timedelta(days=1)
    if not by_day:
        return {}
    return {
        "start": by_day[0]["date"],
        "end": by_day[-1]["date"],
        "days": len(by_day),
        "total": len(flat),
        "by_day": by_day,
        # Backward-compatible single-day fields (first day)
        "date": f"{by_day[0]['date']}~{by_day[-1]['date']}",
        "count": len(flat),
        "rows": flat,
    }


# Display order for the yield curve (skip rarely used 1.5 Month in UI points).
_TREASURY_TENORS = (
    ("1 Mo", "1M"), ("2 Mo", "2M"), ("3 Mo", "3M"), ("4 Mo", "4M"),
    ("6 Mo", "6M"), ("1 Yr", "1Y"), ("2 Yr", "2Y"), ("3 Yr", "3Y"),
    ("5 Yr", "5Y"), ("7 Yr", "7Y"), ("10 Yr", "10Y"), ("20 Yr", "20Y"),
    ("30 Yr", "30Y"),
)

