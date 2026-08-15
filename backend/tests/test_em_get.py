"""em_get: no launch gap; concurrent HTTP may overlap (same as marketingdashboard)."""
from __future__ import annotations

import threading
import time

import astock


def test_em_get_no_launch_gap(monkeypatch):
    old_mode = astock._em_mode[0]
    astock._em_mode[0] = "direct"

    started: list[float] = []
    finished: list[float] = []
    gate = threading.Lock()

    class _Resp:
        status_code = 200

    def fake_get(*_a, **_k):
        t0 = time.monotonic()
        with gate:
            started.append(t0)
        time.sleep(0.35)
        with gate:
            finished.append(time.monotonic())
        return _Resp()

    sess = type("S", (), {"get": staticmethod(fake_get)})()
    monkeypatch.setattr(astock, "_em_session", lambda _direct: sess)

    def call() -> None:
        astock.em_get("http://example.test/em")

    try:
        t0 = time.monotonic()
        threads = [threading.Thread(target=call) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        elapsed = time.monotonic() - t0
    finally:
        astock._em_mode[0] = old_mode

    assert len(started) == 2
    first, second = sorted(started)
    assert second - first < 0.15
    assert second < min(finished)
    assert elapsed < 0.7
    assert not hasattr(astock, "_em_reserve_slot")
    assert not hasattr(astock, "_EM_MIN_INTERVAL")


def test_em_get_fflow_and_clist_start_together(monkeypatch):
    old_mode = astock._em_mode[0]
    astock._em_mode[0] = "direct"

    started: list[tuple[float, str]] = []
    gate = threading.Lock()

    class _Resp:
        status_code = 200

    def fake_get(url, *_a, **_k):
        t0 = time.monotonic()
        with gate:
            started.append((t0, url))
        time.sleep(0.3)
        return _Resp()

    sess = type("S", (), {"get": staticmethod(fake_get)})()
    monkeypatch.setattr(astock, "_em_session", lambda _direct: sess)

    def call_slow() -> None:
        astock.em_get("https://push2.eastmoney.com/api/qt/clist/get")

    def call_fast() -> None:
        astock.em_get("https://push2.eastmoney.com/api/qt/stock/fflow/kline/get")

    try:
        t0 = time.monotonic()
        threads = [threading.Thread(target=call_slow), threading.Thread(target=call_fast)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        elapsed = time.monotonic() - t0
    finally:
        astock._em_mode[0] = old_mode

    assert len(started) == 2
    gap = abs(started[0][0] - started[1][0])
    assert gap < 0.15
    assert elapsed < 0.6
    assert any("fflow/kline" in u for _, u in started)
