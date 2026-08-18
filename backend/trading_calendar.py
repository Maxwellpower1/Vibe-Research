"""A-share trading calendar for 复盘邮件 and warmup.

is_cn_trading_day() never hits the network. refresh() loads dates
(Eastmoney 000001 daily bars) and may persist them under VR_DATA_DIR.
If the calendar is missing or the day is outside its range, fall back
to weekend-only so a fetch failure cannot skip a real trading day.
"""
from __future__ import annotations

import bisect
import json
import logging
import os
import sys
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

BEIJING = timezone(timedelta(hours=8))
log = logging.getLogger("trading_calendar")

_DATES: frozenset[date] | None = None
_SORTED: list[date] | None = None
_RANGE: tuple[date, date] | None = None
_LOADED_ON: date | None = None
_SOURCE = ""
_ALLOW_DISK = True
_LOCK = threading.Lock()

# Same Eastmoney kline path; push2his is often reset, push2delay is the sibling host.
_EM_HOSTS = ("push2his.eastmoney.com", "push2delay.eastmoney.com")
_KLINE_PATH = "/api/qt/stock/kline/get"
_KLINE_PARAMS = {
    "secid": "1.000001",
    "klt": "101",
    "fqt": "0",
    "beg": "20150101",
    "end": "20991231",
    "fields1": "f1,f2,f3",
    "fields2": "f51",
}
_MIN_DATES = 200


def reset() -> None:
    """Clear memory (tests). Do not resurrect from disk until start_background/refresh."""
    global _DATES, _SORTED, _RANGE, _LOADED_ON, _SOURCE, _ALLOW_DISK
    _DATES = None
    _SORTED = None
    _RANGE = None
    _LOADED_ON = None
    _SOURCE = ""
    _ALLOW_DISK = False


def _as_beijing_date(d: date | datetime | None) -> date:
    if d is None:
        return datetime.now(BEIJING).date()
    if isinstance(d, datetime):
        if d.tzinfo is None:
            d = d.replace(tzinfo=BEIJING)
        else:
            d = d.astimezone(BEIJING)
        return d.date()
    return d


def _set(dates: frozenset[date], source: str) -> None:
    global _DATES, _SORTED, _RANGE, _LOADED_ON, _SOURCE
    if not dates:
        return
    _DATES = dates
    _SORTED = sorted(dates)
    _RANGE = (_SORTED[0], _SORTED[-1])
    _LOADED_ON = datetime.now(BEIJING).date()
    _SOURCE = source


def load_dates(dates: Iterable[date], source: str = "test") -> None:
    """Inject a date set (tests)."""
    packed = frozenset(dates)
    if not packed:
        reset()
        return
    _set(packed, source)


def parse_kline_dates(payload: object) -> frozenset[date]:
    """Eastmoney kline JSON -> trading dates. No network."""
    if not isinstance(payload, dict):
        return frozenset()
    data = payload.get("data")
    rows = (data or {}).get("klines") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return frozenset()
    out: set[date] = set()
    for row in rows:
        day = str(row).split(",")[0][:10]
        if len(day) == 10 and day[4] == "-" and day[7] == "-":
            try:
                out.add(date.fromisoformat(day))
            except ValueError:
                continue
    return frozenset(out)


def parse_bar_dates(payload: object) -> frozenset[date]:
    """daily_bars payload -> trading dates. No network."""
    if not isinstance(payload, dict):
        return frozenset()
    rows = payload.get("bars")
    if not isinstance(rows, list):
        return frozenset()
    out: set[date] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = str(row.get("datetime") or row.get("date") or "")[:10]
        if len(day) == 10 and day[4] == "-" and day[7] == "-":
            try:
                out.add(date.fromisoformat(day))
            except ValueError:
                continue
    return frozenset(out)


def _data_dir() -> Path:
    root = Path(os.environ.get("VR_DATA_DIR") or (Path.home() / ".vibe-research"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def _disk_path() -> Path:
    return _data_dir() / "cn-trading-days.json"


def _save_disk(dates: frozenset[date]) -> None:
    payload = {
        "dates": [d.isoformat() for d in sorted(dates)],
        "saved": datetime.now(BEIJING).isoformat(timespec="seconds"),
    }
    p = _disk_path()
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


def _load_disk() -> frozenset[date] | None:
    p = _disk_path()
    if not p.is_file():
        return None
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    rows = raw.get("dates") if isinstance(raw, dict) else None
    if not isinstance(rows, list):
        return None
    out: set[date] = set()
    for item in rows:
        try:
            out.add(date.fromisoformat(str(item)[:10]))
        except ValueError:
            continue
    return frozenset(out) if len(out) >= _MIN_DATES else None


def _ensure_memory() -> None:
    """Disk only. Never network."""
    if _DATES is not None or not _ALLOW_DISK:
        return
    disk = _load_disk()
    if disk:
        _set(disk, "disk")


def is_cn_trading_day(d: date | datetime | None = None) -> bool:
    """True if A-shares are open that Beijing calendar day."""
    _ensure_memory()
    target = _as_beijing_date(d)
    if target.weekday() >= 5:
        return False
    if _DATES and _RANGE and _RANGE[0] <= target <= _RANGE[1]:
        return target in _DATES
    return True


def _covered(d: date) -> bool:
    return bool(_SORTED and _RANGE and _RANGE[0] <= d <= _RANGE[1])


def _shift_fallback(start: date, offset: int) -> date:
    """Walk is_cn_trading_day. Same weekend/holiday rule as the boolean check."""
    if offset == 0:
        cur = start
        for _ in range(21):
            if is_cn_trading_day(cur):
                return cur
            cur -= timedelta(days=1)
        return start
    step = 1 if offset > 0 else -1
    left = abs(offset)
    cur = start
    guard = 0
    while left and guard < 4000:
        cur += timedelta(days=step)
        guard += 1
        if is_cn_trading_day(cur):
            left -= 1
    return cur


def day_shift(start: date | datetime, offset: int) -> date:
    """Move `offset` A-share sessions. 0 = last session on or before start.

    Positive skips to later sessions (Friday + 1 = next Monday).
    Uses the loaded calendar inside its range; otherwise the same
    weekend fallback as is_cn_trading_day. Clamps at calendar ends.
    """
    start = _as_beijing_date(start)
    _ensure_memory()
    days = _SORTED
    if days and _covered(start):
        if offset == 0:
            i = bisect.bisect_right(days, start) - 1
            return days[i] if i >= 0 else days[0]
        if offset > 0:
            i = bisect.bisect_right(days, start) + offset - 1
            if i >= len(days):
                return days[-1]
            return days[max(i, 0)]
        i = bisect.bisect_left(days, start) + offset
        if i < 0:
            return days[0]
        return days[min(i, len(days) - 1)]
    return _shift_fallback(start, offset)


def floor_day(d: date | datetime | None = None) -> date:
    """Last trading day on or before d."""
    return day_shift(_as_beijing_date(d), 0)


def ceiling_day(d: date | datetime | None = None) -> date:
    """First trading day on or after d."""
    target = _as_beijing_date(d)
    if is_cn_trading_day(target):
        return target
    return day_shift(target, 1)


def count_day_frames(start: date | datetime, end: date | datetime) -> int:
    """Inclusive trading-day count. 0 if start > end."""
    a = _as_beijing_date(start)
    b = _as_beijing_date(end)
    if a > b:
        return 0
    _ensure_memory()
    if _SORTED and _RANGE and _RANGE[0] <= a and b <= _RANGE[1]:
        return bisect.bisect_right(_SORTED, b) - bisect.bisect_left(_SORTED, a)
    n = 0
    cur = a
    while cur <= b:
        if is_cn_trading_day(cur):
            n += 1
        cur += timedelta(days=1)
    return n


# Regular session close. Do not persist today's bar before this.
_A_SHARE_CLOSE = (15, 0)


def last_closed_session(now: date | datetime | None = None) -> date:
    """Last A-share session that has already closed (15:00 Beijing).

    Uses is_cn_trading_day / day_shift. No second weekday list.
    """
    if isinstance(now, date) and not isinstance(now, datetime):
        current = datetime(now.year, now.month, now.day, 23, 59, tzinfo=BEIJING)
    elif now is None:
        current = datetime.now(BEIJING)
    else:
        current = now
        if current.tzinfo is None:
            current = current.replace(tzinfo=BEIJING)
        else:
            current = current.astimezone(BEIJING)
    day = current.date()
    if is_cn_trading_day(day) and (current.hour, current.minute) >= _A_SHARE_CLOSE:
        return day
    return day_shift(day, -1)


def status() -> dict[str, Any]:
    _ensure_memory()
    today = is_cn_trading_day()
    return {
        "loaded": _DATES is not None,
        "count": len(_DATES) if _DATES else 0,
        "from": _RANGE[0].isoformat() if _RANGE else None,
        "to": _RANGE[1].isoformat() if _RANGE else None,
        "source": _SOURCE or None,
        "trading_day": today,
        "fallback": _DATES is None or (
            _RANGE is not None and not (_RANGE[0] <= datetime.now(BEIJING).date() <= _RANGE[1])
        ),
    }


def _fetch_eastmoney() -> frozenset[date]:
    import astock

    last: Exception | None = None
    headers = {
        "User-Agent": astock.UA,
        "Referer": "https://quote.eastmoney.com/",
    }
    for host in _EM_HOSTS:
        try:
            r = astock.em_get(
                f"https://{host}{_KLINE_PATH}",
                params=_KLINE_PARAMS,
                headers=headers,
                timeout=8,
            )
            dates = parse_kline_dates(r.json())
            if len(dates) >= _MIN_DATES:
                return dates
            last = RuntimeError(f"{host} calendar too short: {len(dates)}")
        except Exception as e:
            last = e
            log.info("A-share calendar %s failed, try next: %s", host, e)
    raise last or RuntimeError("eastmoney calendar empty")


def _fetch_tencent() -> frozenset[date]:
    import astock

    payload = astock.daily_bars("sh000001", 1000, "none") or {}
    dates = parse_bar_dates(payload)
    if len(dates) < _MIN_DATES:
        raise RuntimeError(f"tencent calendar too short: {len(dates)}")
    return dates


def _merge_disk(live: frozenset[date]) -> tuple[frozenset[date], bool]:
    disk = _load_disk()
    if not disk:
        return live, False
    return disk | live, True


def _fetch() -> tuple[frozenset[date], str]:
    """Live dates for the one A-share calendar. Eastmoney first, Tencent daily_bars next."""
    errors: list[str] = []
    try:
        return _fetch_eastmoney(), "eastmoney"
    except Exception as e:
        errors.append(f"eastmoney: {e}")
    try:
        live = _fetch_tencent()
        merged, used_disk = _merge_disk(live)
        return merged, "tencent+disk" if used_disk else "tencent"
    except Exception as e:
        errors.append(f"tencent: {e}")
    raise RuntimeError("; ".join(errors))


def refresh() -> bool:
    """Fetch calendar. Fail-soft. Returns whether the live fetch succeeded."""
    global _ALLOW_DISK
    with _LOCK:
        _ALLOW_DISK = True
        try:
            dates, source = _fetch()
        except Exception as e:
            log.warning("A-share calendar fetch failed, keep fallback: %s", e)
            _ensure_memory()
            return False
        _set(dates, source)
        try:
            _save_disk(dates)
        except OSError as e:
            log.warning("A-share calendar disk save failed: %s", e)
        log.info(
            "A-share calendar loaded from %s: %s days (%s .. %s)",
            source,
            len(dates),
            _RANGE[0] if _RANGE else "",
            _RANGE[1] if _RANGE else "",
        )
        return True


def refresh_if_stale() -> None:
    today = datetime.now(BEIJING).date()
    if _LOADED_ON == today and _DATES:
        return
    refresh()


def start_background() -> None:
    """Load disk immediately, then refresh in a daemon (once a day)."""
    global _ALLOW_DISK
    _ALLOW_DISK = True
    _ensure_memory()
    if "pytest" in sys.modules:
        return

    def loop() -> None:
        refresh()
        while True:
            time.sleep(3600)
            try:
                refresh_if_stale()
            except Exception:
                log.exception("calendar refresh tick failed")

    threading.Thread(target=loop, name="trading-calendar", daemon=True).start()
