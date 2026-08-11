"""EDGAR company-facts screener."""
from __future__ import annotations

from gstock_deep.common import DataNotAvailable
from gstock_deep.official import _require_sec_contact, official_get

def _frame_period(year: int, quarter: int | None, instant: bool) -> str:
    if instant:
        return f"CY{year}Q{quarter}I" if quarter else f"CY{year}Q4I"
    return f"CY{year}Q{quarter}" if quarter else f"CY{year}"


def market_frame(
    tag: str,
    year: int,
    quarter: int | None = None,
    unit: str = "USD",
    instant: bool | None = None,
) -> dict:
    """Full-market XBRL frame. tag: Chinese key or raw us-gaap tag."""
    tag = XBRL_TAGS.get(tag, tag)
    guess = (tag in _INSTANT_TAGS) if instant is None else instant
    attempts = [guess] if instant is not None else [guess, not guess]
    last_err: Exception | None = None
    for is_instant in attempts:
        period = _frame_period(year, quarter, is_instant)
        try:
            j = official_get(
                f"https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/{unit}/{period}.json",
                timeout=45,
                as_json=True,
            )
        except DataNotAvailable as e:
            last_err = e
            continue
        rows = [{
            "cik": d.get("cik"),
            "entity": d.get("entityName"),
            "value": d.get("val"),
            "end": d.get("end"),
        } for d in (j.get("data") or [])]
        return {
            "tag": tag, "period": period, "unit": unit,
            "instant": is_instant, "count": len(rows), "data": rows,
        }
    if last_err:
        raise last_err
    raise DataNotAvailable(f"no frame for {tag} {year} Q{quarter}")


def frame_ranking(frame: dict, top: int = 20, ascending: bool = False) -> list[dict]:
    data = [r for r in (frame.get("data") or []) if r.get("value") is not None]
    return sorted(data, key=lambda x: x["value"], reverse=not ascending)[:top]


def edgar_screener(
    tag: str = "净利润",
    year: int | None = None,
    quarter: int | None = None,
    top: int = 20,
    ascending: bool = False,
) -> dict:
    """Dashboard helper: ranked EDGAR frame + tag catalog."""
    y = int(year or (datetime.now().year - 1))
    q = int(quarter) if quarter is not None else None
    if q is not None and q not in (1, 2, 3, 4):
        q = None
    n = max(5, min(int(top or 20), 50))
    try:
        frame = market_frame(tag, y, q)
    except Exception:
        # Fallback: try prior year annual if quarterly missing
        if q is not None:
            frame = market_frame(tag, y, None)
        else:
            frame = market_frame(tag, y - 1, None)
    ranking = frame_ranking(frame, top=n, ascending=ascending)
    label = next((k for k, v in XBRL_TAGS.items() if v == frame["tag"]), frame["tag"])
    return {
        "compliance": "S",
        "source": "SEC EDGAR frames",
        "tag": frame["tag"],
        "tag_label": label,
        "period": frame["period"],
        "unit": frame["unit"],
        "instant": frame["instant"],
        "universe": frame["count"],
        "ascending": ascending,
        "tags": [{"label": k, "tag": v} for k, v in XBRL_TAGS.items()],
        "rows": ranking,
    }


# ── Market movers (Eastmoney clist) ───────────────────────────────────────

_MKT_FS = {
    "us_nasdaq": "m:105",
    "us_nyse": "m:106",
    "us_etf": "m:107",
    "hk": "m:116",
}

