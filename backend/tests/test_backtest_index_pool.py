"""Index pool import: cache today's snapshot, fetch is injectable."""

from datetime import date

from fastapi.testclient import TestClient

import app as app_module
from backtest.index_pool import load_index_pool
from backtest.market import members_on, write_members
from backtest.service import BacktestError

client = TestClient(app_module.app)


def test_cache_hit_skips_fetch(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr("backtest.index_pool.last_closed_iso", lambda: "2024-12-31")
    write_members("sh000300", "2024-12-31", ["sh600519", "sz000858"])

    def boom(_index: str):
        raise AssertionError("should not fetch")

    out = load_index_pool("sh000300", fetch_fn=boom)
    assert out["source"] == "cache"
    assert out["codes"] == ["600519", "000858"]
    assert out["n"] == 2
    assert "幸存者" in out["note"]


def test_fetch_writes_members(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr("backtest.index_pool.last_closed_iso", lambda: "2024-12-31")
    out = load_index_pool("sh000300", fetch_fn=lambda _i: ["600519", "000858", "300750"])
    assert out["source"] == "live"
    assert out["asof"] == "2024-12-31"
    assert out["codes"] == ["600519", "000858", "300750"]
    assert members_on("sh000300", "2024-12-31") == ["sh600519", "sz000858", "sz300750"]


def test_stale_cache_used_when_fetch_empty(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr("backtest.index_pool.last_closed_iso", lambda: "2024-12-31")
    write_members("sh000300", "2024-06-01", ["sh600519"])
    out = load_index_pool("sh000300", fetch_fn=lambda _i: [])
    assert out["source"] == "cache"
    assert out["codes"] == ["600519"]
    assert "已存快照" in out["note"]


def test_fetch_members_falls_back_to_sina(monkeypatch):
    from backtest.index_pool import fetch_members

    monkeypatch.setattr("backtest.index_pool.fetch_eastmoney", lambda _i: [])
    monkeypatch.setattr("backtest.index_pool.fetch_sina", lambda _i: ["600519", "000858"])
    assert fetch_members("sh000300") == ["600519", "000858"]


def test_codes_from_sina_rows():
    from backtest.index_pool import _codes_from_maps

    assert _codes_from_maps(
        [{"code": "600519"}, {"code": "858"}, {"name": "skip"}],
        "code",
    ) == ["600519", "000858"]


def test_unknown_index():
    try:
        load_index_pool("sh000852", fetch_fn=lambda _i: ["600519"])
        raise AssertionError("should reject")
    except BacktestError as exc:
        assert "不支持" in str(exc)


def test_api_index_pool(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr("trading_calendar.last_closed_session", lambda: date(2024, 12, 31))
    monkeypatch.setattr(
        "backtest.index_pool.fetch_members",
        lambda _i: ["600519", "000858"],
    )
    r = client.get("/api/backtest/index-pool?index=sh000300")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["label"] == "沪深300"
    assert data["codes"] == ["600519", "000858"]

    bad = client.get("/api/backtest/index-pool?index=nope")
    assert bad.status_code == 400
