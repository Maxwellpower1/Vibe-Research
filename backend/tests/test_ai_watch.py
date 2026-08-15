"""AI infra compute_series: port of marketingdashboard ai-infra.test.cjs."""
from ai_watch.infra import MODEL, compute_series

INPUTS = {
    "capexHist": {2022: 146, 2023: 141, 2024: 225, 2025: 317},
    "depHist": {2022: 60, 2023: 70, 2024: 90, 2025: 110},
    "priceHist": {2022: 60, 2023: 30, 2024: 5, 2025: 1.5},
    "costHist": {2022: 25, 2023: 3, 2024: 1, 2025: 0.3},
    "gridAnchors": MODEL["gridAnchors"],
    "cloudRevHist": {2022: 146, 2023: 172, 2024: 205, 2025: 260},
    "modelCoHist": {
        2022: 0, 2023: 2, 2024: 6, 2025: 18, 2026: 70, 2027: 110, 2028: 160,
        2029: 215, 2030: 275, 2031: 330, 2032: 380, 2033: 425, 2034: 465, 2035: 500,
    },
}


def _by_year(series):
    return {p["year"]: p for p in series}


def test_history_actual_and_anchors():
    s = compute_series(INPUTS)
    h = [p for p in s if p["year"] < 2027]
    assert len(h) == 5
    assert all(p["actual"] is True for p in h)
    assert h[0]["capexB"] == 146
    assert h[3]["capexB"] == 317
    assert h[3]["pricePerM"] == 1.5
    assert h[4]["capexB"] > h[3]["capexB"]


def test_forecast_hard_landing():
    s = _by_year(compute_series(INPUTS))
    f = [p for p in s.values() if p["year"] >= 2027]
    assert len(f) == 9
    assert all(p["actual"] is False for p in f)
    assert s[2026]["capexB"] > s[2025]["capexB"]
    assert abs(s[2030]["capexB"] - s[2026]["capexB"]) / s[2026]["capexB"] < 0.15
    assert s[2035]["capexB"] <= s[2030]["capexB"] * 1.05


def test_price_cost_scissors():
    f = [p for p in compute_series(INPUTS) if p["year"] >= 2027]
    for i in range(1, len(f)):
        assert f[i]["pricePerM"] < f[i - 1]["pricePerM"]
        assert f[i]["costPerM"] < f[i - 1]["costPerM"]
    r1 = f[0]["pricePerM"] / f[0]["costPerM"]
    r_last = f[-1]["pricePerM"] / f[-1]["costPerM"]
    assert r_last > r1


def test_roi_turns_positive():
    s = _by_year(compute_series(INPUTS))
    assert s[2022]["roiPct"] < -30
    assert s[2025]["roiPct"] < -20
    assert s[2026]["roiPct"] > s[2025]["roiPct"]
    assert s[2027]["roiPct"] > 0
    years = sorted(y for y in s if y >= 2027)
    for a, b in zip(years, years[1:]):
        assert s[b]["roiPct"] >= s[a]["roiPct"]


def test_grid_policy_turn():
    s = compute_series(INPUTS)
    g = [p["grid"] for p in s]
    assert all(5 <= v <= 100 for v in g)
    assert g[0] == 82
    assert g[4] < 65
    assert g[5] > g[4]
