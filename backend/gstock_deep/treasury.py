"""US Treasury yield curve (FiscalData)."""
from __future__ import annotations

from datetime import datetime, timezone

from gstock_deep.official import official_get

def treasury_yield_curve(year: int | None = None) -> list[dict]:
    """Raw Treasury daily CSV rows (newest first). S-tier government data."""
    year = year or datetime.now().year
    url = (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        f"daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
        f"&field_tdr_date_value={year}&page&_format=csv"
    )
    raw = official_get(url)
    return list(csv.DictReader(io.StringIO(raw)))


def _parse_yield(row: dict, key: str) -> float | None:
    v = row.get(key)
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _norm_treasury_date(s: str) -> str:
    """MM/DD/YYYY -> YYYY-MM-DD."""
    try:
        return datetime.strptime(s.strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
    except Exception:
        return s


def treasury_curve_overview(year: int | None = None) -> dict:
    """Latest US Treasury yield curve (1M~30Y) + key spreads vs prior day."""
    rows = treasury_yield_curve(year)
    if not rows:
        # Jan 1-few days: prior year file may still hold the latest print
        y = year or datetime.now().year
        if y == datetime.now().year:
            rows = treasury_yield_curve(y - 1)
    if not rows:
        return {}
    latest, prev = rows[0], rows[1] if len(rows) > 1 else None
    points = []
    for csv_key, label in _TREASURY_TENORS:
        val = _parse_yield(latest, csv_key)
        if val is None:
            continue
        prev_v = _parse_yield(prev, csv_key) if prev else None
        points.append({
            "tenor": label,
            "yield": val,
            "chg": round(val - prev_v, 2) if prev_v is not None else None,
        })
    y2 = _parse_yield(latest, "2 Yr")
    y10 = _parse_yield(latest, "10 Yr")
    y30 = _parse_yield(latest, "30 Yr")
    y3m = _parse_yield(latest, "3 Mo")
    return {
        "date": _norm_treasury_date(str(latest.get("Date") or "")),
        "prev_date": _norm_treasury_date(str(prev.get("Date") or "")) if prev else None,
        "source": "U.S. Department of the Treasury",
        "compliance": "S",
        "points": points,
        "spreads": {
            "ten_two": round(y10 - y2, 2) if y10 is not None and y2 is not None else None,
            "thirty_ten": round(y30 - y10, 2) if y30 is not None and y10 is not None else None,
            "ten_three_month": round(y10 - y3m, 2) if y10 is not None and y3m is not None else None,
        },
    }

