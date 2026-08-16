"""Shared HTTP helpers for Vibe-Research API routers.

Validation, process-local TTL caches, and Daily Review warmup hook.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor

import astock
from cache import TTLCache, is_nonempty
from fastapi import HTTPException

_CODE_RE = r"^\d{6}$"
_SYMBOL_RE = re.compile(
    r"^(?:(?:sh|sz|bj)\d{6}|\d{6}|hkhsi|hkhstech|usdji|usixic|usinx|usvix|ussoxx|whusdcny)$",
    re.IGNORECASE,
)
_SYMBOL_HINT = "代码须为 6 位数字、sh/sz/bj+6 位、hkHSI/hkHSTECH、usIXIC 等美股指数或 whUSDCNY"


def _validate(code: str) -> str:
    code = (code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    return code


def _validate_symbol(code: str) -> str:
    """6-digit, sh/sz/bj+6, HK/US indices, or FX whUSDCNY (canonical case)."""
    raw = (code or "").strip()
    if not _SYMBOL_RE.fullmatch(raw):
        raise HTTPException(400, _SYMBOL_HINT)
    # Preserve Tencent-required case for HK / US indices; lowercase A-share symbols
    resolved = astock.resolve_symbol(raw)
    if not resolved:
        raise HTTPException(400, _SYMBOL_HINT)
    return resolved


_PCT_CACHE = TTLCache(maxsize=256, default_ttl=1800, negative_ttl=30, name="pct")
_ANN_CACHE = TTLCache(maxsize=256, default_ttl=900, negative_ttl=30, name="ann")
_FIN_CACHE = TTLCache(maxsize=256, default_ttl=1800, negative_ttl=30, name="fin")



# ---------------------------------------------------------------------------
# 资金面 / 筹码 / 信号（东财数据中心，v3.3 并入）—— 均为「用户查的那只股」的公开数据。
# 这些多为日/季级静态数据, 统一走 30 分钟缓存, 降低东财重复拉取.
# ---------------------------------------------------------------------------

# Daily-review / fund-flow style endpoints. Empty upstream blips use a short
# negative TTL so warmup + concurrent tabs do not stampede Eastmoney.
_DC_CACHE = TTLCache(maxsize=512, default_ttl=300, negative_ttl=15, name="app_dc")

# Same as marketingdashboard /api/board-flow: 120s Eastmoney cache.
# Frontend still polls every 10s and hits this cache.
BOARD_FLOW_TTL = 120
BOARD_FLOW_N = 20

# Same keys as GET /api/market/{world-indices,boards,rank,stock-flow,board-flow-intraday,commodities}
COCKPIT_WARM_KEYS = (
    "world_indices",
    "commodities",
    "sector_boards",
    "stock_rank",
    "stock_flow",
    "board_flow_intraday",
)
# Tencent / Sina only. Safe to warm while a user snapshot holds the Eastmoney lane.
_PAINT_SAFE_COCKPIT = frozenset({
    "world_indices",
    "commodities",
    "sector_boards",
    "stock_rank",
})


def _cached(endpoint: str, code: str, ttl: int, fetch, valid=is_nonempty):
    return _DC_CACHE.get_or_set(
        (endpoint, code),
        fetch,
        ttl=ttl,
        valid=valid,
        negative_ttl=15,
    )


def light_kline_ttl(sym: str, res: str) -> int:
    """Index/FX minute charts stay fresher than single-stock sparks."""
    if res != "1":
        return 60
    s = (sym or "").lower()
    if s.startswith(("sh000", "sz399", "hk", "us", "wh")):
        return 20
    return 120


def light_kline_map(codes: list[str], res: str = "1", num: int = 240) -> dict[str, dict | None]:
    """Batch light kline. Same cache keys as GET /astock/light-kline. Max 40."""
    seen: set[str] = set()
    jobs: list[tuple[str, str]] = []
    out: dict[str, dict | None] = {}
    for raw in codes:
        key = (raw or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        if len(jobs) >= 40:
            break
        try:
            sym = _validate_symbol(key)
        except HTTPException:
            out[key] = None
            continue
        jobs.append((key, sym))

    def _one(pair: tuple[str, str]) -> tuple[str, str, dict | None]:
        raw, sym = pair
        data = _cached(
            f"ashare_light:{res}:{num}",
            sym,
            light_kline_ttl(sym, res),
            lambda: astock.light_kline(sym, res, num=num),
        )
        return raw, sym, data if isinstance(data, dict) and data else None

    if not jobs:
        return out
    with ThreadPoolExecutor(max_workers=min(8, len(jobs))) as pool:
        for raw, sym, data in pool.map(_one, jobs):
            out[raw] = data
            if sym != raw:
                out[sym] = data
    return out


def _warm_review_dc(paint_only: bool = False) -> tuple[int, int, list[dict]]:
    """Warm app-level caches used by Daily Review (indices / boards / pools / 分时).

    paint_only=True skips Eastmoney-heavy keys so a user snapshot is not
    competing for Eastmoney RTT; Tencent/Sina minute + quote keys still fill.
    """
    import astock_boards
    from concurrent.futures import ThreadPoolExecutor, as_completed

    errors: list[dict] = []
    ok = 0
    steps = [
        ("indices", lambda: _cached("indices", "live", 60, astock.index_quote)),
    ]
    if not paint_only:
        steps.extend(
            [
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
            ]
        )
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

    minute_syms = list(getattr(astock, "A_INDICES", []) or []) + list(
        getattr(astock, "US_INDICES", []) or []
    ) + list(getattr(astock, "FX_INDICES", []) or [])
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

    # Cockpit first-paint keys (Tencent/Sina quotes; Eastmoney only for unique flows).
    import cockpit_live

    cockpit_steps = [
        ("world_indices", lambda: _cached("world_indices", "live", 20, cockpit_live.world_indices)),
        (
            "commodities",
            lambda: _cached(
                "commodities",
                cockpit_live.DEFAULT_FUTURES,
                20,
                lambda: cockpit_live.futures_quotes(cockpit_live.DEFAULT_FUTURES),
            ),
        ),
        (
            "sector_boards",
            lambda: _cached(
                "sector_boards",
                "01:0:80",
                20,
                lambda: cockpit_live.sector_boards("01", "0", 80),
            ),
        ),
        (
            "sector_boards",
            lambda: _cached(
                "sector_boards",
                "01:1:80",
                20,
                lambda: cockpit_live.sector_boards("01", "1", 80),
            ),
        ),
        (
            "stock_rank",
            lambda: _cached(
                "stock_rank",
                "amount:0:30",
                20,
                lambda: cockpit_live.stock_rank("amount", 0, 30),
            ),
        ),
        (
            "stock_flow",
            lambda: _cached(
                "stock_flow",
                "all:15",
                120,
                lambda: astock_boards.stock_moneyflow(15, None),
            ),
        ),
        (
            "board_flow_ranks",
            lambda: _cached(
                "board_flow_ranks",
                str(BOARD_FLOW_N),
                BOARD_FLOW_TTL,
                lambda: cockpit_live.board_flow_intraday(BOARD_FLOW_N, curves=False),
                valid=lambda d: isinstance(d, list) and len(d) > 0,
            ),
        ),
        (
            "board_flow_intraday",
            lambda: _cached(
                "board_flow_intraday",
                str(BOARD_FLOW_N),
                BOARD_FLOW_TTL,
                lambda: cockpit_live.board_flow_intraday(BOARD_FLOW_N, curves=True),
            ),
        ),
    ]
    if paint_only:
        cockpit_steps = [
            step for step in cockpit_steps if step[0] in _PAINT_SAFE_COCKPIT
        ]
    for name, fn in cockpit_steps:
        try:
            fn()
            ok += 1
        except Exception as e:
            errors.append({"name": name, "error": str(e)[:160]})
    return ok, len(steps) + len(minute_syms) + len(cockpit_steps) - ok, errors


# Background: keep Daily Review caches warm (session-aware interval).

