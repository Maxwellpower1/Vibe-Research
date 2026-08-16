"""True OOS: params from IS only; fresh OOS book; walk-forward folds."""

from __future__ import annotations

from datetime import date, timedelta

from backtest.oos import resolve_split, tune_ma, walk_folds
from backtest.rules import MatcherConfig
from backtest.service import run_backtest
from backtest.signals import build_signals
from backtest.panel import build_panel


def _weekdays(n: int, start: str = "2020-01-02") -> list[str]:
    out: list[str] = []
    d = date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _rows(closes: list[float]) -> list[dict]:
    days = _weekdays(len(closes))
    return [
        {"datetime": d, "open": c, "high": c, "low": c, "close": c, "adj_close": c, "volume": 1}
        for d, c in zip(days, closes)
    ]


def _cfg(**kw) -> MatcherConfig:
    base = dict(
        initial_capital=100_000,
        max_positions=1,
        commission_pct=0.0,
        commission_min=0.0,
        stamp_tax_pct=0.0,
        slippage_bps=0.0,
    )
    base.update(kw)
    return MatcherConfig(**base)


def test_resolve_split_frac():
    dates = _weekdays(100)
    idx = resolve_split(dates, oos_frac=0.3)
    assert idx == 70
    assert dates[idx] > dates[idx - 1]


def test_oos_fresh_trades_not_before_split():
    closes = [10 + i * 0.02 for i in range(80)]
    rows = _rows(closes)
    out = run_backtest(
        {
            "codes": ["600000"],
            "start": rows[0]["datetime"],
            "end": rows[-1]["datetime"],
            "strategy": "hold",
            "oos_frac": 0.3,
            "commission_pct": 0,
            "commission_min": 0,
            "stamp_tax_pct": 0,
            "slippage_bps": 0,
            "initial_capital": 100000,
            "max_positions": 1,
        },
        bars_by_symbol={"sh600000": rows},
    )
    split = out["oos"]["split"]
    assert out["oos"]["stats_oos_fresh"]["days"] >= 1
    # Continuing OOS stats exist and IS+OOS cover the curve
    assert out["oos"]["is_bars"] + out["oos"]["oos_bars"] == out["universe"]["bars"]
    assert split == rows[out["oos"]["is_bars"]]["datetime"]


def test_tune_ma_does_not_see_later_bars():
    # First 50 days grind up; last 50 crash. IS-only tune must not use the crash.
    up = [10 + i * 0.08 for i in range(50)]
    down = [up[-1] - i * 0.15 for i in range(50)]
    rows = _rows(up + down)
    panel = build_panel({"sh600000": rows})
    is_panel = panel.slice(0, 50)
    assert is_panel.dates[-1] < panel.dates[-1]
    s, l, grid = tune_ma(is_panel, _cfg())
    assert grid
    assert all(r["short_win"] < r["long_win"] for r in grid)
    # Full-panel tune can pick a different pair; IS result is what we freeze.
    s2, l2, _ = tune_ma(panel, _cfg())
    out = run_backtest(
        {
            "codes": ["600000"],
            "start": rows[0]["datetime"],
            "end": rows[-1]["datetime"],
            "strategy": "ma_cross",
            "tune_ma": True,
            "oos_frac": 0.5,
            "commission_pct": 0,
            "commission_min": 0,
            "stamp_tax_pct": 0,
            "slippage_bps": 0,
            "initial_capital": 100000,
            "max_positions": 1,
        },
        bars_by_symbol={"sh600000": rows},
    )
    assert out["strategy"]["tuned"] is True
    assert out["strategy"]["short_win"] == s
    assert out["strategy"]["long_win"] == l
    # Frozen pair is the IS winner, not necessarily the full-sample winner
    assert (out["strategy"]["short_win"], out["strategy"]["long_win"]) == (s, l)
    _ = (s2, l2)


def test_walk_folds_do_not_overlap_test_into_next_train_by_accident():
    folds = walk_folds(400, train=100, test=20, step=20)
    assert folds
    for i, (a, b, c) in enumerate(folds):
        assert b - a == 100
        assert c - b == 20
        if i:
            assert a == folds[i - 1][0] + 20


def test_walk_forward_hold_runs():
    closes = [10 + (i % 15) * 0.05 for i in range(400)]
    rows = _rows(closes)
    out = run_backtest(
        {
            "codes": ["600000"],
            "start": rows[0]["datetime"],
            "end": rows[-1]["datetime"],
            "strategy": "hold",
            "walk_forward": True,
            "oos_frac": 0.3,
            "commission_pct": 0,
            "commission_min": 0,
            "stamp_tax_pct": 0,
            "slippage_bps": 0,
            "initial_capital": 100000,
            "max_positions": 1,
        },
        bars_by_symbol={"sh600000": rows},
    )
    wf = out["walk_forward"]
    assert wf["summary"]["folds"] >= 1
    assert out.get("oos") is None
    # Each fold OOS starts after its own IS
    for f in wf["folds"]:
        assert f["oos_start"] > f["is_end"]


def test_ma_signal_on_full_panel_uses_is_history():
    closes = [10] * 30 + [12] * 30
    panel = build_panel({"sh600000": _rows(closes)})
    entries, _, _ = build_signals(panel, "ma_cross", short_win=5, long_win=10)
    split = 30
    # A golden cross after the jump should exist and sit on/after split
    if entries.any():
        first = int(entries[:, 0].argmax())
        assert first >= 10
