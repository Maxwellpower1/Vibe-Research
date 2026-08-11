"""Process-local TTL cache: maxsize LRU, optional negative TTL, single-flight.

Used by app / market / ovlab / fino / gstock to share one concurrency-safe pattern:
- hit within TTL -> return cached value (including cached None / empty negatives)
- miss -> only one thread fetches; others wait (single-flight)
- invalid / empty (valid() is false) -> not stored, or stored briefly when negative_ttl > 0
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Hashable, TypeVar

T = TypeVar("T")

_MISS = object()


def is_nonempty(value: Any) -> bool:
    """True for non-None values that are not empty containers / empty strings."""
    if value is None:
        return False
    if isinstance(value, (list, dict, tuple, set, str, bytes)):
        return len(value) > 0
    return True


class TTLCache:
    """Thread-safe TTL + LRU cache with single-flight fetch."""

    def __init__(
        self,
        *,
        maxsize: int = 512,
        default_ttl: float = 300.0,
        negative_ttl: float = 0.0,
        name: str = "cache",
    ) -> None:
        if maxsize < 1:
            raise ValueError("maxsize must be >= 1")
        self.maxsize = int(maxsize)
        self.default_ttl = float(default_ttl)
        self.negative_ttl = float(negative_ttl)
        self.name = name
        self._data: OrderedDict[Hashable, tuple[float, Any]] = OrderedDict()
        self._lock = threading.RLock()
        self._inflight: dict[Hashable, threading.Event] = {}
        self._inflight_errors: dict[Hashable, BaseException] = {}

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def pop(self, key: Hashable, default: Any = None) -> Any:
        """Remove key; return cached value or default (dict-compatible for tests)."""
        with self._lock:
            item = self._data.pop(key, None)
            if item is None:
                return default
            return item[1]

    def __contains__(self, key: object) -> bool:
        with self._lock:
            return self._get_unlocked(key) is not _MISS  # type: ignore[arg-type]

    def __len__(self) -> int:
        with self._lock:
            self._purge_expired_unlocked()
            return len(self._data)

    def get(self, key: Hashable, default: Any = None) -> Any:
        with self._lock:
            hit = self._get_unlocked(key)
            return default if hit is _MISS else hit

    def set(self, key: Hashable, value: Any, ttl: float | None = None) -> None:
        with self._lock:
            self._set_unlocked(key, value, self.default_ttl if ttl is None else float(ttl))

    def get_or_set(
        self,
        key: Hashable,
        fetch: Callable[[], T],
        *,
        ttl: float | None = None,
        valid: Callable[[Any], bool] = is_nonempty,
        negative_ttl: float | None = None,
        wait_timeout: float = 180.0,
    ) -> T:
        """Return cached value or fetch once under single-flight."""
        eff_ttl = self.default_ttl if ttl is None else float(ttl)
        neg_ttl = self.negative_ttl if negative_ttl is None else float(negative_ttl)

        while True:
            with self._lock:
                hit = self._get_unlocked(key)
                if hit is not _MISS:
                    return hit  # type: ignore[return-value]
                if key in self._inflight:
                    ev = self._inflight[key]
                    leader = False
                else:
                    ev = threading.Event()
                    self._inflight[key] = ev
                    leader = True

            if not leader:
                ev.wait(timeout=wait_timeout)
                with self._lock:
                    hit = self._get_unlocked(key)
                    if hit is not _MISS:
                        return hit  # type: ignore[return-value]
                    err = self._inflight_errors.pop(key, None)
                if err is not None:
                    raise err
                # Leader finished without caching (invalid + neg_ttl=0): retry as leader.
                continue

            try:
                val = fetch()
            except BaseException as e:
                with self._lock:
                    self._inflight_errors[key] = e
                    self._inflight.pop(key, None)
                    ev.set()
                raise

            with self._lock:
                if valid(val):
                    self._set_unlocked(key, val, eff_ttl)
                elif neg_ttl > 0:
                    self._set_unlocked(key, val, neg_ttl)
                self._inflight.pop(key, None)
                self._inflight_errors.pop(key, None)
                ev.set()
            return val

    def _get_unlocked(self, key: Hashable) -> Any:
        item = self._data.get(key)
        if item is None:
            return _MISS
        expire_at, value = item
        if time.monotonic() >= expire_at:
            del self._data[key]
            return _MISS
        self._data.move_to_end(key)
        return value

    def _set_unlocked(self, key: Hashable, value: Any, ttl: float) -> None:
        expire_at = time.monotonic() + max(0.0, ttl)
        if key in self._data:
            self._data.move_to_end(key)
        self._data[key] = (expire_at, value)
        while len(self._data) > self.maxsize:
            self._data.popitem(last=False)

    def _purge_expired_unlocked(self) -> None:
        now = time.monotonic()
        dead = [k for k, (exp, _) in self._data.items() if now >= exp]
        for k in dead:
            del self._data[k]
