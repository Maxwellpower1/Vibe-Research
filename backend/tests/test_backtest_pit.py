"""PIT members, financial announce_date, tradable CSI 300 bench. No live CSI/F10."""

from __future__ import annotations

from backtest.fundamentals import rows_from_f10
from backtest.market import (
    members_covers,
    members_on,
    membership_mask,
    write_bars,
    write_fundamentals,
    write_members,
)
from backtest.members_hist import parse_adjust_pdf, persist_member_history, rebuild_snapshots
from backtest.panel import build_panel
from backtest.rules import MatcherConfig
from backtest.service import _attach_benchmark, run_backtest
from backtest.signals import signal_members


def test_rebuild_snapshots_walks_backward():
    snaps = rebuild_snapshots(
        ["sh600000", "sh600519"],
        "2024-12-31",
        [
            {"date": "2024-06-17", "added": ["sh600519"], "removed": ["sz000858"]},
        ],
        since="2024-01-02",
    )
    assert snaps["2024-12-31"] == ["sh600000", "sh600519"]
    assert snaps["2024-06-17"] == ["sh600000", "sh600519"]
    assert snaps["2024-01-02"] == ["sh600000", "sz000858"]


def test_parse_adjust_pdf_pairs():
    text = """
沪深 300 指数样本调整名单：
调出名单 调入名单
证券代码 证券名称 证券代码 证券名称
000661 长春高新 000657 中钨高新
000786 北新建材 000988 华工科技
中证 500 指数样本调整名单：
000426 兴业银锡 000661 长春高新
"""
    added, removed = parse_adjust_pdf(text, "000300")
    assert removed == ["000661", "000786"]
    assert added == ["000657", "000988"]
    a500, r500 = parse_adjust_pdf(text, "000905")
    assert r500 == ["000426"]
    assert a500 == ["000661"]


def test_f10_needs_notice_date():
    rows = rows_from_f10([
        {
            "REPORT_DATE": "2024-03-31",
            "NOTICE_DATE": "2024-04-20",
            "PARENTNETPROFIT": 100,
            "TOTALOPERATEREVE": 200,
            "ROEJQ": 12.5,
        },
        {
            "REPORT_DATE": "2023-12-31",
            "PARENTNETPROFIT": 80,
            "TOTALOPERATEREVE": 160,
            "ROEJQ": 10,
        },
    ])
    fields = {(r["field"], r["announce_date"], r["value"]) for r in rows}
    assert ("np", "2024-04-20", 100.0) in fields
    assert ("revenue", "2024-04-20", 200.0) in fields
    assert ("roe", "2024-04-20", 12.5) in fields
    assert all(r["announce_date"] == "2024-04-20" for r in rows)


def test_persist_and_mask(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    persist_member_history(
        "sh000300",
        ["sh600000", "sh600519"],
        "2024-12-31",
        [{"date": "2024-06-17", "added": ["sh600519"], "removed": ["sz000858"]}],
        since="2024-01-02",
    )
    assert members_on("sh000300", "2024-03-01") == ["sh600000", "sz000858"]
    assert members_on("sh000300", "2024-06-17") == ["sh600000", "sh600519"]
    assert members_covers("sh000300", "2024-01-02")
    dates = ["2024-03-01", "2024-06-17"]
    symbols = ["sh600000", "sh600519", "sz000858"]
    mask = membership_mask("sh000300", dates, symbols)
    assert list(mask[0]) == [True, False, True]
    assert list(mask[1]) == [True, True, False]


def test_signal_members_enter_exit():
    dates = ["2024-01-02", "2024-01-03", "2024-01-04"]
    bars = {
        "sh600000": [
            {"datetime": d, "open": 10, "high": 10, "low": 10, "close": 10, "adj_close": 10, "volume": 1}
            for d in dates
        ],
        "sz000858": [
            {"datetime": d, "open": 10, "high": 10, "low": 10, "close": 10, "adj_close": 10, "volume": 1}
            for d in dates
        ],
    }
    panel = build_panel(bars)
    import numpy as np
    mask = np.array([
        [True, False],
        [True, True],
        [False, True],
    ])
    entries, exits = signal_members(panel, mask)
    assert entries[0, 0] and not entries[0, 1]
    assert entries[1, 1] and not entries[1, 0]
    assert exits[2, 0] and not exits[2, 1]


def test_tradable_benchmark_not_price_ratio(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    days = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]
    write_members("sh000300", "2024-01-02", ["sh600000", "sz000858"])
    for sym, px0 in (("sh600000", 10.0), ("sz000858", 20.0)):
        write_bars(sym, [
            {"datetime": d, "open": px0, "high": px0, "low": px0, "close": px0 + i, "volume": 1000}
            for i, d in enumerate(days)
        ], closed_end="2024-12-31")
    rows = [
        {"datetime": d, "open": 10 + i, "high": 10 + i, "low": 10 + i, "close": 10 + i, "adj_close": 10 + i, "volume": 1}
        for i, d in enumerate(days)
    ]
    out = run_backtest(
        {
            "codes": ["600000"],
            "start": days[0],
            "end": days[-1],
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
    assert out.get("benchmark") is None
    fake = {
        "equity_curve": [{"date": d, "equity": 100000} for d in days],
        "stats": {"total_return": 0.0},
        "warnings": [],
    }
    _attach_benchmark(fake, days[0], days[-1], MatcherConfig(initial_capital=100000, max_positions=2), None, True)
    assert fake["benchmark"]["kind"] == "tradable_equal"
    assert fake["benchmark"]["name"] == "沪深300等权可交易"
    assert fake["benchmark"]["total_return"] is not None


def test_price_benchmark_when_no_pit(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    days = ["2024-01-02", "2024-01-03"]
    write_bars("sh000300", [
        {"datetime": "2024-01-02", "open": 100, "high": 100, "low": 100, "close": 100, "volume": 1},
        {"datetime": "2024-01-03", "open": 110, "high": 110, "low": 110, "close": 110, "volume": 1},
    ], closed_end="2024-12-31")
    fake = {
        "equity_curve": [{"date": d, "equity": 100000} for d in days],
        "stats": {"total_return": 0.1},
        "warnings": [],
    }
    _attach_benchmark(fake, days[0], days[-1], MatcherConfig(initial_capital=100000), None, True)
    assert fake["benchmark"]["kind"] == "index_price"
    assert abs(fake["benchmark"]["total_return"] - 0.1) < 1e-9
    assert any("价格比" in w for w in fake["warnings"])


def test_pit_account_uses_union(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    days = ["2024-01-02", "2024-01-03", "2024-01-04"]
    write_members("sh000300", "2024-01-02", ["sh600000"])
    write_members("sh000300", "2024-01-03", ["sh600000", "sz000858"])
    bars = {}
    for sym in ("sh600000", "sz000858"):
        bars[sym] = [
            {"datetime": d, "open": 10, "high": 10, "low": 10, "close": 10, "adj_close": 10, "volume": 1000}
            for d in days
        ]
        write_bars(sym, bars[sym], closed_end="2024-12-31")
    out = run_backtest(
        {
            "codes": ["600000"],
            "index": "sh000300",
            "pit_members": True,
            "start": days[0],
            "end": days[-1],
            "strategy": "hold",
            "commission_pct": 0,
            "commission_min": 0,
            "stamp_tax_pct": 0,
            "slippage_bps": 0,
            "initial_capital": 200000,
            "max_positions": 2,
        },
        bars_by_symbol=bars,
    )
    assert set(out["universe"]["symbols"]) == {"sh600000", "sz000858"}
    assert any("按日成分" in w for w in out["warnings"])
    assert not any("幸存者" in w for w in out["warnings"])
