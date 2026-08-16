"""Rate-limited GET helpers for SEC / Nasdaq / CBOE."""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None  # type: ignore[misc, assignment]

import requests

from gstock_deep.common import DataNotAvailable, _UA, _sec_contact

class _RateLimiter:
    def __init__(self, max_per_sec: float):
        self._interval = 1.0 / float(max_per_sec)
        self._last = 0.0
        self._lock = threading.Lock()

    def wait(self) -> None:
        with self._lock:
            gap = self._interval - (time.monotonic() - self._last)
            if gap > 0:
                time.sleep(gap)
            self._last = time.monotonic()


_LIMITS = {
    "sec.gov": _RateLimiter(8),
    "cboe.com": _RateLimiter(4),
    "nasdaq.com": _RateLimiter(2),
    "_default": _RateLimiter(5),
}


def _limiter_for(url: str) -> _RateLimiter:
    for host, lim in _LIMITS.items():
        if host != "_default" and host in url:
            return lim
    return _LIMITS["_default"]


def _is_object_missing(resp) -> bool:
    if resp.status_code == 404:
        return True
    if resp.status_code != 403:
        return False
    ctype = (resp.headers.get("Content-Type") or "").lower()
    head = (resp.text or "")[:500]
    return "xml" in ctype and "<Code>AccessDenied</Code>" in head


def _require_sec_contact() -> str:
    contact = _sec_contact()
    if not contact or "your-email@example.com" in contact:
        raise RuntimeError(
            "请设置环境变量 VR_SEC_CONTACT='Your Name you@example.com' "
            "(SEC 要求 User-Agent 声明真实联系方式)"
        )
    return contact


def official_get(url: str, params: dict | None = None, headers: dict | None = None,
                 timeout: int = 30, as_json: bool = False):
    if "sec.gov" in url:
        contact = _require_sec_contact()
        h = {"User-Agent": contact, "Accept-Encoding": "gzip, deflate"}
    else:
        h = {"User-Agent": _UA}
    h.update(headers or {})
    _limiter_for(url).wait()
    try:
        r = requests.get(url, params=params, headers=h, timeout=timeout)
        r.raise_for_status()
    except requests.HTTPError as e:
        resp = e.response
        code = resp.status_code
        low = (resp.text or "")[:4000].lower()
        if _is_object_missing(resp):
            raise DataNotAvailable(
                f"HTTP {code} {url[:80]} — resource missing"
            ) from e
        if code == 403 and "undeclared" in low:
            raise RuntimeError(
                f"SEC rejected User-Agent. VR_SEC_CONTACT={_sec_contact()!r}"
            ) from e
        raise RuntimeError(f"HTTP {code} {url[:80]}") from e
    except requests.RequestException as e:
        raise RuntimeError(f"request failed {url[:80]}: {e}") from e
    return r.json() if as_json else r.text


def _recent_weekdays(days_back: int = 7) -> list[str]:
    d, out = datetime.now(), []
    while len(out) < days_back:
        if d.weekday() < 5:
            out.append(d.strftime("%Y%m%d"))
        d -= timedelta(days=1)
    return out


_ET_TZ = ZoneInfo("America/New_York") if ZoneInfo is not None else None


def _et_today() -> str:
    """US/Eastern calendar date (YYYY-MM-DD). Shared by Nasdaq earnings + CBOE."""
    now = datetime.now(timezone.utc)
    if _ET_TZ is not None:
        return now.astimezone(_ET_TZ).strftime("%Y-%m-%d")
    y = now.year
    mar8 = datetime(y, 3, 8, tzinfo=timezone.utc)
    dst_start = (mar8 + timedelta(days=(6 - mar8.weekday()) % 7)).replace(hour=7)
    nov1 = datetime(y, 11, 1, tzinfo=timezone.utc)
    dst_end = (nov1 + timedelta(days=(6 - nov1.weekday()) % 7)).replace(hour=6)
    offset = 4 if dst_start <= now < dst_end else 5
    return (now - timedelta(hours=offset)).strftime("%Y-%m-%d")


_cik_cache: dict | None = None

