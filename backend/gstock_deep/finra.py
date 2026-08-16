"""FINRA short volume."""
from __future__ import annotations

import gstock
from gstock_deep.common import DataNotAvailable
from gstock_deep.official import _recent_weekdays, official_get

def short_volume_all(date: str | None = None, market: str = "CNMS") -> dict:
    for d in ([date] if date else _recent_weekdays(7)):
        try:
            raw = official_get(
                f"https://cdn.finra.org/equity/regsho/daily/{market}shvol{d}.txt"
            )
        except DataNotAvailable:
            continue
        rows = {}
        for line in raw.splitlines()[1:]:
            p = line.split("|")
            if len(p) < 5 or not p[1]:
                continue
            try:
                sv, se, tv = float(p[2]), float(p[3]), float(p[4])
            except ValueError:
                continue
            rows[p[1]] = {
                "short": sv, "short_exempt": se, "total": tv,
                "ratio": round(sv / tv, 4) if tv else None,
            }
        if rows:
            return {"date": d, "market": market, "count": len(rows), "data": rows}
    raise DataNotAvailable(f"no FINRA Reg SHO for {market}")


def short_volume_symbol(query: str, days: int = 10) -> dict:
    info = gstock.resolve_symbol(query)
    if not info or info.get("market") not in ("NASDAQ", "NYSE", "US"):
        return {}
    sym = info["code"].upper()
    out = []
    n = max(3, min(int(days or 10), 30))
    for d in _recent_weekdays(n * 2 + 5):
        if len(out) >= n:
            break
        try:
            snap = short_volume_all(date=d)
        except DataNotAvailable:
            continue
        rec = (snap.get("data") or {}).get(sym)
        if rec:
            out.append({"date": d, **rec})
    if not out:
        return {}
    return {
        "code": info["code"], "name": info["name"], "market": info["market"],
        "note": "short volume != short interest; use for daily trend only",
        "rows": out,
    }

