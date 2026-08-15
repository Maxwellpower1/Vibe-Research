"""Daily Review BFF: paint / top / full payloads share the same TTL keys.

scope=paint is Tencent + overview only (no Eastmoney). top adds emotion +
industry strength. full then fills dragon-tiger. Unused keys stay in the
JSON as None so the API shape does not break.
em_get only serializes launch gaps, so sibling Eastmoney calls overlap on HTTP RTT.
"""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import astock
import astock_boards
import market
import review_warmup
from api_common import _cached

_errors_lock = threading.Lock()

BEIJING = timezone(timedelta(hours=8))

_LIMIT_KINDS = ("zt", "zb", "dt", "yzt", "jm")


def _grab(name: str, fn: Callable[[], Any], bucket: dict[str, Any], errors: list[dict]) -> None:
    try:
        bucket[name] = fn()
    except Exception as e:
        bucket[name] = None
        with _errors_lock:
            errors.append({"name": name, "error": str(e)[:160]})


def _run_parallel(
    jobs: list[tuple[str, Callable[[], Any]]],
    bucket: dict[str, Any],
    errors: list[dict],
    workers: int = 5,
) -> None:
    if not jobs:
        return
    with ThreadPoolExecutor(max_workers=min(workers, len(jobs))) as pool:
        futs = [pool.submit(_grab, name, fn, bucket, errors) for name, fn in jobs]
        for fut in futs:
            fut.result()


def _fill_tencent(bucket: dict[str, Any], errors: list[dict]) -> None:
    _grab("indices", lambda: _cached("indices", "live", 60, astock.index_quote), bucket, errors)
    _grab("hsgt", lambda: _cached("hsgt", "live", 120, astock_boards.hsgt_realtime), bucket, errors)


def _fill_overview(bucket: dict[str, Any], errors: list[dict]) -> None:
    _grab("overview", market.get_overview, bucket, errors)


def _fill_em_top(bucket: dict[str, Any], errors: list[dict]) -> None:
    """Eastmoney-backed top rows used by the emotion panel."""
    _run_parallel(
        [
            ("emotion", market.get_short_term_emotion),
            (
                "industry",
                lambda: _cached(
                    "industry",
                    "20",
                    300,
                    lambda: astock.industry_comparison(top_n=20),
                    valid=lambda d: bool(isinstance(d, dict) and d.get("top")),
                ),
            ),
        ],
        bucket,
        errors,
    )


def _fill_em_extra(
    bucket: dict[str, Any],
    errors: list[dict],
    *,
    limit_kind: str,
) -> None:
    _ = limit_kind
    jobs: list[tuple[str, Callable[[], Any]]] = [
        (
            "lhb",
            lambda: _cached(
                "dt_daily",
                "auto:40:all",
                600,
                lambda: astock.daily_dragon_tiger(None, None, top=40),
            ),
        ),
    ]
    bucket["monitor"] = None
    bucket["anomaly"] = None
    bucket["limit_pool"] = None
    bucket["ths_limit_up"] = None
    _run_parallel(jobs, bucket, errors)


def build_review_snapshot(
    *,
    scope: str = "full",
    board_type: str = "industry",
    board_period: str = "today",
    limit_kind: str = "zt",
) -> dict[str, Any]:
    """Assemble Daily Review payload. paint < top < full."""
    scope = (scope or "full").strip().lower()
    if scope not in ("paint", "top", "full"):
        scope = "full"
    # board_type / board_period stay in the signature for older clients.
    _ = (board_type, board_period)
    limit_kind = limit_kind if limit_kind in _LIMIT_KINDS else "zt"

    top: dict[str, Any] = {}
    extra: dict[str, Any] = {
        "lhb": None,
        "monitor": None,
        "anomaly": None,
        "limit_pool": None,
        "ths_limit_up": None,
        "board_flow": None,
    }
    errors: list[dict] = []

    with review_warmup.user_fetch():
        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = [
                pool.submit(_fill_tencent, top, errors),
                pool.submit(_fill_overview, top, errors),
            ]
            if scope != "paint":
                futs.append(pool.submit(_fill_em_top, top, errors))
            for fut in futs:
                fut.result()
        if scope == "full":
            _fill_em_extra(extra, errors, limit_kind=limit_kind)

    return {
        "scope": scope,
        "indices": top.get("indices"),
        "global_indices": top.get("global_indices"),
        "overview": top.get("overview"),
        "emotion": top.get("emotion"),
        "turnover": top.get("turnover"),
        "hot": top.get("hot"),
        "industry": top.get("industry"),
        "lhb": extra.get("lhb"),
        "monitor": extra.get("monitor"),
        "anomaly": extra.get("anomaly"),
        "limit_pool": extra.get("limit_pool"),
        "ths_limit_up": extra.get("ths_limit_up"),
        "board_flow": extra.get("board_flow"),
        "hsgt": top.get("hsgt"),
        "errors": errors,
        "updated": datetime.now(BEIJING).strftime("%Y-%m-%d %H:%M:%S"),
    }
