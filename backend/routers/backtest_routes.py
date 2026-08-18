"""Daily account backtest HTTP. Research simulation, not a recommendation."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backtest.archive import delete_run, list_runs, read_run, result_from_run
from backtest.market import inventory, peek_bars
from backtest.service import BacktestError, meta, run_backtest

router = APIRouter(tags=["backtest"])


@router.get("/api/backtest/meta")
def backtest_meta():
    return {"data": meta()}


@router.get("/api/backtest/progress")
def backtest_progress():
    """In-memory job progress. Poll while POST /run is in flight."""
    from backtest.progress import snapshot

    return {"data": snapshot()}


@router.get("/api/backtest/index-pool")
def backtest_index_pool(index: str = "", refresh: int = 0, history: int = 0):
    """Latest constituents for the form. history=1 also writes CSI change-date snapshots."""
    from backtest.index_pool import load_index_pool

    try:
        return {"data": load_index_pool(index, refresh=bool(refresh), history=bool(history))}
    except BacktestError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/api/backtest/store")
def backtest_store(
    codes: str | None = None,
    lookback: str | None = None,
    start: str | None = None,
    end: str | None = None,
):
    if not (codes or "").strip():
        return {"data": inventory()}
    from backtest.market import data_root, last_closed_iso
    from backtest.service import BacktestError, lookback_range, resolve_codes
    from backtest.store import probe_symbols
    from backtest.universe_sync import portrait

    try:
        symbols = resolve_codes(codes or "")
        win_start, win_end = lookback_range(lookback, start, end)
    except BacktestError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "data": {
            "root": str(data_root()),
            "closed_end": last_closed_iso(),
            "universe": portrait(),
            "probe": probe_symbols(symbols, win_start, win_end),
            "note": "回测标的覆盖. 缺的跑回测时现拉并写入库存.",
        }
    }


@router.post("/api/backtest/store/sync")
def backtest_store_sync():
    """Fill missing store-window daily bars for the A-share universe. Returns immediately."""
    from backtest.universe_sync import start_sync

    return {"data": start_sync()}


@router.post("/api/backtest/store/members")
def backtest_store_members(body: dict | None = None):
    """Write CSI change-date snapshots into members/. One index or all pools."""
    from backtest.index_pool import POOLS
    from backtest.members_hist import ensure_member_history

    payload = body or {}
    want = str(payload.get("index") or "").strip().lower()
    specs = [p for p in POOLS if (not want) or p["id"] == want]
    if want and not specs:
        raise HTTPException(400, f"不支持的指数: {want}")
    items = []
    for spec in specs:
        try:
            items.append(ensure_member_history(
                spec["id"],
                refresh=bool(payload.get("refresh")),
                csi_code=spec.get("csi") or "",
            ))
        except BacktestError as exc:
            items.append({"id": spec["id"], "error": str(exc)})
    return {"data": {"items": items}}


@router.post("/api/backtest/store/fundamentals")
def backtest_store_fundamentals(body: dict | None = None):
    """Write F10 facts with announce_date. Caps at 600."""
    from backtest.fundamentals import sync_fundamentals
    from backtest.index_pool import POOLS
    from backtest.market import last_closed_iso, members_on, members_union
    from backtest.service import MAX_CODES, resolve_codes

    payload = body or {}
    codes = payload.get("codes") or []
    index_id = str(payload.get("index") or "").strip().lower()
    if isinstance(codes, str):
        symbols = resolve_codes(codes, limit=MAX_CODES)
    elif codes:
        symbols = resolve_codes(codes, limit=MAX_CODES)
    elif index_id:
        asof = last_closed_iso()
        symbols = members_union(index_id, "2000-01-01", asof) or members_on(index_id, asof)
    else:
        asof = last_closed_iso()
        seen: list[str] = []
        for spec in POOLS:
            for sym in members_union(spec["id"], "2000-01-01", asof) or members_on(spec["id"], asof):
                if sym not in seen:
                    seen.append(sym)
                if len(seen) >= MAX_CODES:
                    break
            if len(seen) >= MAX_CODES:
                break
        symbols = seen
    if not symbols:
        raise HTTPException(400, "没有可写财务的标的: 先导入指数成分或传入 codes")
    return {"data": sync_fundamentals(symbols[:MAX_CODES])}


@router.get("/api/backtest/store/{symbol}")
def backtest_store_peek(symbol: str, n: int = 30):
    import astock

    sym = astock.resolve_symbol(symbol)
    if not sym:
        raise HTTPException(400, "无法解析的代码")
    return {"data": peek_bars(sym, n)}


@router.get("/api/backtest/runs")
def backtest_runs(limit: int = 40, kind: str | None = None):
    return {"data": list_runs(limit, kind=kind)}


@router.get("/api/backtest/runs/{run_id}")
def backtest_run_get(run_id: str):
    pack = read_run(run_id)
    if not pack:
        raise HTTPException(404, "没有这个实验")
    return {"data": result_from_run(pack)}


@router.delete("/api/backtest/runs/{run_id}")
def backtest_run_delete(run_id: str):
    if not delete_run(run_id):
        raise HTTPException(404, "没有这个实验")
    return {"data": {"ok": True, "id": run_id}}


@router.post("/api/backtest/run")
def backtest_run(body: dict | None = None):
    try:
        return {"data": run_backtest(body or {})}
    except BacktestError as e:
        raise HTTPException(400, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/api/backtest/factor")
def backtest_factor(body: dict | None = None):
    from backtest.factor import run_factor

    try:
        return {"data": run_factor(body or {})}
    except BacktestError as e:
        raise HTTPException(400, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/api/backtest/model")
def backtest_model(body: dict | None = None):
    from backtest.model import run_model

    try:
        return {"data": run_model(body or {})}
    except BacktestError as e:
        raise HTTPException(400, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/api/backtest/factor/compare")
def backtest_factor_compare(body: dict | None = None):
    from backtest.factor import run_factor_compare

    try:
        return {"data": run_factor_compare(body or {})}
    except BacktestError as e:
        raise HTTPException(400, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
