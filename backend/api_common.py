"""Shared HTTP helpers for Vibe-Research API routers.

Validation, process-local TTL caches, and Daily Review warmup hook.
"""
from __future__ import annotations

import re

import astock
from cache import TTLCache, is_nonempty
from fastapi import HTTPException

_CODE_RE = r"^\d{6}$"
_SYMBOL_RE = re.compile(
    r"^(?:(?:sh|sz|bj)\d{6}|\d{6}|hkhsi|hkhstech)$",
    re.IGNORECASE,
)


def _validate(code: str) -> str:
    code = (code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    return code


def _validate_symbol(code: str) -> str:
    """6-digit, sh/sz/bj+6, or HK index hkHSI / hkHSTECH (canonical case)."""
    raw = (code or "").strip()
    if not _SYMBOL_RE.fullmatch(raw):
        raise HTTPException(400, "代码须为 6 位数字、sh/sz/bj+6 位或 hkHSI/hkHSTECH")
    # Preserve Tencent-required case for HK indices; lowercase A-share symbols
    resolved = astock.resolve_symbol(raw)
    if not resolved:
        raise HTTPException(400, "代码须为 6 位数字、sh/sz/bj+6 位或 hkHSI/hkHSTECH")
    return resolved


_PCT_CACHE = TTLCache(maxsize=256, default_ttl=1800, negative_ttl=30, name="pct")
_ANN_CACHE = TTLCache(maxsize=256, default_ttl=900, negative_ttl=30, name="ann")
_FIN_CACHE = TTLCache(maxsize=256, default_ttl=1800, negative_ttl=30, name="fin")



# ---------------------------------------------------------------------------
# 资金面 / 筹码 / 信号（东财数据中心，v3.3 并入）—— 均为「用户查的那只股」的公开数据。
# 东财有 1s 限流，这些多为日/季级静态数据，统一走 30 分钟缓存，进一步降低被封风险。
# ---------------------------------------------------------------------------

# Daily-review / fund-flow style endpoints. Empty upstream blips use a short
# negative TTL so warmup + concurrent tabs do not stampede Eastmoney.
_DC_CACHE = TTLCache(maxsize=512, default_ttl=300, negative_ttl=15, name="app_dc")


def _cached(endpoint: str, code: str, ttl: int, fetch, valid=is_nonempty):
    return _DC_CACHE.get_or_set(
        (endpoint, code),
        fetch,
        ttl=ttl,
        valid=valid,
        negative_ttl=15,
    )


def _warm_review_dc() -> tuple[int, int, list[dict]]:
    """Warm app-level caches used by Daily Review (indices / boards / pools / 分时)."""
    import astock_boards
    from concurrent.futures import ThreadPoolExecutor, as_completed

    errors: list[dict] = []
    ok = 0
    steps = [
        ("indices", lambda: _cached("indices", "live", 60, astock.index_quote)),
        (
            "board_flow",
            lambda: _cached(
                "board_flow",
                "industry:today:20",
                180,
                lambda: astock_boards.board_fund_flow("industry", "today", 20),
            ),
        ),
        (
            "hot_ths",
            lambda: _cached(
                "hot_ths",
                "hour:25",
                180,
                lambda: astock_boards.ths_hot_list("hour", 25),
            ),
        ),
        (
            "industry",
            lambda: _cached(
                "industry",
                "20",
                300,
                lambda: astock.industry_comparison(top_n=20),
            ),
        ),
        (
            "dt_daily",
            lambda: _cached(
                "dt_daily",
                "auto:40:all",
                600,
                lambda: astock.daily_dragon_tiger(None, None, top=40),
            ),
        ),
        (
            "limit_zt",
            lambda: _cached(
                "limit_pool",
                "zt:40",
                180,
                lambda: astock_boards.limit_up_pools("zt", top=40),
            ),
        ),
        (
            "ths_limit_up",
            lambda: _cached(
                "ths_limit_up",
                "today",
                180,
                lambda: astock.ths_limit_up_pool(None),
            ),
        ),
        (
            "monitor",
            lambda: _cached(
                "monitor",
                "active",
                600,
                lambda: astock_boards.em_stock_monitor(True),
            ),
        ),
        (
            "anomaly",
            lambda: _cached(
                "anomaly",
                "40",
                300,
                lambda: astock_boards.em_price_anomaly(40),
            ),
        ),
    ]
    for name, fn in steps:
        try:
            fn()
            ok += 1
        except Exception as e:
            errors.append({"name": name, "error": str(e)[:160]})

    # Index minute charts (same key as GET /api/astock/light-kline?resolution=1&num=240)
    def _warm_minute(sym: str) -> None:
        data = _cached(
            "ashare_light:1:240",
            sym,
            120,
            lambda: astock.light_kline(sym, "1", num=240),
        )
        if not data:
            raise RuntimeError(f"empty minute for {sym}")

    minute_syms = list(getattr(astock, "A_INDICES", []) or [])
    if minute_syms:
        with ThreadPoolExecutor(max_workers=min(6, len(minute_syms))) as pool:
            futs = {pool.submit(_warm_minute, sym): sym for sym in minute_syms}
            for fut in as_completed(futs):
                sym = futs[fut]
                name = f"minute:{sym}"
                try:
                    fut.result()
                    ok += 1
                except Exception as e:
                    errors.append({"name": name, "error": str(e)[:160]})
    return ok, len(steps) + len(minute_syms) - ok, errors


# Background: keep Daily Review caches warm (session-aware interval).

