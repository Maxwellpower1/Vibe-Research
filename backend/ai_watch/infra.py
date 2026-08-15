"""AI infra CapEx / token economics / composite ROI (history + forecast)."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

import requests

from ai_watch.store import read_json, write_json
from gstock_deep.common import _UA
from gstock_deep.official import official_get

log = logging.getLogger("ai_watch.infra")

MODEL = {
    "gridAnchors": {2022: 82, 2023: 74, 2024: 68, 2025: 61},
    "gridCapCagr": 0.06,
    "gridDemandK": 1.0,
    "capexGrowth": [0.20, 0.05, 0.03, 0.02, 0.01, 0.00, -0.02, -0.02, -0.01, 0.00],
    "costDecline": -0.42,
    "priceDecline": -0.35,
    "priceStableFrom": 2027,
    "priceStableDecline": -0.12,
    "revenueGrowth": [0.30, 0.30, 0.28, 0.25, 0.20, 0.16, 0.13, 0.11, 0.09, 0.08],
    "aiShare": [0.15, 0.25, 0.45, 0.55, 0.62, 0.68, 0.72, 0.76, 0.79, 0.81, 0.83, 0.84, 0.85, 0.85],
    "aiCapexShare": [0.40, 0.50, 0.60, 0.70, 0.80, 0.85, 0.88, 0.90, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98],
}
START_YEAR = 2022
FORECAST_START = 2027
END_YEAR = 2035
CAPEX_ANCHORS = {2022: 146, 2023: 141, 2024: 225, 2025: 317}
DEP_ANCHORS = {2022: 60, 2023: 70, 2024: 90, 2025: 110}
PRICE_ANCHORS = {2022: 60, 2023: 30, 2024: 5, 2025: 3.4}
COST_ANCHORS = {2022: 25, 2023: 3, 2024: 1, 2025: 0.3}
CLOUD_REV = {2022: 146, 2023: 172, 2024: 205, 2025: 260}
MODEL_CO = {
    2022: 0, 2023: 2, 2024: 6, 2025: 18, 2026: 70, 2027: 110, 2028: 160,
    2029: 215, 2030: 275, 2031: 330, 2032: 380, 2033: 425, 2034: 465, 2035: 500,
}
FRONTIER = ("openai", "anthropic", "google", "x-ai", "mistralai", "meta-llama")
COMPANIES = [
    {
        "name": "MSFT", "cik": "0000789019",
        "capexTags": ["PaymentsToAcquirePropertyPlantAndEquipment", "CapitalExpenditures"],
        "depTags": ["DepreciationAmortizationAndAccretionNet", "DepreciationDepletionAndAmortization", "DepreciationAndAmortization"],
    },
    {
        "name": "GOOGL", "cik": "0001652044",
        "capexTags": ["PaymentsToAcquirePropertyPlantAndEquipment", "CapitalExpenditures"],
        "depTags": ["DepreciationAmortizationAndAccretionNet", "DepreciationDepletionAndAmortization", "DepreciationAndAmortization"],
    },
    {
        "name": "AMZN", "cik": "0001018724",
        "capexTags": ["PaymentsToAcquireProductiveAssets", "PaymentsToAcquirePropertyPlantAndEquipment", "CapitalExpenditures"],
        "depTags": ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization"],
    },
    {
        "name": "META", "cik": "0001326801",
        "capexTags": ["PaymentsToAcquirePropertyPlantAndEquipment", "CapitalExpenditures"],
        "depTags": ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization"],
    },
]


def _hy(d: dict | None, y: int, default=None):
    if not d:
        return default
    if y in d:
        return d[y]
    return d.get(str(y), default)


def compute_series(inputs: dict) -> list[dict]:
    capex_hist = inputs.get("capexHist") or {}
    dep_hist = inputs.get("depHist") or {}
    price_hist = inputs.get("priceHist") or {}
    cost_hist = inputs.get("costHist") or {}
    grid_anchors = inputs.get("gridAnchors") or MODEL["gridAnchors"]
    cloud_rev_hist = inputs.get("cloudRevHist") or {}
    model_co_hist = inputs.get("modelCoHist") or {}

    years = list(range(START_YEAR, END_YEAR + 1))
    capex: dict[int, float] = {}
    dep: dict[int, float] = {}
    price: dict[int, float | None] = {}
    cost: dict[int, float | None] = {}
    grid: dict[int, float] = {}
    revenue: dict[int, float] = {}
    actual: dict[int, bool] = {}
    cloud_revenue: dict[int, float] = {}

    for y in years:
        idx = y - FORECAST_START + 1
        is_forecast = y >= FORECAST_START
        if y == FORECAST_START - 1:
            capex[y] = round((capex.get(y - 1) or _hy(capex_hist, y - 1) or 0) * (1 + MODEL["capexGrowth"][0]))
            dep[y] = round((dep.get(y - 1) or _hy(dep_hist, y - 1) or 0) * 1.15)
            prev_p = price.get(y - 1) or _hy(price_hist, y - 1) or 0
            price[y] = _hy(price_hist, y)
            if price[y] is None:
                price[y] = round(prev_p * (1 + MODEL["priceDecline"]), 2)
            prev_c = cost.get(y - 1) or _hy(cost_hist, y - 1) or 0
            cost[y] = round(prev_c * (1 + MODEL["costDecline"]), 3)
            cloud_rev = (_hy(cloud_rev_hist, y - 1) or 0) * (1 + MODEL["revenueGrowth"][0])
            grid[y] = max(5, min(100, round(((_hy(grid_anchors, y) or grid.get(y - 1) or 50) * 0.97), 1)))
        elif is_forecast:
            capex[y] = round(capex[y - 1] * (1 + MODEL["capexGrowth"][idx]))
            dep[y] = round(dep[y - 1] * 1.15)
            decl = MODEL["priceStableDecline"] if y >= MODEL["priceStableFrom"] else MODEL["priceDecline"]
            price[y] = round((price[y - 1] or 0) * (1 + decl), 2)
            cost[y] = round((cost[y - 1] or 0) * (1 + MODEL["costDecline"]), 3)
            cloud_rev = cloud_revenue[y - 1] * (1 + MODEL["revenueGrowth"][idx])
            grid[y] = max(5, min(100, round(grid[y - 1] + 6.5, 1)))
        else:
            capex[y] = _hy(capex_hist, y, 0) or 0
            dep[y] = _hy(dep_hist, y, 0) or 0
            price[y] = _hy(price_hist, y)
            cost[y] = _hy(cost_hist, y)
            cloud_rev = _hy(cloud_rev_hist, y, 0) or 0
            grid[y] = _hy(grid_anchors, y, 50) or 50
        cloud_revenue[y] = cloud_rev
        share_idx = y - START_YEAR
        model_co = _hy(model_co_hist, y, 0) or 0
        revenue[y] = round(cloud_rev * MODEL["aiShare"][share_idx] + model_co)
        actual[y] = not is_forecast

    out = []
    for y in years:
        ai_cap = capex[y] * MODEL["aiCapexShare"][y - START_YEAR]
        roi = round(((revenue[y] - ai_cap) / ai_cap) * 100, 1) if ai_cap > 0 else 0
        out.append({
            "year": y,
            "capexB": capex[y],
            "depB": dep[y],
            "pricePerM": price[y],
            "costPerM": cost[y],
            "grid": grid[y],
            "revenueB": revenue[y],
            "roiPct": roi,
            "actual": actual[y],
        })
    return out


def _annual_tag(cik: str, tag: str) -> dict[str, float] | None:
    j = official_get(
        f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
        timeout=20,
        as_json=True,
    )
    units = (((j or {}).get("facts") or {}).get("us-gaap") or {}).get(tag) or {}
    usd = (units.get("units") or {}).get("USD") or []
    out: dict[str, float] = {}
    for e in usd:
        if e.get("form") != "10-K" or e.get("val") is None:
            continue
        end = str(e.get("end") or "")
        if len(end) < 4:
            continue
        y = end[:4]
        if y not in out:
            out[y] = e["val"]
    return out or None


def _fetch_company(comp: dict) -> dict:
    capex = dep = None
    for t in comp["capexTags"]:
        try:
            capex = _annual_tag(comp["cik"], t)
        except Exception:
            capex = None
        if capex:
            break
    for t in comp["depTags"]:
        try:
            dep = _annual_tag(comp["cik"], t)
        except Exception:
            dep = None
        if dep:
            break
    return {"name": comp["name"], "capex": capex or {}, "dep": dep or {}}


def fetch_sec_capex() -> dict:
    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(_fetch_company, COMPANIES))
    years: set[str] = set()
    for r in results:
        years.update(r["capex"])
        years.update(r["dep"])
    capex_total: dict[int, float] = {}
    dep_total: dict[int, float] = {}
    for y in sorted(years):
        cap_sum = sum(r["capex"].get(y, 0) for r in results)
        dep_sum = sum(r["dep"].get(y, 0) for r in results)
        yi = int(y)
        if cap_sum > 0:
            capex_total[yi] = round(cap_sum / 1e9, 1)
        if dep_sum > 0:
            dep_total[yi] = round(dep_sum / 1e9, 1)
    try:
        hist = read_json("sec-capex-history.json", {}) or {}
        hist[datetime.now(timezone.utc).strftime("%Y-%m-%d")] = {
            "capexTotal": {str(k): v for k, v in capex_total.items()},
            "depTotal": {str(k): v for k, v in dep_total.items()},
        }
        write_json("sec-capex-history.json", hist)
    except OSError:
        pass
    return {"byCompany": results, "capexTotal": capex_total, "depTotal": dep_total}


def fetch_token_prices() -> dict:
    live = None
    try:
        r = requests.get("https://openrouter.ai/api/v1/models", headers={"User-Agent": _UA}, timeout=20)
        r.raise_for_status()
        all_m = (r.json() or {}).get("data") or []
        in_prices = []
        front_prices = []
        for m in all_m:
            try:
                v = float((m.get("pricing") or {}).get("prompt")) * 1e6
            except (TypeError, ValueError):
                continue
            if not (0 < v < 10000):
                continue
            in_prices.append(v)
            mid = str(m.get("id") or "")
            if any(mid.startswith(f) for f in FRONTIER):
                front_prices.append(v)
        market = round(sum(in_prices) / len(in_prices), 3) if in_prices else None
        frontier = round(sum(front_prices) / len(front_prices), 3) if front_prices else None
        live = {"marketInputPerM": market, "frontierInputPerM": frontier, "vendorCount": len({(m.get("id") or "").split("/")[0] for m in all_m})}
    except Exception as e:
        log.warning("openrouter models fail: %s", e)
    series = dict(PRICE_ANCHORS)
    if live and live.get("frontierInputPerM") is not None:
        series[2025] = live["frontierInputPerM"]
    return {"priceSeries": series, "costSeries": dict(COST_ANCHORS), "live": live}


def fetch_fred_ppi() -> dict:
    r = requests.get(
        "https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCU334413334413",
        headers={"User-Agent": _UA},
        timeout=20,
    )
    r.raise_for_status()
    rows: list[tuple[str, float]] = []
    for line in r.text.splitlines()[1:]:
        parts = line.split(",")
        if len(parts) < 2:
            continue
        try:
            rows.append((parts[0], float(parts[1])))
        except ValueError:
            continue
    if len(rows) < 13:
        raise RuntimeError("FRED PPI 数据不足")
    last = rows[-1]
    yoy = rows[-13]
    prev = rows[-25] if len(rows) >= 25 else None
    yoy12m = round(((last[1] - yoy[1]) / yoy[1]) * 100, 2)
    prev_yoy = round(((yoy[1] - prev[1]) / prev[1]) * 100, 2) if prev else None
    if prev_yoy is None:
        trend = "flat"
    elif yoy12m < prev_yoy:
        trend = "falling"
    elif yoy12m > prev_yoy:
        trend = "rising"
    else:
        trend = "flat"
    return {"trend": trend, "yoy12m": yoy12m}


def fetch_spend_points() -> list[dict]:
    from ai_watch.models import handle_spend_index
    return (handle_spend_index() or {}).get("points") or []


def handle_ai_infra() -> dict[str, Any]:
    sec_ok = token_ok = ppi_ok = spend_ok = None
    sec_err = token_err = ppi_err = spend_err = None
    with ThreadPoolExecutor(max_workers=4) as ex:
        f_sec = ex.submit(fetch_sec_capex)
        f_tok = ex.submit(fetch_token_prices)
        f_ppi = ex.submit(fetch_fred_ppi)
        f_sp = ex.submit(fetch_spend_points)
        try:
            sec_ok = f_sec.result()
        except Exception as e:
            sec_err = str(e)
        try:
            token_ok = f_tok.result()
        except Exception as e:
            token_err = str(e)
        try:
            ppi_ok = f_ppi.result()
        except Exception as e:
            ppi_err = str(e)
        try:
            spend_ok = f_sp.result()
        except Exception as e:
            spend_err = str(e)

    last_hist = read_json("sec-capex-history.json", {}) or {}
    last_snap = {}
    if isinstance(last_hist, dict) and last_hist:
        last_snap = list(last_hist.values())[-1] or {}
    sec_capex = (sec_ok or {}).get("capexTotal") or last_snap.get("capexTotal") or {}
    sec_dep = (sec_ok or {}).get("depTotal") or last_snap.get("depTotal") or {}
    capex_hist = {int(k): v for k, v in (sec_capex or CAPEX_ANCHORS).items()} if sec_capex else dict(CAPEX_ANCHORS)
    dep_hist = {int(k): v for k, v in (sec_dep or DEP_ANCHORS).items()} if sec_dep else dict(DEP_ANCHORS)
    price_hist = dict((token_ok or {}).get("priceSeries") or PRICE_ANCHORS)
    cost_hist = dict((token_ok or {}).get("costSeries") or COST_ANCHORS)

    if spend_ok:
        by_year: dict[str, list[float]] = {}
        for p in spend_ok:
            y = str(p.get("date") or "")[:4]
            closed = p.get("closed")
            if closed is None:
                continue
            by_year.setdefault(y, []).append(float(closed))
        for y, vals in by_year.items():
            if y in ("2025", "2026") and vals:
                price_hist[int(y)] = round(sum(vals) / len(vals), 2)

    series = compute_series({
        "capexHist": capex_hist,
        "depHist": dep_hist,
        "priceHist": price_hist,
        "costHist": cost_hist,
        "gridAnchors": MODEL["gridAnchors"],
        "cloudRevHist": dict(CLOUD_REV),
        "modelCoHist": dict(MODEL_CO),
    })
    live = (token_ok or {}).get("live") or {}
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "series": series,
        "sources": {
            "sec": {"ok": bool(sec_ok), "byCompany": (sec_ok or {}).get("byCompany"), "err": sec_err},
            "token": {
                "ok": bool(token_ok),
                "marketInputPerM": live.get("marketInputPerM"),
                "frontierInputPerM": live.get("frontierInputPerM"),
                "vendorCount": live.get("vendorCount"),
                "err": token_err,
            },
            "ppi": {"ok": bool(ppi_ok), **(ppi_ok or {}), "err": ppi_err},
            "spend": {"ok": bool(spend_ok), "days": len(spend_ok or []), "err": spend_err},
        },
        "notes": [
            "capex: SEC 10-K (PaymentsToAcquire*), forecast is model extrapolation",
            "grid: LBNL anchors + model (synthetic, unofficial)",
            "costPerM: public-research estimate, vendors do not disclose",
            "pricePerM: 2022-2024 anchors, 2025-2026 spend-index closed, 2027+ stable decline",
            "roiPct: (AI revenue - AI capex) / AI capex",
        ],
    }
