"""Factor IC / quintiles from a daily panel. No enriched store."""

from __future__ import annotations

from datetime import date, timedelta

from backtest.factor import evaluate, factor_matrix, run_factor, spearman
from backtest.panel import build_panel
from backtest.service import meta


def _weekdays(n: int, start: str = "2023-01-02") -> list[str]:
    out: list[str] = []
    d = date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _panel(n_names: int = 20, n_days: int = 80):
    days = _weekdays(n_days)
    bars: dict[str, list[dict]] = {}
    for j in range(n_names):
        # Higher j grows faster, so momentum should rank them last-to-first.
        closes = [10.0 + j + t * (0.05 + j * 0.02) for t in range(n_days)]
        bars[f"sh{600000 + j}"] = [
            {"datetime": d, "open": c, "high": c, "low": c, "close": c, "adj_close": c, "volume": 1}
            for d, c in zip(days, closes)
        ]
    return build_panel(bars), days


def test_spearman_perfect():
    x = __import__("numpy").arange(8, dtype=float)
    assert abs(spearman(x, x) - 1.0) < 1e-9
    assert abs(spearman(x, -x) + 1.0) < 1e-9


def test_momentum_matrix_uses_lookback():
    panel, _ = _panel(4, 12)
    fac = factor_matrix(panel, "momentum_5")
    assert __import__("numpy").isnan(fac[4]).all()
    assert __import__("numpy").isfinite(fac[5]).any()


def test_evaluate_momentum_positive_ic():
    panel, days = _panel(20, 90)
    out = evaluate(panel, "momentum_20", rebalance="monthly", n_groups=5, start=days[25])
    assert out["n_periods"] >= 2
    assert out["ic_mean"] is not None
    assert out["ic_mean"] > 0.2
    q1 = next(g for g in out["group_stats"] if g["label"] == "Q1")
    q5 = next(g for g in out["group_stats"] if g["label"] == "Q5")
    assert q5["total_return"] > q1["total_return"]
    assert out["long_short_stats"]["total_return"] > 0
    assert any("不是账户撮合" in w for w in out["warnings"])
    assert any("enriched" in w for w in out["warnings"])


def test_run_factor_injected_no_network():
    panel, days = _panel(16, 70)
    bars = {}
    for sym in panel.symbols:
        j = panel.symbols.index(sym)
        bars[sym] = [
            {
                "datetime": panel.dates[i],
                "open": float(panel.close[i, j]),
                "high": float(panel.close[i, j]),
                "low": float(panel.close[i, j]),
                "close": float(panel.close[i, j]),
                "adj_close": float(panel.adj_close[i, j]),
                "volume": 1,
            }
            for i in range(panel.T)
        ]
    out = run_factor(
        {
            "codes": [s[-6:] for s in panel.symbols],
            "start": days[0],
            "end": days[-1],
            "factor": "momentum_10",
            "rebalance": "weekly",
            "n_groups": 4,
        },
        bars_by_symbol=bars,
    )
    assert out["factor"]["id"] == "momentum_10"
    assert out["universe"]["pool"] == "codes"
    assert out["ic_series"]


def test_meta_lists_factors():
    data = meta()
    ids = {f["id"] for f in data["factors"]}
    assert "momentum_20" in ids
    assert "momentum_30" in ids
    assert "rsi_14" in ids
    assert "macd_hist" in ids
    assert "kdj_k" in ids
    assert "vol_ratio_5" in ids
    assert "zoo_alpha006" in ids
    assert "zoo_alpha101" in ids
    assert "roe" in ids and "np" in ids and "revenue" in ids
    assert "turnover_rate" not in ids
    groups = {f["group"] for f in data["factors"]}
    assert "动量" in groups and "WorldQuant" in groups and "财务PIT" in groups
    assert data["limits"]["factor_max_codes"] == 600


def test_rsi_high_on_uptrend():
    import numpy as np

    panel, _ = _panel(4, 40)
    fac = factor_matrix(panel, "rsi_14")
    tail = fac[20:]
    assert np.isfinite(tail).any()
    assert float(np.nanmin(tail)) > 70


def test_zoo101_uses_intraday_range():
    import numpy as np

    days = _weekdays(8)
    bars = {
        "sh600000": [
            {"datetime": d, "open": 10.0, "high": 12.0, "low": 9.0, "close": 11.0, "adj_close": 11.0, "volume": 100}
            for d in days
        ],
        "sh600001": [
            {"datetime": d, "open": 10.0, "high": 10.5, "low": 9.5, "close": 9.6, "adj_close": 9.6, "volume": 100}
            for d in days
        ],
    }
    panel = build_panel(bars)
    fac = factor_matrix(panel, "zoo_alpha101")
    # (11-10)/(12-9+0.001) > 0; (9.6-10)/(10.5-9.5+0.001) < 0
    assert fac[0, 0] > 0
    assert fac[0, 1] < 0
    assert np.isfinite(fac).all()


def test_factor_run_persists(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    panel, days = _panel(16, 70)
    bars = {}
    for sym in panel.symbols:
        j = panel.symbols.index(sym)
        bars[sym] = [
            {
                "datetime": panel.dates[i],
                "open": float(panel.close[i, j]),
                "high": float(panel.close[i, j]),
                "low": float(panel.close[i, j]),
                "close": float(panel.close[i, j]),
                "adj_close": float(panel.adj_close[i, j]),
                "volume": 1,
            }
            for i in range(panel.T)
        ]
    out = run_factor(
        {
            "codes": [s[-6:] for s in panel.symbols],
            "start": days[0],
            "end": days[-1],
            "factor": "momentum_10",
            "rebalance": "weekly",
            "persist": True,
        },
        bars_by_symbol=bars,
    )
    assert out["run_id"]
    from backtest.archive import list_runs, read_run, result_from_run

    rows = list_runs(kind="factor")
    assert rows[0]["id"] == out["run_id"]
    assert rows[0]["kind"] == "factor"
    assert rows[0]["factor"] == "momentum_10"
    assert list_runs(kind="account") == []
    got = result_from_run(read_run(out["run_id"]))
    assert got["run_id"] == out["run_id"]
    assert got["ic_series"]
    assert got["factor"]["id"] == "momentum_10"
    assert got["data_hash_match"] is None


def test_factor_open_does_not_rescan_store(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    from backtest.archive import result_from_run, write_factor_run

    def boom(*_a, **_k):
        raise AssertionError("panel_hash should not run when opening a factor run")

    monkeypatch.setattr("backtest.store.panel_hash", boom)
    write_factor_run(
        "f-wide",
        config={"factor": "momentum_20", "codes": [f"sh{600000 + i}" for i in range(80)]},
        result={"factor": {"id": "momentum_20", "label": "20日动量"}, "ic_series": [], "warnings": []},
        meta={
            "id": "f-wide",
            "kind": "factor",
            "data_hash": "abc",
            "symbols": [f"sh{600000 + i}" for i in range(80)],
            "start": "2024-01-02",
            "end": "2024-12-31",
        },
    )
    from backtest.archive import read_run

    got = result_from_run(read_run("f-wide"))
    assert got["factor"]["id"] == "momentum_20"
    assert got["data_hash_match"] is None


def test_direction_low_flips_momentum_ic():
    panel, days = _panel(20, 90)
    high = evaluate(panel, "momentum_20", rebalance="monthly", n_groups=5, start=days[25], direction="high")
    low = evaluate(panel, "momentum_20", rebalance="monthly", n_groups=5, start=days[25], direction="low")
    assert high["ic_mean"] is not None and low["ic_mean"] is not None
    assert high["ic_mean"] > 0
    assert low["ic_mean"] < 0
    assert high["direction"] == "high"
    assert low["direction"] == "low"


def test_factor_compare_two(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    from backtest.factor import run_factor_compare

    panel, days = _panel(16, 70)
    bars = {}
    for sym in panel.symbols:
        j = panel.symbols.index(sym)
        bars[sym] = [
            {
                "datetime": panel.dates[i],
                "open": float(panel.close[i, j]),
                "high": float(panel.close[i, j]),
                "low": float(panel.close[i, j]),
                "close": float(panel.close[i, j]),
                "adj_close": float(panel.adj_close[i, j]),
                "volume": 1,
            }
            for i in range(panel.T)
        ]
    out = run_factor_compare(
        {
            "codes": [s[-6:] for s in panel.symbols],
            "start": days[0],
            "end": days[-1],
            "factors": ["momentum_10", "change_1"],
            "rebalance": "weekly",
            "persist": False,
        },
        bars_by_symbol=bars,
    )
    assert len(out["rows"]) == 2
    assert out["ic_corr"][0][0] == 1.0
    assert "run_id" not in out


def test_store_pool_empty_errors(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    try:
        run_factor({"pool": "store", "lookback": "1y"})
    except Exception as exc:
        assert "库存" in str(exc)
    else:
        raise AssertionError("expected empty store error")


def test_roe_pit_uses_announce_date(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    from backtest.factor import evaluate
    from backtest.market import write_fundamentals

    panel, days = _panel(20, 50)
    for j, sym in enumerate(panel.symbols):
        write_fundamentals(sym, [{
            "field": "roe",
            "start": "2023-01-01",
            "end": "2023-12-31",
            "announce_date": days[8],
            "value": 5 + j,
        }])
    out = evaluate(panel, "roe", rebalance="monthly", n_groups=5, start=days[12])
    assert out["factor"]["id"] == "roe"
    assert out["n_periods"] >= 1
    assert out["ic_mean"] is not None
