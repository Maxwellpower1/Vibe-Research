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
    assert "不拉上游" in data["note"]


def test_meta_ok():
    r = client.get("/api/backtest/meta")
    assert r.status_code == 200
    data = r.json()["data"]
    assert "hold" in {s["id"] for s in data["strategies"]}
    assert "不荐股" in data["disclaimer"]


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
