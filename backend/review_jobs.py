"""One job list for 复盘快照, warmup, mail, and 问 AI.

Callers ask for jobs; they do not keep their own panel lists.
Cache keys match GET /api/market/* so a warm pass fills 问 AI.
"""
from __future__ import annotations

from typing import Any, Callable

from api_common import BOARD_FLOW_N, BOARD_FLOW_TTL, _cached
from index_catalog import catalog_codes

Job = tuple[str, Callable[[], Any]]

PAINT_SAFE_COCKPIT = frozenset({
    "world_indices",
    "commodities",
    "sector_boards",
    "stock_rank",
})


def tencent_jobs() -> list[Job]:
    import astock
    import astock_boards

    return [
        ("indices", lambda: _cached("indices", "live", 60, astock.index_quote)),
        ("hsgt", lambda: _cached("hsgt", "live", 120, astock_boards.hsgt_realtime)),
    ]


def overview_jobs() -> list[Job]:
    import market

    return [("overview", market.get_overview)]


def em_top_jobs() -> list[Job]:
    import astock
    import market

    return [
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
    ]


def em_extra_jobs() -> list[Job]:
    import astock

    return [
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


def live_jobs(*, sector_kind: str = "01", news_source: str = "cls") -> list[Job]:
    """Panels outside 复盘快照 that 问 AI / mail still need."""
    import astock
    import astock_boards
    import cockpit_live
    import cross_section
    import lives_feed

    kind = "02" if str(sector_kind) == "02" else "01"
    src = "lives" if str(news_source) == "lives" else "cls"

    def _news() -> list:
        if src == "lives":
            d = lives_feed.market_lives(1, 12)
            items = d.get("items") if isinstance(d, dict) else None
            return items if isinstance(items, list) else []
        return astock.cls_telegraph(12)

    return [
        ("world", lambda: _cached("world_indices", "live", 20, cockpit_live.world_indices)),
        (
            "sector_up",
            lambda: _cached(
                "sector_boards",
                f"{kind}:0:80",
                20,
                lambda: cockpit_live.sector_boards(kind, "0", 80),
            ),
        ),
        (
            "sector_down",
            lambda: _cached(
                "sector_boards",
                f"{kind}:1:80",
                20,
                lambda: cockpit_live.sector_boards(kind, "1", 80),
            ),
        ),
        (
            "board_flow",
            lambda: _cached(
                "board_flow_ranks",
                str(BOARD_FLOW_N),
                BOARD_FLOW_TTL,
                lambda: cockpit_live.board_flow_intraday(BOARD_FLOW_N, curves=False),
                valid=lambda d: isinstance(d, list) and len(d) > 0,
            ),
        ),
        (
            "rank_hot",
            lambda: _cached(
                "stock_rank",
                "amount:0:30",
                20,
                lambda: cockpit_live.stock_rank("amount", 0, 30),
            ),
        ),
        (
            "rank_up",
            lambda: _cached(
                "stock_rank",
                "changepercent:0:30",
                20,
                lambda: cockpit_live.stock_rank("changepercent", 0, 30),
            ),
        ),
        (
            "rank_down",
            lambda: _cached(
                "stock_rank",
                "changepercent:1:30",
                20,
                lambda: cockpit_live.stock_rank("changepercent", 1, 30),
            ),
        ),
        (
            "commodities",
            lambda: _cached(
                "commodities",
                cockpit_live.DEFAULT_FUTURES,
                20,
                lambda: cockpit_live.futures_quotes(cockpit_live.DEFAULT_FUTURES),
            ),
        ),
        ("news", _news),
        ("breadth", cross_section.market_breadth),
        (
            "money",
            lambda: _cached(
                "stock_flow",
                "all:15",
                120,
                lambda: astock_boards.stock_moneyflow(15, None),
            ),
        ),
        (
            "etf_flow",
            lambda: _cached(
                "etf_flow",
                "net_inflow:40",
                300,
                lambda: astock.etf_fund_flow("net_inflow", 40),
            ),
        ),
        (
            "sh_chg",
            lambda: _cached(
                "shareholder",
                "all:40",
                300,
                lambda: astock.shareholder_changes("", "all", 40),
            ),
        ),
        ("lpr", lambda: _cached("lpr", "730", 3600, lambda: astock.lpr_rates(730))),
        (
            "bond_y",
            lambda: _cached(
                "bond_yield",
                "treasury",
                3600,
                lambda: astock.bond_yield_curve("treasury"),
            ),
        ),
    ]


def watch_quotes(codes: list[str] | None) -> list[dict]:
    """Tencent quotes for 自选. Empty codes -> empty list."""
    import astock

    raw = [str(c).strip() for c in (codes or []) if str(c).strip()][:20]
    if not raw:
        return []
    parsed = astock.gtimg_quotes(raw)
    out: list[dict] = []
    for c in raw:
        q = parsed.get(c)
        if q is None:
            try:
                q = parsed.get(astock.resolve_symbol(c) or "")
            except Exception:
                q = None
        if isinstance(q, dict):
            out.append({
                "name": q.get("name") or c,
                "price": q.get("price"),
                "pct": q.get("change_pct") if q.get("change_pct") is not None else q.get("pct"),
                "amount": q.get("amount"),
            })
        else:
            out.append({"name": c})
    return out


def warm_dc_jobs(*, paint_only: bool = False) -> list[Job]:
    """App-level _DC_CACHE steps. paint_only skips Eastmoney-heavy keys."""
    import astock
    import astock_boards
    import cockpit_live

    steps: list[Job] = [
        ("indices", lambda: _cached("indices", "live", 60, astock.index_quote)),
    ]
    if not paint_only:
        steps.extend(em_top_jobs()[1:])  # industry only; emotion is warm_market
        steps.extend(em_extra_jobs())

    def _warm_minute(sym: str) -> None:
        data = _cached(
            "ashare_light:1:240",
            sym,
            120,
            lambda: astock.light_kline(sym, "1", num=240),
        )
        if not data:
            raise RuntimeError(f"empty minute for {sym}")

    for sym in catalog_codes():
        steps.append((f"minute:{sym}", lambda s=sym: _warm_minute(s)))

    cockpit: list[Job] = [
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
        cockpit = [step for step in cockpit if step[0] in PAINT_SAFE_COCKPIT]
    steps.extend(cockpit)
    return steps


def run_jobs(jobs: list[Job], bucket: dict[str, Any], errors: list[str], workers: int = 6) -> None:
    from concurrent.futures import ThreadPoolExecutor

    if not jobs:
        return

    def _one(name: str, fn: Callable[[], Any]) -> None:
        try:
            bucket[name] = fn()
        except Exception as e:
            bucket[name] = None
            errors.append(f"{name}: {e}"[:160])

    with ThreadPoolExecutor(max_workers=min(workers, len(jobs))) as pool:
        futs = [pool.submit(_one, name, fn) for name, fn in jobs]
        for fut in futs:
            fut.result()
