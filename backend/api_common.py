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
# Owned by review_jobs.warm_dc_jobs; listed here so warmup tests can see the contract.
COCKPIT_WARM_KEYS = (
    "world_indices",
    "commodities",
    "sector_boards",
    "stock_rank",
    "stock_flow",
    "board_flow_intraday",
)


def _cached(endpoint: str, code: str, ttl: int, fetch, valid=is_nonempty):
    return _DC_CACHE.get_or_set(
        (endpoint, code),
        fetch,
        ttl=ttl,
        valid=valid,
        negative_ttl=15,
    )


def _session_kind() -> str:
    try:
        import review_warmup
        return review_warmup.session_kind()
    except Exception:
        return "closed"


def light_kline_ttl(sym: str, res: str, session: str | None = None) -> int:
    """Minute TTL outlasts the keep-warm gap so a refresh is a cache hit.

    Open: warmup rewrites every 20s, TTL 45/120. Closed: 960s (full warmup is 900s).
    """
    if res != "1":
        return 60
    kind = session if session is not None else _session_kind()
    s = (sym or "").lower()
    index = s.startswith(("sh000", "sz399", "hk", "us", "wh"))
    if kind == "open":
        return 45 if index else 120
    if kind == "lunch":
        return 180
    return 960


def put_light_kline(sym: str, res: str = "1", num: int = 240) -> dict:
    """Fetch and write the same key GET /light-kline uses. Warmup only."""
    resolved = astock.resolve_symbol(sym) or (sym or "").strip()
    if not resolved:
        return {}
    data = astock.light_kline(resolved, res, num=num)
    key = (f"ashare_light:{res}:{num}", resolved)
    if isinstance(data, dict) and data:
        _DC_CACHE.set(key, data, ttl=light_kline_ttl(resolved, res))
        return data
    return {}


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
    import review_jobs

    errors: list[dict] = []
    ok = 0
    steps = review_jobs.warm_dc_jobs(paint_only=paint_only)
    for name, fn in steps:
        try:
            fn()
            ok += 1
        except Exception as e:
            errors.append({"name": name, "error": str(e)[:160]})
    return ok, len(steps) - ok, errors


# Background: keep Daily Review caches warm (session-aware interval).

