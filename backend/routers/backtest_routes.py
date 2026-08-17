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
def backtest_index_pool(index: str = "", refresh: int = 0):
    """Latest constituents for the form. Snapshot, not daily PIT."""
    from backtest.index_pool import load_index_pool

    try:
        return {"data": load_index_pool(index, refresh=bool(refresh))}
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
    """Fill missing 2y daily bars for the A-share universe. Returns immediately."""
    from backtest.universe_sync import start_sync

    return {"data": start_sync()}


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


@router.post("/api/backtest/factor/compare")
def backtest_factor_compare(body: dict | None = None):
    from backtest.factor import run_factor_compare

    try:
        return {"data": run_factor_compare(body or {})}
    except BacktestError as e:
        raise HTTPException(400, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
