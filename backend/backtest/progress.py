"""In-memory backtest job progress. Not jobs.json, not a queue."""

from __future__ import annotations

import threading
from typing import Any

_LOCK = threading.Lock()
_STEPS = {
    "load": "读日 K",
    "signals": "算信号",
    "match": "撮合",
    "factor": "算因子",
    "compare": "对照",
    "write": "写实验",
    "done": "完成",
}

_IDLE: dict[str, Any] = {
    "state": "idle",
    "kind": "",
    "step": "",
    "label": "",
    "done": 0,
    "total": 0,
    "current": "",
    "note": "",
}

_STATE: dict[str, Any] = dict(_IDLE)


def snapshot() -> dict[str, Any]:
    with _LOCK:
        return dict(_STATE)


def begin(*, kind: str, step: str = "load", total: int = 0, note: str = "") -> None:
    with _LOCK:
        _STATE.update({
            "state": "running",
            "kind": kind,
            "step": step,
            "label": _STEPS.get(step, step),
            "done": 0,
            "total": max(0, int(total)),
            "current": "",
            "note": note,
        })


def mark(*, step: str | None = None, done: int | None = None, total: int | None = None,
         current: str = "", note: str | None = None) -> None:
    with _LOCK:
        if step:
            _STATE["step"] = step
            _STATE["label"] = _STEPS.get(step, step)
        if done is not None:
            _STATE["done"] = int(done)
        if total is not None:
            _STATE["total"] = max(0, int(total))
        if current:
            _STATE["current"] = current[-6:] if len(current) >= 6 else current
        if note is not None:
            _STATE["note"] = note


def bump(current: str = "") -> None:
    with _LOCK:
        _STATE["done"] = int(_STATE.get("done") or 0) + 1
        if current:
            _STATE["current"] = current[-6:] if len(current) >= 6 else current


def finish() -> None:
    with _LOCK:
        _STATE["state"] = "done"
        _STATE["step"] = "done"
        _STATE["label"] = _STEPS["done"]
        _STATE["current"] = ""
