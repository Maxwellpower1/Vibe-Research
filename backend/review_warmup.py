"""Daily Review cache warmup — keep hot paths filled so the first UI paint is fast.

Design:
- Daemon thread, same style as portfolio.start_scheduler.
- Session-aware interval: denser in A-share continuous auction, sparse otherwise.
- Only warms shared market caches (no per-user watchlist / no stock-specific K lines).
- Disable with VR_REVIEW_WARMUP=0.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterator

BEIJING = timezone(timedelta(hours=8))
log = logging.getLogger("review_warmup")

# Snapshot / user fetches set this so a warmup pass does not start while the
# UI is already filling the same Eastmoney quota.
_user_fetches = 0
_user_lock = threading.Lock()


@contextmanager
def user_fetch() -> Iterator[None]:
    """Mark a user-facing review fetch so warmup can yield the Eastmoney lock."""
    global _user_fetches
    with _user_lock:
        _user_fetches += 1
    try:
        yield
    finally:
        with _user_lock:
            _user_fetches -= 1


def user_busy() -> bool:
    with _user_lock:
        return _user_fetches > 0

# last run snapshot for /api/market/review-warmup
_STATE: dict[str, Any] = {
    "enabled": False,
    "running": False,
    "last_started": None,
    "last_finished": None,
    "last_ok": 0,
    "last_fail": 0,
    "last_errors": [],
    "session": None,
    "next_interval_sec": None,
}


def _env_flag(name: str, default: bool = True) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw not in ("0", "false", "no", "off")


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(30, int(raw))
    except ValueError:
        return default


def session_kind(now: datetime | None = None) -> str:
    """Rough A-share session: open | lunch | closed (Beijing, weekdays only)."""
    now = now or datetime.now(BEIJING)
    if now.tzinfo is None:
        now = now.replace(tzinfo=BEIJING)
    else:
        now = now.astimezone(BEIJING)
    if now.weekday() >= 5:
        return "closed"
    hm = now.hour * 100 + now.minute
    # match frontend ashareSession: auction + continuous
    if 915 <= hm < 1130:
        return "open"
    if 1130 <= hm < 1300:
        return "lunch"
    if 1300 <= hm <= 1505:
        return "open"
    return "closed"


def interval_for_session(kind: str) -> int:
    if kind == "open":
        return _env_int("VR_REVIEW_WARMUP_OPEN_SEC", 90)
    if kind == "lunch":
        return _env_int("VR_REVIEW_WARMUP_LUNCH_SEC", 300)
    return _env_int("VR_REVIEW_WARMUP_CLOSED_SEC", 900)


def _run_step(name: str, fn: Callable[[], Any], errors: list[dict]) -> bool:
    try:
        fn()
        return True
    except Exception as e:
        errors.append({"name": name, "error": str(e)[:160]})
        log.warning("warmup step %s failed: %s", name, e)
        return False


def warm_market() -> tuple[int, int, list[dict]]:
    """Fill market.py TTL caches used by 复盘 top rows."""
    import market

    errors: list[dict] = []
    ok = 0
    steps = (
        ("overview", market.get_overview),
        ("emotion", market.get_short_term_emotion),
        ("turnover_top", market.get_turnover_top),
        ("global_indices", market.get_global_indices),
    )
    for name, fn in steps:
        if _run_step(name, fn, errors):
            ok += 1
    return ok, len(steps) - ok, errors


def warm_once(extra: Callable[[], tuple[int, int, list[dict]]] | None = None) -> dict:
    """One warmup pass. optional extra() warms app-level _DC_CACHE entries."""
    if user_busy():
        log.info("skip warmup pass: user review snapshot in flight")
        _STATE["skipped"] = True
        return dict(_STATE)

    _STATE["running"] = True
    _STATE.pop("skipped", None)
    _STATE["last_started"] = datetime.now(BEIJING).isoformat(timespec="seconds")
    kind = session_kind()
    _STATE["session"] = kind

    ok, fail, errors = warm_market()
    if extra is not None:
        try:
            e_ok, e_fail, e_err = extra()
            ok += e_ok
            fail += e_fail
            errors.extend(e_err)
        except Exception as e:
            fail += 1
            errors.append({"name": "extra", "error": str(e)[:160]})

    _STATE["last_ok"] = ok
    _STATE["last_fail"] = fail
    _STATE["last_errors"] = errors[-12:]
    _STATE["last_finished"] = datetime.now(BEIJING).isoformat(timespec="seconds")
    _STATE["next_interval_sec"] = interval_for_session(kind)
    _STATE["running"] = False
    return dict(_STATE)


def status() -> dict:
    return {
        **_STATE,
        "session_now": session_kind(),
        "open_sec": _env_int("VR_REVIEW_WARMUP_OPEN_SEC", 90),
        "lunch_sec": _env_int("VR_REVIEW_WARMUP_LUNCH_SEC", 300),
        "closed_sec": _env_int("VR_REVIEW_WARMUP_CLOSED_SEC", 900),
    }


def start_scheduler(
    extra: Callable[[], tuple[int, int, list[dict]]] | None = None,
    initial_delay: float = 3.0,
) -> None:
    """Start daemon warmup loop. No-op when VR_REVIEW_WARMUP=0."""
    if not _env_flag("VR_REVIEW_WARMUP", True):
        _STATE["enabled"] = False
        log.info("review warmup disabled (VR_REVIEW_WARMUP=0)")
        return

    _STATE["enabled"] = True

    def loop() -> None:
        time.sleep(max(0.5, initial_delay))
        while True:
            try:
                warm_once(extra=extra)
            except Exception:
                log.exception("review warmup pass crashed")
            if _STATE.get("skipped"):
                delay = 5
            else:
                delay = interval_for_session(session_kind())
            _STATE["next_interval_sec"] = delay
            time.sleep(delay)

    threading.Thread(target=loop, name="review-warmup", daemon=True).start()
    log.info("review warmup started")
