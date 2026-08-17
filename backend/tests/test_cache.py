"""Unit tests for process-local TTLCache (no network)."""
from __future__ import annotations

import threading
import time

from cache import TTLCache, is_nonempty


def test_is_nonempty():
    assert is_nonempty({"a": 1})
    assert is_nonempty([1])
    assert not is_nonempty({})
    assert not is_nonempty([])
    assert not is_nonempty(None)
    assert not is_nonempty("")
    assert is_nonempty(0)
    assert is_nonempty(False)


def test_hit_avoids_refetch():
    c = TTLCache(maxsize=8, default_ttl=60, name="t")
    calls = []
    c.get_or_set("k", lambda: calls.append(1) or {"x": 1})
    c.get_or_set("k", lambda: calls.append(1) or {"x": 2})
    assert calls == [1]
    assert c.get("k") == {"x": 1}


def test_empty_not_cached_when_neg_ttl_zero():
    c = TTLCache(maxsize=8, default_ttl=60, negative_ttl=0, name="t")
    calls = []
    assert c.get_or_set("k", lambda: calls.append(1) or []) == []
    assert c.get_or_set("k", lambda: calls.append(1) or [{"ok": 1}]) == [{"ok": 1}]
    assert len(calls) == 2


def test_negative_ttl_caches_empty_briefly():
    c = TTLCache(maxsize=8, default_ttl=60, negative_ttl=0.3, name="t")
    calls = []
    assert c.get_or_set("k", lambda: calls.append(1) or []) == []
    assert c.get_or_set("k", lambda: calls.append(1) or [{"ok": 1}]) == []
    assert len(calls) == 1
    time.sleep(0.35)
    assert c.get_or_set("k", lambda: calls.append(1) or [{"ok": 1}]) == [{"ok": 1}]
    assert len(calls) == 2


def test_lru_eviction():
    c = TTLCache(maxsize=2, default_ttl=60, name="t")
    c.set("a", 1)
    c.set("b", 2)
    c.set("c", 3)
    assert "a" not in c
    assert c.get("b") == 2
    assert c.get("c") == 3


def test_ttl_expiry():
    c = TTLCache(maxsize=8, default_ttl=0.2, name="t")
    calls = []
    c.get_or_set("k", lambda: calls.append(1) or "v")
    time.sleep(0.25)
    c.get_or_set("k", lambda: calls.append(1) or "v2")
    assert len(calls) == 2
    assert c.get("k") == "v2"


def test_single_flight():
    c = TTLCache(maxsize=8, default_ttl=60, name="t")
    started = threading.Barrier(3)
    calls = []
    lock = threading.Lock()

    def fetch():
        with lock:
            calls.append(1)
        time.sleep(0.15)
        return {"ok": True}

    results = []

    def worker():
        started.wait()
        results.append(c.get_or_set("sf", fetch))

    threads = [threading.Thread(target=worker) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)
    assert len(calls) == 1
    assert results == [{"ok": True}, {"ok": True}, {"ok": True}]


def test_pop_and_clear():
    c = TTLCache(maxsize=8, default_ttl=60, name="t")
    c.set("k", 1)
    assert c.pop("k") == 1
    assert c.pop("k", None) is None
    c.set("a", 1)
    c.clear()
    assert len(c) == 0


def test_none_can_be_negative_cached():
    c = TTLCache(maxsize=8, default_ttl=3600, negative_ttl=60, name="resolve")
    calls = []
    assert c.get_or_set("X", lambda: calls.append(1) or None, valid=lambda v: v is not None) is None
    assert c.get_or_set("X", lambda: calls.append(1) or {"code": "X"}, valid=lambda v: v is not None) is None
    assert calls == [1]


def test_get_last_survives_ttl():
    c = TTLCache(maxsize=8, default_ttl=0.15, name="t")
    c.set("k", "v")
    time.sleep(0.2)
    assert c.get("k") is None
    assert c.get_last("k") == "v"


def test_expire_keeps_last():
    c = TTLCache(maxsize=8, default_ttl=60, name="t")
    c.set("k", "v")
    assert c.expire("k") is True
    assert c.get("k") is None
    assert c.get_last("k") == "v"
    assert c.expire("missing") is False


def test_serve_last_skips_fetch_after_expire():
    c = TTLCache(maxsize=8, default_ttl=60, name="t")
    calls: list[int] = []
    assert c.get_or_set("k", lambda: calls.append(1) or "v", serve_last=True) == "v"
    c.expire("k")
    assert c.get_or_set("k", lambda: calls.append(1) or "v2", serve_last=True) == "v"
    assert calls == [1]


def test_refetch_keeps_last_when_fetch_raises():
    c = TTLCache(maxsize=8, default_ttl=60, name="t")
    c.set("k", "v")
    c.expire("k")

    def boom():
        raise RuntimeError("up")

    try:
        c.get_or_set("k", boom)
    except RuntimeError as e:
        assert str(e) == "up"
    else:
        raise AssertionError("expected fetch error")
    assert c.get_last("k") == "v"


def test_negative_expire_does_not_become_last():
    c = TTLCache(maxsize=8, default_ttl=60, negative_ttl=0.15, name="t")
    calls: list[int] = []
    assert c.get_or_set("k", lambda: calls.append(1) or []) == []
    time.sleep(0.2)
    assert c.get_last("k") is None
    assert c.get_or_set("k", lambda: calls.append(1) or [{"ok": 1}]) == [{"ok": 1}]
    assert calls == [1, 1]
