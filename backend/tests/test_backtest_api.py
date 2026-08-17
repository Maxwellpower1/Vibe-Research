"""Backtest HTTP: validation and injected bars, no live fetch."""

from fastapi.testclient import TestClient

import app as app_module
client = TestClient(app_module.app)


def test_store_inventory_ok(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    r = client.get("/api/backtest/store")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["root"] == str(tmp_path)
    assert data["bars"]["count"] == 0
    assert "补齐" in data["note"]
    assert data["universe"]["lookback"] == "2y"


def test_store_sync_empty_universe(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    r = client.post("/api/backtest/store/sync")
    assert r.status_code == 200
    assert r.json()["data"]["state"] == "error"
    assert "标的池" in r.json()["data"]["error"]


def test_progress_idle():
    r = client.get("/api/backtest/progress")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["state"] in ("idle", "done", "running")
    assert "step" in data
    assert "done" in data


def test_progress_tracks_load(tmp_path, monkeypatch):
    from backtest.progress import begin, bump, finish, snapshot

    begin(kind="account", step="load", total=2, note="2 只")
    bump(current="sh600519")
    row = snapshot()
    assert row["state"] == "running"
    assert row["label"] == "读日 K"
    assert row["done"] == 1
    assert row["current"] == "600519"
    finish()
    assert snapshot()["state"] == "done"


def test_meta_ok():
    r = client.get("/api/backtest/meta")
    assert r.status_code == 200
    data = r.json()["data"]
    assert "hold" in {s["id"] for s in data["strategies"]}
    assert "rank_mom" in {s["id"] for s in data["strategies"]}
    assert "不荐股" in data["disclaimer"]
    assert data["limits"]["max_codes"] == 600
    assert "库存" in data["disclaimer"]
    assert {p["id"] for p in data["index_pools"]} == {
        "sh000300", "sh000905", "sh000688", "sz399006",
    }


def test_resolve_codes_limit():
    from backtest.service import MAX_CODES, BacktestError, resolve_codes

    assert MAX_CODES == 600
    codes = [f"{600000 + i:06d}" for i in range(600)]
    assert len(resolve_codes(codes)) == 600
    try:
        resolve_codes([f"{600000 + i:06d}" for i in range(601)])
        raise AssertionError("should reject 601")
    except BacktestError as exc:
        assert "600" in str(exc)


def test_store_probe_codes(monkeypatch, tmp_path):
    from datetime import date

    from backtest.market import write_bars

    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr("trading_calendar.last_closed_session", lambda: date(2024, 12, 31))
    monkeypatch.setattr("backtest.store.last_closed_iso", lambda: "2024-12-31")
    monkeypatch.setattr("backtest.market.last_closed_iso", lambda: "2024-12-31")
    write_bars("sh600000", [
        {"datetime": "2024-01-02", "open": 10, "high": 10, "low": 10, "close": 10, "volume": 1},
        {"datetime": "2024-12-31", "open": 11, "high": 11, "low": 11, "close": 11, "volume": 1},
    ], closed_end="2024-12-31")
    r = client.get("/api/backtest/store?codes=600000,000001&start=2024-01-02&end=2024-12-31")
    assert r.status_code == 200
    probe = r.json()["data"]["probe"]
    assert probe["asked"] == 2
    assert probe["covered"] == 1
    assert "sz000001" in probe["missing"]


def test_load_panel_reads_store_without_fetch(monkeypatch, tmp_path):
    from backtest.market import write_bars
    from backtest.service import load_panel

    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr("backtest.store.last_closed_iso", lambda: "2024-01-20")
    monkeypatch.setattr("backtest.market.last_closed_iso", lambda: "2024-01-20")
    write_bars("sh600000", [
        {"datetime": "2024-01-02", "open": 10, "high": 10, "low": 10, "close": 10, "volume": 1},
        {"datetime": "2024-01-20", "open": 11, "high": 11, "low": 11, "close": 11, "volume": 1},
    ], closed_end="2024-01-20")

    def boom(*_a, **_k):
        raise AssertionError("should not fetch")

    panel, warnings, _names, src = load_panel(
        ["sh600000"],
        "2024-01-02",
        "2024-01-20",
        fetch_fn=boom,
        use_cache=True,
    )
    assert panel.T >= 2
    assert src["from_store"] == 1
    assert src["fetched"] == 0
    assert any("全部读库存" in w for w in warnings)


def test_run_bad_code_400():
    r = client.post("/api/backtest/run", json={"codes": ["xxxxxx"], "strategy": "hold"})
    assert r.status_code == 400


def test_run_empty_400():
    r = client.post("/api/backtest/run", json={"codes": [], "strategy": "hold"})
    assert r.status_code == 400


def test_run_injected_no_network(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    rows = [
        {"datetime": f"2024-02-{d:02d}", "open": 10 + d * 0.1, "high": 11, "low": 9, "close": 10 + d * 0.1, "volume": 1}
        for d in range(1, 16)
        if __import__("datetime").date(2024, 2, d).weekday() < 5
    ]

    def fake_fetch(symbol, num=1000):
        return {"symbol": "sh600000", "name": "浦发银行", "bars": rows, "adjust": "qfq", "source": "test"}

    monkeypatch.setattr("backtest.service.fetch_daily_bars", fake_fetch)
    r = client.post(
        "/api/backtest/run",
        json={
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
    )
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["stats"]["days"] >= 1
    assert data["equity_curve"]
    assert "sharpe" in data["stats"]
    assert data["run_id"]
    listed = client.get("/api/backtest/runs").json()["data"]
    assert any(r["id"] == data["run_id"] for r in listed)
    got = client.get(f"/api/backtest/runs/{data['run_id']}")
    assert got.status_code == 200
    assert got.json()["data"]["data_hash"] == data["data_hash"]
    assert got.json()["data"]["data_hash_match"] is True
    assert data["by_symbol"]
    assert got.json()["data"]["by_symbol"]
    assert data["config"]["codes"]
