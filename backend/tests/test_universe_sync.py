"""Universe store-window bar fill. No live Tencent."""
from __future__ import annotations

from datetime import date, timedelta

import universe
from backtest import universe_sync as us
from backtest.market import inventory, write_bars


def test_read_codes_keeps_stale(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    codes = [f"{i:06d}" for i in range(2000)]
    universe.save(codes)
    raw = (tmp_path / "a-share-codes.json").read_text(encoding="utf-8")
    import json
    payload = json.loads(raw)
    payload["ts"] = 1
    (tmp_path / "a-share-codes.json").write_text(json.dumps(payload), encoding="utf-8")
    assert universe.load() == []
    assert universe.read_codes(fresh_only=False) == codes


def test_window_matches_store_lookback(monkeypatch):
    monkeypatch.setattr(us, "last_closed_iso", lambda: "2026-08-14")
    start, end = us.window("2026-08-14")
    assert end == "2026-08-14"
    assert us.STORE_LOOKBACK == "3y"
    assert start == (date(2026, 8, 14) - timedelta(days=us.LOOKBACKS["3y"])).isoformat()
    assert us.LOOKBACKS["3y"] == 1095


def test_sync_writes_and_skips(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(us, "last_closed_iso", lambda: "2026-08-14")
    monkeypatch.setattr("backtest.store.last_closed_iso", lambda: "2026-08-14")
    monkeypatch.setattr("backtest.market.last_closed_iso", lambda: "2026-08-14")

    start, end = us.window("2026-08-14")

    def fake_fetch(symbol, num=1000):
        return {
            "symbol": symbol,
            "name": "x",
            "bars": [
                {"datetime": start, "open": 10, "high": 10, "low": 10, "close": 10, "volume": 1},
                {"datetime": end, "open": 11, "high": 11, "low": 11, "close": 11, "volume": 1},
            ],
        }

    first = us.run_sync(fetch_fn=fake_fetch, codes=["600000", "000001"], workers=1)
    assert first["state"] == "done"
    assert first["ok"] == 2
    assert first["skip"] == 0
    second = us.run_sync(fetch_fn=lambda *a, **k: (_ for _ in ()).throw(AssertionError("fetch")),
                         codes=["600000", "000001"], workers=1)
    assert second["skip"] == 2
    assert second["ok"] == 0


def test_portrait_counts_on_disk(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(us, "last_closed_iso", lambda: "2026-08-14")
    codes = ["600000"] + [f"{i:06d}" for i in range(1999)]
    universe.save(codes)
    write_bars("sh600000", [
        {"datetime": "2024-08-15", "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1},
    ], closed_end="2026-08-14")
    port = us.portrait()
    assert port["codes"] == 2000
    assert port["on_disk"] == 1
    assert port["lookback"] == "3y"


def test_inventory_note_and_universe(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    data = inventory()
    assert "补齐" in data["note"]
    assert "不清库" in data["note"]
    assert data["universe"]["lookback"] == "3y"
    assert data["bars"]["preview"] == 0


def test_empty_universe_errors(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    out = us.run_sync(codes=[], workers=1)
    assert out["state"] == "error"
    assert "标的池" in out["error"]


def test_on_tick_sees_each_symbol(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(us, "last_closed_iso", lambda: "2026-08-14")
    monkeypatch.setattr("backtest.store.last_closed_iso", lambda: "2026-08-14")
    monkeypatch.setattr("backtest.market.last_closed_iso", lambda: "2026-08-14")
    start, end = us.window("2026-08-14")
    seen: list[str] = []

    def fake_fetch(symbol, num=1000):
        return {
            "symbol": symbol,
            "name": "x",
            "bars": [
                {"datetime": start, "open": 10, "high": 10, "low": 10, "close": 10, "volume": 1},
                {"datetime": end, "open": 11, "high": 11, "low": 11, "close": 11, "volume": 1},
            ],
        }

    us.run_sync(codes=["600519"], workers=1, fetch_fn=fake_fetch, on_tick=lambda st: seen.append(st["current"]))
    assert seen == ["sh600519"]


def test_not_on_review_jobs():
    import pathlib
    import review_jobs

    src = pathlib.Path(review_jobs.__file__).read_text(encoding="utf-8")
    assert "universe_sync" not in src
    warm = pathlib.Path(__file__).resolve().parents[1] / "review_warmup.py"
    assert "universe_sync" not in warm.read_text(encoding="utf-8")
