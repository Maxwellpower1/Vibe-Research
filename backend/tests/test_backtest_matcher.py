"""Daily matcher contracts: T+1, lots, stamp tax, limit band, no fake Sharpe."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from backtest.matcher import compute_stats, rollup_trades, run_match
from backtest.panel import build_panel
from backtest.rules import MatcherConfig, limit_pct
from backtest.signals import build_signals, rolling_mean, signal_ma_cross, signal_rank_mom
from backtest.service import BacktestError, run_backtest


def _weekdays(n: int, start: str = "2024-01-02") -> list[str]:
    out: list[str] = []
    d = date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _rows(closes: list[float], opens: list[float] | None = None, start: str = "2024-01-02") -> list[dict]:
    days = _weekdays(len(closes), start)
    opens = opens if opens is not None else closes
    out = []
    for d, o, c in zip(days, opens, closes):
        hi = max(o, c)
        lo = min(o, c)
        out.append({"datetime": d, "open": o, "high": hi, "low": lo, "close": c, "volume": 1000})
    return out


def _panel(closes, opens=None, symbol="sh600000"):
    return build_panel({symbol: _rows(closes, opens)})


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


def test_limit_pct_by_board():
    assert limit_pct("600000") == 0.10
    assert limit_pct("sh600519") == 0.10
    assert limit_pct("300001") == 0.20
    assert limit_pct("688001") == 0.20
    assert limit_pct("830001") == 0.30


def test_stop_loss_sells_after_t1():
    panel = _panel([10, 10, 9.1, 9.1, 9.1, 9.1, 9.1])
    entries = np.zeros((panel.T, 1), dtype=bool)
    exits = np.zeros((panel.T, 1), dtype=bool)
    entries[0, 0] = True
    out = run_match(panel, entries, exits, _cfg(stop_loss_pct=0.08))
    sells = [t for t in out["trades"] if t["side"] == "sell" and t["reason"] == "stop"]
    assert sells
    assert sells[0]["date"] == panel.dates[2]


def test_max_hold_sells():
    panel = _panel([10] * 8)
    entries = np.zeros((panel.T, 1), dtype=bool)
    exits = np.zeros((panel.T, 1), dtype=bool)
    entries[0, 0] = True
    out = run_match(panel, entries, exits, _cfg(max_hold_days=2))
    sells = [t for t in out["trades"] if t["side"] == "sell" and t["reason"] == "max_hold"]
    assert sells
    assert sells[0]["hold_days"] >= 2


def test_tearsheet_monthly_and_drawdown():
    from backtest.matcher import tearsheet

    curve = [
        {"date": "2024-01-02", "equity": 100},
        {"date": "2024-01-31", "equity": 110},
        {"date": "2024-02-01", "equity": 110},
        {"date": "2024-02-28", "equity": 99},
        {"date": "2024-03-01", "equity": 99},
        {"date": "2024-03-29", "equity": 120},
    ]
    sheet = tearsheet(curve)
    months = {r["month"]: r["return"] for r in sheet["monthly"]}
    assert months["2024-01"] > 0
    assert months["2024-02"] < 0
    assert sheet["drawdowns"]
    assert sheet["drawdowns"][0]["depth"] < 0


def test_t1_blocks_same_day_sell():
    panel = _panel([10] * 8)
    entries = np.zeros((panel.T, 1), dtype=bool)
    exits = np.zeros((panel.T, 1), dtype=bool)
    entries[0, 0] = True
    exits[0, 0] = True
    out = run_match(panel, entries, exits, _cfg())
    buys = [t for t in out["trades"] if t["side"] == "buy"]
    assert len(buys) == 1
    assert buys[0]["date"] == panel.dates[1]
    assert not any(t["date"] == panel.dates[1] and t["side"] == "sell" for t in out["trades"])
    assert out["execution"]["rejects"]["t1"] >= 1
    later = [t for t in out["trades"] if t["side"] == "sell" and t["reason"] == "signal"]
    assert later and later[0]["date"] == panel.dates[2]


def test_t1_allows_next_session_sell():
    panel = _panel([10] * 8)
    entries = np.zeros((panel.T, 1), dtype=bool)
    exits = np.zeros((panel.T, 1), dtype=bool)
    entries[0, 0] = True
    exits[1, 0] = True
    out = run_match(panel, entries, exits, _cfg())
    sells = [t for t in out["trades"] if t["side"] == "sell" and t["reason"] == "signal"]
    assert len(sells) == 1
    assert sells[0]["date"] == panel.dates[2]
    assert sells[0]["hold_days"] == 1


def test_lot_size_100():
    # 168 * 100 = 16800, capital 20000 -> one lot; 10000 cannot buy
    panel = _panel([168] * 6)
    entries = np.zeros((panel.T, 1), dtype=bool)
    exits = np.zeros((panel.T, 1), dtype=bool)
    entries[0, 0] = True
    poor = run_match(panel, entries, exits, _cfg(initial_capital=10_000))
    assert not [t for t in poor["trades"] if t["side"] == "buy"]
    assert poor["execution"]["rejects"]["no_lot"] + poor["execution"]["rejects"]["no_cash"] >= 1
    rich = run_match(panel, entries, exits, _cfg(initial_capital=20_000))
    buys = [t for t in rich["trades"] if t["side"] == "buy"]
    assert buys[0]["shares"] == 100


def test_stamp_tax_sell_only():
    panel = _panel([10] * 8)
    entries = np.zeros((panel.T, 1), dtype=bool)
    exits = np.zeros((panel.T, 1), dtype=bool)
    entries[0, 0] = True
    exits[2, 0] = True
    out = run_match(panel, entries, exits, _cfg(stamp_tax_pct=0.0005, max_positions=1))
    buy = next(t for t in out["trades"] if t["side"] == "buy")
    sell = next(t for t in out["trades"] if t["side"] == "sell" and t["reason"] == "signal")
    assert buy["stamp_tax"] == 0
    assert sell["stamp_tax"] > 0
    assert abs(sell["stamp_tax"] - sell["notional"] * 0.0005) < 1e-6


def test_limit_up_blocks_buy_on_fill_vs_preclose():
    # day0 close 10; day1 open at +10% -> reject. Not a one-word board (high != low).
    closes = [10, 10.5, 10.5, 10.5, 10.5, 10.5]
    opens = [10, 11.0, 10.5, 10.5, 10.5, 10.5]
    panel = _panel(closes, opens)
    entries = np.zeros((panel.T, 1), dtype=bool)
    exits = np.zeros((panel.T, 1), dtype=bool)
    entries[0, 0] = True
    out = run_match(panel, entries, exits, _cfg())
    assert not [t for t in out["trades"] if t["side"] == "buy"]
    assert out["execution"]["rejects"]["limit_up"] >= 1


def test_limit_up_allows_open_inside_band():
    closes = [10, 10.5, 10.5, 10.5, 10.5, 10.5]
    opens = [10, 10.8, 10.5, 10.5, 10.5, 10.5]
    panel = _panel(closes, opens)
    entries = np.zeros((panel.T, 1), dtype=bool)
    exits = np.zeros((panel.T, 1), dtype=bool)
    entries[0, 0] = True
    out = run_match(panel, entries, exits, _cfg())
    assert [t for t in out["trades"] if t["side"] == "buy"]


def test_last_bar_signal_has_no_next_open():
    panel = _panel([10] * 6)
    entries = np.zeros((panel.T, 1), dtype=bool)
    exits = np.zeros((panel.T, 1), dtype=bool)
    entries[-1, 0] = True
    out = run_match(panel, entries, exits, _cfg())
    assert not [t for t in out["trades"] if t["side"] == "buy"]
    assert out["execution"]["rejects"]["no_next_bar"] >= 1


def test_overlap_signals_one_position():
    panel = _panel([10] * 10)
    entries = np.zeros((panel.T, 1), dtype=bool)
    exits = np.zeros((panel.T, 1), dtype=bool)
    entries[0, 0] = True
    entries[1, 0] = True
    entries[2, 0] = True
    out = run_match(panel, entries, exits, _cfg())
    buys = [t for t in out["trades"] if t["side"] == "buy"]
    assert len(buys) == 1
    assert out["execution"]["rejects"]["already_held"] >= 1


def test_hold_not_twenty_overlapping_lots():
    panel = _panel([10] * 25)
    entries, exits, _ = build_signals(panel, "hold")
    out = run_match(panel, entries, exits, _cfg())
    buys = [t for t in out["trades"] if t["side"] == "buy"]
    assert len(buys) == 1


def test_sharpe_from_daily_equity_not_horizon():
    # Steady climb. Fortune-style 252/20 on a 20-day hold would explode; ours stays modest.
    closes = [10 + i * 0.05 for i in range(40)]
    panel = _panel(closes)
    entries, exits, _ = build_signals(panel, "hold")
    out = run_match(panel, entries, exits, _cfg(initial_capital=1_000_000, max_positions=1))
    sharpe = out["stats"]["sharpe"]
    assert sharpe > 0
    eq = np.asarray([p["equity"] for p in out["equity_curve"]], dtype=float)
    redo = compute_stats(eq.tolist(), out["trades"], 1_000_000)
    assert abs(redo["sharpe"] - sharpe) < 1e-9
    rets = np.diff(eq) / eq[:-1]
    daily = float(np.mean(rets) / np.std(rets, ddof=1) * np.sqrt(252.0))
    assert abs(sharpe - daily) < 1e-9
    # Fortune-style total * 252/horizon is a return, not a Sharpe; keep them distinct.
    fake = out["stats"]["total_return"] * (252.0 / 20.0)
    assert abs(sharpe - fake) > 1.0


def test_buy_has_no_stamp_even_with_commission():
    panel = _panel([10] * 8)
    entries = np.zeros((panel.T, 1), dtype=bool)
    exits = np.zeros((panel.T, 1), dtype=bool)
    entries[0, 0] = True
    out = run_match(
        panel,
        entries,
        exits,
        _cfg(commission_pct=0.00025, commission_min=5, stamp_tax_pct=0.0005),
    )
    buy = next(t for t in out["trades"] if t["side"] == "buy")
    assert buy["commission"] >= 5
    assert buy["stamp_tax"] == 0


def test_ma_cross_golden_then_death():
    # Long window 5: stay 10, jump to 20, then fall to 8.
    closes = [10] * 8 + [20] * 8 + [8] * 8
    panel = _panel(closes)
    entries, exits = signal_ma_cross(panel, 3, 5)
    assert entries.any()
    assert exits.any()
    first_buy = int(np.argmax(entries[:, 0]))
    first_sell = int(np.argmax(exits[:, 0]))
    assert first_sell > first_buy


def test_rolling_mean_needs_full_window():
    x = np.array([1.0, 2.0, 3.0, 4.0])
    ma = rolling_mean(x, 3)
    assert np.isnan(ma[1])
    assert abs(ma[2] - 2.0) < 1e-9


def test_run_backtest_injected_panel_no_network():
    rows = _rows([10 + i * 0.2 for i in range(8)])
    out = run_backtest(
        {
            "codes": ["600000"],
            "start": rows[0]["datetime"],
            "end": rows[-1]["datetime"],
            "strategy": "hold",
            "commission_pct": 0,
            "commission_min": 0,
            "stamp_tax_pct": 0,
            "slippage_bps": 0,
            "initial_capital": 100000,
            "max_positions": 1,
        },
        bars_by_symbol={"sh600000": rows},
    )
    assert out["stats"]["total_return"] > 0
    assert out["universe"]["bars"] == 8
    assert "不荐股" in out["disclaimer"]
    assert out["run_id"]
    assert out["data_hash"]
    assert out["by_symbol"]
    assert out["config"]["strategy"] == "hold"


def test_run_backtest_bad_code():
    try:
        run_backtest({"codes": ["not-a-code"], "strategy": "hold"})
    except BacktestError as e:
        assert "无法解析" in str(e)
    else:
        raise AssertionError("expected BacktestError")


def test_rollup_trades_sorts_by_pnl():
    rows = rollup_trades([
        {"symbol": "sh600000", "name": "浦发", "side": "buy"},
        {"symbol": "sh600000", "name": "浦发", "side": "sell", "pnl": 80, "hold_days": 4},
        {"symbol": "sz000001", "side": "buy"},
        {"symbol": "sz000001", "side": "sell", "pnl": -20, "hold_days": 2},
        {"symbol": "sz000001", "side": "sell", "pnl": 10, "hold_days": 2},
    ])
    assert [r["symbol"] for r in rows] == ["sh600000", "sz000001"]
    assert rows[0]["pnl"] == 80
    assert rows[0]["trips"] == 1
    assert rows[1]["pnl"] == -10
    assert rows[1]["wins"] == 1
    assert rows[1]["trips"] == 2
    assert abs(rows[1]["win_rate"] - 0.5) < 1e-9


def test_rank_mom_picks_winner():
    days = _weekdays(12)
    def pack(closes: list[float]) -> list[dict]:
        return [
            {"datetime": d, "open": c, "high": c, "low": c, "close": c, "adj_close": c, "volume": 1}
            for d, c in zip(days, closes)
        ]
    panel = build_panel({
        "sh600000": pack([10 + i for i in range(12)]),
        "sz000001": pack([20 - i for i in range(12)]),
    })
    entries, exits = signal_rank_mom(panel, lookback=3, rebalance=3, top_k=1)
    assert entries[3, 0] and not entries[3, 1]
    assert exits[3, 1] and not exits[3, 0]
    assert entries[6, 0] and exits[6, 1]
    assert not entries[4].any()


def test_rank_mom_rotates_when_leader_flips():
    days = _weekdays(10)
    def pack(closes: list[float]) -> list[dict]:
        return [
            {"datetime": d, "open": c, "high": c, "low": c, "close": c, "adj_close": c, "volume": 1}
            for d, c in zip(days, closes)
        ]
    panel = build_panel({
        "sh600000": pack([10, 11, 12, 13, 10, 9, 8, 7, 6, 5]),
        "sz000001": pack([10, 9, 8, 7, 10, 12, 14, 16, 18, 20]),
    })
    entries, exits = signal_rank_mom(panel, lookback=3, rebalance=3, top_k=1)
    assert entries[3, 0] and exits[3, 1]
    assert entries[6, 1] and exits[6, 0]


def test_run_backtest_rank_mom_injected():
    days = _weekdays(16)
    def pack(closes: list[float]) -> list[dict]:
        return [
            {"datetime": d, "open": c, "high": c, "low": c, "close": c, "volume": 1000}
            for d, c in zip(days, closes)
        ]
    out = run_backtest(
        {
            "codes": ["600000", "000001"],
            "start": days[0],
            "end": days[-1],
            "strategy": "rank_mom",
            "mom_win": 3,
            "rebalance": 4,
            "commission_pct": 0,
            "commission_min": 0,
            "stamp_tax_pct": 0,
            "slippage_bps": 0,
            "initial_capital": 100000,
            "max_positions": 1,
        },
        bars_by_symbol={
            "sh600000": pack([10 + i * 0.4 for i in range(16)]),
            "sz000001": pack([20 - i * 0.3 for i in range(16)]),
        },
    )
    buys = [t for t in out["trades"] if t["side"] == "buy"]
    assert buys
    assert all(t["symbol"] == "sh600000" for t in buys)
    assert out["strategy"]["name"] == "rank_mom"
    assert any("静态池" in w for w in out["warnings"])


def test_dates_strategy_exact_match():
    rows = _rows([10] * 10)
    out = run_backtest(
        {
            "codes": ["600000"],
            "start": rows[0]["datetime"],
            "end": rows[-1]["datetime"],
            "strategy": "dates",
            "events": [
                {"code": "600000", "side": "buy", "date": rows[1]["datetime"]},
                {"code": "600000", "side": "sell", "date": rows[4]["datetime"]},
            ],
            "commission_pct": 0,
            "commission_min": 0,
            "stamp_tax_pct": 0,
            "slippage_bps": 0,
            "initial_capital": 100000,
            "max_positions": 1,
        },
        bars_by_symbol={"sh600000": rows},
    )
    buys = [t for t in out["trades"] if t["side"] == "buy"]
    sells = [t for t in out["trades"] if t["side"] == "sell" and t["reason"] == "signal"]
    assert buys[0]["date"] == rows[2]["datetime"]
    assert sells[0]["date"] == rows[5]["datetime"]
