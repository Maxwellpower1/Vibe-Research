"""Parquet store, PIT members/financials, immutable runs. No .db."""

from __future__ import annotations

import pytest

from backtest.archive import RunLocked, list_runs, read_run, result_from_run, write_run
from backtest.market import (
    drop_open_bars,
    fundamental_asof,
    inventory,
    members_covers,
    members_on,
    members_union,
    peek_bars,
    query_adj,
    query_bars,
    write_adj,
    write_bars,
    write_fundamentals,
    write_members,
)
from backtest.panel import build_panel
from backtest.signals import signal_ma_cross
from backtest.store import panel_hash


def test_drop_open_bars():
    rows = [
        {"datetime": "2024-01-02", "close": 10},
        {"datetime": "2024-01-10", "close": 11},
    ]
    kept = drop_open_bars(rows, closed_end="2024-01-05")
    assert [r["date"] for r in kept] == ["2024-01-02"]


def test_raw_and_adj_are_separate(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    write_bars("sh600000", [
        {"datetime": "2024-01-02", "open": 10, "high": 10, "low": 10, "close": 10, "volume": 1},
        {"datetime": "2024-01-03", "open": 5, "high": 5, "low": 5, "close": 5, "volume": 1},
    ], closed_end="2024-12-31")
    write_adj("sh600000", [
        {"datetime": "2024-01-02", "factor": 1.0},
        {"datetime": "2024-01-03", "factor": 2.0},
    ], closed_end="2024-12-31")
    bars = query_bars(["sh600000"], "2024-01-02", "2024-01-03")
    closes = {r["date"]: r["close"] for r in bars}
    assert closes["2024-01-03"] == 5
    fac = query_adj("sh600000", "2024-01-02", "2024-01-03")
    assert fac["2024-01-03"] == 2.0


def test_inventory_and_peek_are_local_only(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    write_bars("sh600000", [
        {"datetime": "2024-01-02", "open": 10, "high": 10, "low": 10, "close": 10, "volume": 1},
        {"datetime": "2024-01-03", "open": 11, "high": 11, "low": 11, "close": 11, "volume": 1},
    ], closed_end="2024-12-31")
    write_adj("sh600000", [
        {"datetime": "2024-01-02", "factor": 1.0},
        {"datetime": "2024-01-03", "factor": 1.1},
    ], closed_end="2024-12-31")
    write_run(
        "inv1",
        config={"codes": ["sh600000"]},
        trades=[],
        equity={"equity_curve": []},
        meta={"id": "inv1", "created": "2024-01-01", "symbols": ["sh600000"]},
    )
    port = inventory()
    assert port["root"] == str(tmp_path)
    assert port["bars"]["count"] == 1
    row = port["bars"]["symbols"][0]
    assert row["symbol"] == "sh600000"
    assert row["bars"] == 2
    assert row["from"] == "2024-01-02"
    assert row["to"] == "2024-01-03"
    assert row["adj"] == 2
    assert port["runs"]["count"] == 1
    assert port["members"] == []
    assert port["fundamentals"] == []
    peek = peek_bars("sh600000", 1)
    assert peek["count"] == 2
    assert peek["bars"][-1]["close"] == 11
    assert peek["bars"][-1]["factor"] == 1.1


def test_members_asof_latest_snapshot(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    write_members("sh000300", "2024-01-02", ["sh600000", "sh600519"])
    write_members("sh000300", "2024-06-01", ["sh600519", "sz000858"])
    assert members_on("sh000300", "2024-03-01") == ["sh600000", "sh600519"]
    assert members_on("sh000300", "2024-06-01") == ["sh600519", "sz000858"]
    assert members_on("sh000300", "2023-12-31") == []
    from backtest.market import members_asof
    day, syms = members_asof("sh000300", "2024-03-01")
    assert day == "2024-01-02"
    assert syms == ["sh600000", "sh600519"]
    assert members_covers("sh000300", "2024-03-01")
    assert not members_covers("sh000300", "2023-12-31")
    assert members_union("sh000300", "2024-03-01", "2024-06-01") == [
        "sh600000", "sh600519", "sz000858",
    ]
    write_members("sh000300", "2024-06-01", ["sz000858"])
    assert members_on("sh000300", "2024-06-01") == ["sz000858"]


def test_fundamental_needs_announce_date(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    write_fundamentals("sh600519", [{
        "field": "np",
        "start": "2024-01-01",
        "end": "2024-03-31",
        "announce_date": "2024-04-20",
        "value": 100,
    }])
    assert fundamental_asof("sh600519", "np", "2024-04-19") is None
    assert fundamental_asof("sh600519", "np", "2024-04-20") == 100
    assert fundamental_asof("sh600519", "np", "2024-02-01") is None


def test_run_write_once(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    write_run("r1", config={"a": 1}, trades=[], equity={"equity_curve": []}, meta={"id": "r1", "created": "2024-01-01"})
    with pytest.raises(RunLocked):
        write_run("r1", config={"a": 2}, trades=[], equity={}, meta={"id": "r1"})
    pack = read_run("r1")
    assert pack["config"]["a"] == 1
    assert list_runs()[0]["id"] == "r1"


def test_read_run_checks_data_hash(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    rows = [
        {"datetime": "2024-01-02", "open": 10, "high": 10, "low": 10, "close": 10, "volume": 1},
        {"datetime": "2024-01-03", "open": 11, "high": 11, "low": 11, "close": 11, "volume": 1},
    ]
    write_bars("sh600000", rows, closed_end="2024-12-31")
    write_adj("sh600000", [
        {"datetime": "2024-01-02", "factor": 1.0},
        {"datetime": "2024-01-03", "factor": 1.0},
    ], closed_end="2024-12-31")
    digest = panel_hash(["sh600000"], "2024-01-02", "2024-01-03")
    assert digest
    write_run(
        "h1",
        config={"codes": ["sh600000"], "start": "2024-01-02", "end": "2024-01-03"},
        trades=[],
        equity={"equity_curve": []},
        meta={
            "id": "h1",
            "created": "2024-01-01",
            "data_hash": digest,
            "symbols": ["sh600000"],
            "start": "2024-01-02",
            "end": "2024-01-03",
        },
    )
    got = result_from_run(read_run("h1"))
    assert got["data_hash_match"] is True
    write_bars("sh600000", [
        {"datetime": "2024-01-02", "open": 10, "high": 10, "low": 10, "close": 10, "volume": 1},
        {"datetime": "2024-01-03", "open": 12, "high": 12, "low": 12, "close": 12, "volume": 1},
    ], closed_end="2024-12-31")
    got2 = result_from_run(read_run("h1"))
    assert got2["data_hash_match"] is False
    assert any("行情已变" in w for w in got2["warnings"])


def test_wide_account_run_skips_hash(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))

    def boom(*_a, **_k):
        raise AssertionError("panel_hash should not run for wide account runs")

    monkeypatch.setattr("backtest.store.panel_hash", boom)
    write_run(
        "wide",
        config={"codes": [f"sh{600000 + i}" for i in range(50)]},
        trades=[],
        equity={"equity_curve": []},
        meta={
            "id": "wide",
            "kind": "account",
            "data_hash": "abc",
            "symbols": [f"sh{600000 + i}" for i in range(50)],
            "start": "2024-01-02",
            "end": "2024-12-31",
        },
    )
    got = result_from_run(read_run("wide"))
    assert got["data_hash_match"] is None
    assert any("未重算" in w for w in got["warnings"])


def test_ma_uses_adj_close_not_raw_split():
    # Raw halves on a split; adj stays flat -> no death cross.
    rows = []
    for i, d in enumerate(["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05",
                           "2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11"]):
        raw = 20.0 if i < 4 else 10.0
        rows.append({
            "datetime": d, "open": raw, "high": raw, "low": raw, "close": raw,
            "adj_close": 20.0, "volume": 1,
        })
    panel = build_panel({"sh600000": rows})
    entries, exits = signal_ma_cross(panel, 2, 3)
    assert not exits.any()
