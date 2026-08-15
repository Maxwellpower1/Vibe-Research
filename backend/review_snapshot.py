"""Daily Review BFF: one payload for the first paint / top-row refresh.

Frontend used to fan out 10-15 /api calls. Eastmoney is globally serialized at
~1 req/s, so that looked concurrent and still queued. This module reads the
same TTL keys as the individual endpoints (single-flight with warmup).
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import astock
import astock_boards
import market
import review_warmup
from api_common import _cached

BEIJING = timezone(timedelta(hours=8))

_LIMIT_KINDS = ("zt", "zb", "dt", "yzt", "jm")
_BOARD_TYPES = ("industry", "concept", "region")
_BOARD_PERIODS = ("today", "5d", "10d")


def _grab(name: str, fn: Callable[[], Any], bucket: dict[str, Any], errors: list[dict]) -> None:
    try:
        bucket[name] = fn()
    except Exception as e:
        bucket[name] = None
        errors.append({"name": name, "error": str(e)[:160]})


def _fill_tencent(bucket: dict[str, Any], errors: list[dict]) -> None:
    _grab("indices", lambda: _cached("indices", "live", 60, astock.index_quote), bucket, errors)
    _grab("hsgt", lambda: _cached("hsgt", "live", 120, astock_boards.hsgt_realtime), bucket, errors)


def _fill_overview(bucket: dict[str, Any], errors: list[dict]) -> None:
    _grab("overview", market.get_overview, bucket, errors)


def _fill_em_top(bucket: dict[str, Any], errors: list[dict]) -> None:
    """Eastmoney-backed top rows; run in one thread so they share em_get's lock."""
    _grab("global_indices", market.get_global_indices, bucket, errors)
    _grab("emotion", market.get_short_term_emotion, bucket, errors)
    _grab("turnover", market.get_turnover_top, bucket, errors)
    _grab(
        "hot",
        lambda: _cached(
            "hot_ths",
            "hour:25",
            180,
            lambda: astock_boards.ths_hot_list("hour", 25),
        ),
        bucket,
        errors,
    )
    _grab(
        "industry",
        lambda: _cached(
            "industry",
            "20",
            300,
            lambda: astock.industry_comparison(top_n=20),
            valid=lambda d: bool(isinstance(d, dict) and d.get("top")),
        ),
        bucket,
        errors,
    )


def _fill_em_extra(
    bucket: dict[str, Any],
    errors: list[dict],
    *,
    board_type: str,
    board_period: str,
    limit_kind: str,
) -> None:
    _grab(
        "lhb",
        lambda: _cached(
            "dt_daily",
            "auto:40:all",
            600,
            lambda: astock.daily_dragon_tiger(None, None, top=40),
        ),
        bucket,
        errors,
    )
    _grab(
        "monitor",
        lambda: _cached("monitor", "active", 600, lambda: astock_boards.em_stock_monitor(True)),
        bucket,
        errors,
    )
    _grab(
        "anomaly",
        lambda: _cached("anomaly", "40", 300, lambda: astock_boards.em_price_anomaly(40)),
        bucket,
        errors,
    )
    if limit_kind == "jm":
        bucket["limit_pool"] = None
        _grab(
            "ths_limit_up",
            lambda: _cached("ths_limit_up", "today", 180, lambda: astock.ths_limit_up_pool(None)),
            bucket,
            errors,
        )
    else:
        bucket["ths_limit_up"] = None
        _grab(
            "limit_pool",
            lambda: _cached(
                "limit_pool",
                f"{limit_kind}:40",
                180,
                lambda: astock_boards.limit_up_pools(limit_kind, top=40),
            ),
            bucket,
            errors,
        )
    _grab(
        "board_flow",
        lambda: _cached(
            "board_flow",
            f"{board_type}:{board_period}:20",
            180,
            lambda: astock_boards.board_fund_flow(board_type, board_period, 20),
        ),
        bucket,
        errors,
    )


def build_review_snapshot(
    *,
    scope: str = "full",
    board_type: str = "industry",
    board_period: str = "today",
    limit_kind: str = "zt",
) -> dict[str, Any]:
    """Assemble Daily Review payload. scope=top skips boards/risk panels."""
    scope = (scope or "full").strip().lower()
    if scope not in ("top", "full"):
        scope = "full"
    board_type = board_type if board_type in _BOARD_TYPES else "industry"
    board_period = board_period if board_period in _BOARD_PERIODS else "today"
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
                pool.submit(_fill_em_top, top, errors),
            ]
            for fut in futs:
                fut.result()
        if scope == "full":
            _fill_em_extra(
                extra,
                errors,
                board_type=board_type,
                board_period=board_period,
                limit_kind=limit_kind,
            )

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
