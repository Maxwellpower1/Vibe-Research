"""Model research: labels, injected scores into top_k, no live train required."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from backtest.labels import forward_returns, limit_mask
from backtest.model import drift_summary, feature_cube, flatten_xy, run_model
from backtest.panel import build_panel


def _weekdays(n: int, start: str = "2023-01-02") -> list[str]:
    out: list[str] = []
    d = date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _panel(n_names: int = 8, n_days: int = 80):
    days = _weekdays(n_days)
    bars: dict[str, list[dict]] = {}
    for j in range(n_names):
        closes = [10.0 + j + t * (0.04 + j * 0.01) for t in range(n_days)]
        bars[f"sh{600000 + j}"] = [
            {
                "datetime": d,
                "open": c,
                "high": c + 0.2,
                "low": c - 0.2,
                "close": c,
                "adj_close": c,
                "volume": 100 + t,
            }
            for t, (d, c) in enumerate(zip(days, closes))
        ]
    return build_panel(bars), days


def test_forward_returns_horizon_and_limit():
    panel, _ = _panel(3, 20)
    y = forward_returns(panel, 5)
    assert np.isnan(y[-1]).all()
    assert np.isfinite(y[0]).all()
    assert y[0, 2] > y[0, 0]
    closes = [10, 11, 11, 11, 11, 11]
    opens = [10, 11.0, 11, 11, 11, 11]
    days = _weekdays(6)
    bars = {
        "sh600000": [
            {"datetime": d, "open": o, "high": max(o, c), "low": min(o, c), "close": c, "adj_close": c, "volume": 1}
            for d, o, c in zip(days, opens, closes)
        ],
        "sh600001": [
            {"datetime": d, "open": 10, "high": 10, "low": 10, "close": 10, "adj_close": 10, "volume": 1}
            for d in days
        ],
    }
    lim = build_panel(bars)
    mask = limit_mask(lim)
    assert bool(mask[1, 0])


def test_flatten_and_drift():
    panel, _ = _panel(6, 40)
    cube, names = feature_cube(panel, ["momentum_5", "change_1"])
    labels = forward_returns(panel, 3)
    x, y = flatten_xy(cube, labels, 5, 20)
    assert x.shape[1] == 2
    assert x.shape[0] == y.size
    assert x.shape[0] > 0
    rows = drift_summary(cube, names, 20)
    assert {r["feature"] for r in rows} == {"momentum_5", "change_1"}


def test_run_model_injected_scores(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    panel, days = _panel(8, 80)
    bars = {}
    for j, sym in enumerate(panel.symbols):
        bars[sym] = [
            {
                "datetime": panel.dates[i],
                "open": float(panel.close[i, j]),
                "high": float(panel.close[i, j]),
                "low": float(panel.close[i, j]),
                "close": float(panel.close[i, j]),
                "adj_close": float(panel.adj_close[i, j]),
                "volume": 100,
            }
            for i in range(panel.T)
        ]
    scores = np.zeros((panel.T, panel.S))
    for i in range(panel.T):
        scores[i] = np.arange(panel.S, dtype=float)
    out = run_model(
        {
            "codes": [s[-6:] for s in panel.symbols],
            "start": days[0],
            "end": days[-1],
            "horizon": 5,
            "rebalance": 10,
            "mom_win": 5,
            "commission_pct": 0,
            "commission_min": 0,
            "stamp_tax_pct": 0,
            "slippage_bps": 0,
            "initial_capital": 100000,
            "max_positions": 2,
        },
        bars_by_symbol=bars,
        score_matrix=scores,
    )
    assert out["run_id"]
    assert out["model"]["backend"] == "injected"
    assert out["oos"]["stats_oos_fresh"]
    assert out["strategy"]["name"] == "model"
    from backtest.archive import list_runs, read_run, result_from_run

    rows = list_runs(kind="model")
    assert rows[0]["id"] == out["run_id"]
    got = result_from_run(read_run(out["run_id"]))
    assert got["kind"] == "model"
    assert got["equity_curve"]


def test_run_model_missing_lgbm(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    panel, days = _panel(8, 80)
    bars = {}
    for j, sym in enumerate(panel.symbols):
        bars[sym] = [
            {
                "datetime": panel.dates[i],
                "open": float(panel.close[i, j]),
                "high": float(panel.close[i, j]),
                "low": float(panel.close[i, j]),
                "close": float(panel.close[i, j]),
                "adj_close": float(panel.adj_close[i, j]),
                "volume": 100,
            }
            for i in range(panel.T)
        ]
    monkeypatch.setattr("backtest.model._lgb", lambda: None)
    try:
        run_model(
            {
                "codes": [s[-6:] for s in panel.symbols],
                "start": days[0],
                "end": days[-1],
            },
            bars_by_symbol=bars,
        )
    except Exception as exc:
        assert "lightgbm" in str(exc).lower()
    else:
        raise AssertionError("expected missing lightgbm error")
