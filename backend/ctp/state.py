"""Process-global CTP session / log / market-equity job state."""
from __future__ import annotations

import threading
from collections import deque
from datetime import datetime
from typing import Any

from ctp.constants import BEIJING, _LOG_MAX

_lock = threading.RLock()  # protects session pointer / flags / log buffer
_op_lock = threading.Lock()  # serializes login / query / logout (never held in SPI)
# Async market-equity job (option instrument + tick qry is slow due to CTP rate limit)
_me_lock = threading.Lock()
_me_seq = 0
_me_state: dict[str, Any] = {
    "status": "idle",  # idle | pending | running | ready | error
    "seq": 0,
    "result": None,
    "error": None,
    "updated": None,
    "trading_day": "",
}
_logs: deque[dict[str, Any]] = deque(maxlen=_LOG_MAX)
_log_seq = 0
_session: Any = None  # CtpSession | None
_logging_in = False


def _is_logged_in_unlocked() -> bool:
    return _session is not None and getattr(_session, "ready", False)


def _now() -> str:
    return datetime.now(BEIJING).strftime("%Y-%m-%d %H:%M:%S")


def _now_ms() -> str:
    return datetime.now(BEIJING).strftime("%H:%M:%S.%f")[:-3]


def add_log(message: str, level: str = "info") -> None:
    """Append a log line visible to the frontend."""
    global _log_seq
    with _lock:
        _log_seq += 1
        entry = {
            "id": _log_seq,
            "ts": _now_ms(),
            "level": level,
            "message": str(message),
        }
        _logs.append(entry)


def get_logs(since: int = 0) -> dict[str, Any]:
    """Return logs with id > since (or all if since=0 and buffer small)."""
    with _lock:
        items = [e for e in _logs if e["id"] > since]
        return {
            "logs": items,
            "next_since": _log_seq,
            "logged_in": _is_logged_in_unlocked(),
        }


def clear_logs() -> None:
    with _lock:
        _logs.clear()

