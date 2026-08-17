"""Fill the market parquet store for the A-share universe.

Same bars/ + adj/ layout as a normal backtest. Last 2y, closed bars only.
Already-covered symbols are skipped. Not on review warmup / quote hub.
"""
from __future__ import annotations

import json
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import universe
from backtest.market import last_closed_iso, market_root
from backtest.store import ensure_bars

BEIJING = timezone(timedelta(hours=8))
LOOKBACK_DAYS = 730
LOOKBACK = "2y"
WORKERS = 4
STATUS_NAME = "universe-sync.json"

_LOCK = threading.Lock()
_THREAD: threading.Thread | None = None


def window(closed_end: str | None = None) -> tuple[str, str]:
    end = closed_end or last_closed_iso()
    start = (date.fromisoformat(end) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    if start > end:
        return end, end
    return start, end


def status_path() -> Path:
    return market_root() / STATUS_NAME


def _now() -> str:
    return datetime.now(BEIJING).strftime("%Y-%m-%d %H:%M:%S")


def _idle() -> dict[str, Any]:
    start, end = window()
    return {
        "state": "idle",
        "lookback": LOOKBACK,
        "start": start,
        "end": end,
        "universe": 0,
        "done": 0,
        "ok": 0,
        "skip": 0,
        "fail": 0,
        "current": "",
        "error": "",
        "updated": "",
    }


def read_status() -> dict[str, Any]:
    raw = _idle()
    path = status_path()
    if not path.is_file():
        return raw
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return raw
    if isinstance(data, dict):
        raw.update(data)
    return raw


def _write_status(payload: dict[str, Any]) -> None:
    path = status_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass


def to_symbol(code: str) -> str:
    import astock

    return astock.resolve_symbol(code) or ""


def disk_symbols() -> set[str]:
    root = market_root() / "bars"
    if not root.is_dir():
        return set()
    out: set[str] = set()
    for folder in root.glob("symbol=*"):
        if folder.is_dir():
            out.add(folder.name.split("=", 1)[-1])
    return out


def portrait() -> dict[str, Any]:
    """Coverage + last sync. No network."""
    start, end = window()
    codes = universe.read_codes(fresh_only=False)
    on_disk = disk_symbols()
    have = 0
    for c in codes:
        sym = to_symbol(c)
        if sym and sym in on_disk:
            have += 1
    st = read_status()
    window_match = str(st.get("start") or "") == start and str(st.get("end") or "") == end
    covered = int(st.get("ok") or 0) + int(st.get("skip") or 0) if window_match else have
    return {
        "lookback": LOOKBACK,
        "start": start,
        "end": end,
        "codes": len(codes),
        "on_disk": have,
        "covered": min(covered, len(codes)),
        "window_match": window_match,
        "sync": st,
    }


def _covered(symbol: str, start: str, end: str) -> bool:
    from backtest.market import coverage

    cov = coverage(symbol)
    return bool(cov and cov[0] <= start and cov[1] >= end)


def _one(symbol: str, start: str, end: str, fetch_fn, retries: int = 2) -> str:
    """Return ok / skip / fail. Live Tencent often flakes; retry a couple times."""
    if _covered(symbol, start, end):
        return "skip"
    tries = max(1, int(retries) + 1)
    for i in range(tries):
        try:
            pack = ensure_bars(symbol, start, end, fetch_fn=fetch_fn, use_cache=True)
        except Exception:
            pack = {}
        if pack.get("bars") and not pack.get("error"):
            return "ok"
        if i + 1 < tries:
            time.sleep(0.8 * (i + 1))
    return "fail"


def run_sync(
    *,
    fetch_fn=None,
    codes: list[str] | None = None,
    workers: int = WORKERS,
    on_tick=None,
) -> dict[str, Any]:
    """Fill missing 2y bars. fetch_fn/codes/on_tick injected by tests or CLI."""
    start, end = window()
    pool = universe.normalize(codes) if codes is not None else universe.read_codes(fresh_only=False)
    st = {
        **_idle(),
        "state": "running",
        "start": start,
        "end": end,
        "universe": len(pool),
        "started": _now(),
        "updated": _now(),
    }
    if not pool:
        st["state"] = "error"
        st["error"] = "没有标的池, 先打开复盘让广度拉一次全 A 名单"
        _write_status(st)
        return st
    _write_status(st)

    symbols = [to_symbol(c) for c in pool]
    symbols = [s for s in symbols if s]
    st["universe"] = len(symbols)

    from concurrent.futures import ThreadPoolExecutor, as_completed

    n_workers = max(1, min(int(workers or 1), WORKERS))

    def _job(sym: str) -> tuple[str, str]:
        try:
            return sym, _one(sym, start, end, fetch_fn)
        except Exception:
            return sym, "fail"

    with ThreadPoolExecutor(max_workers=n_workers) as exe:
        futs = [exe.submit(_job, sym) for sym in symbols]
        for fut in as_completed(futs):
            sym, kind = fut.result()
            st["done"] = int(st["done"]) + 1
            st[kind] = int(st.get(kind) or 0) + 1
            st["current"] = sym
            st["updated"] = _now()
            if on_tick is not None:
                on_tick(st)
            if int(st["done"]) % 20 == 0 or int(st["done"]) == len(symbols):
                _write_status(st)

    st["state"] = "done"
    st["current"] = ""
    st["updated"] = _now()
    _write_status(st)
    return st


def start_sync(*, fetch_fn=None) -> dict[str, Any]:
    """Kick a background fill. If one is running, return that status."""
    global _THREAD
    with _LOCK:
        st = read_status()
        if st.get("state") == "running" and _THREAD is not None and _THREAD.is_alive():
            return st
        start, end = window()
        codes = universe.read_codes(fresh_only=False)
        pending = {
            **_idle(),
            "state": "running",
            "start": start,
            "end": end,
            "universe": len(codes),
            "started": _now(),
            "updated": _now(),
        }
        if not codes:
            pending["state"] = "error"
            pending["error"] = "没有标的池, 先打开复盘让广度拉一次全 A 名单"
            _write_status(pending)
            return pending
        _write_status(pending)

        def _run() -> None:
            try:
                run_sync(fetch_fn=fetch_fn)
            except Exception as e:
                err = read_status()
                err["state"] = "error"
                err["error"] = str(e)
                err["updated"] = _now()
                _write_status(err)

        _THREAD = threading.Thread(target=_run, name="universe-sync", daemon=True)
        _THREAD.start()
    return read_status()
