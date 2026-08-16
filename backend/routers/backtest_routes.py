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


@router.get("/api/backtest/store")
def backtest_store():
    return {"data": inventory()}


@router.get("/api/backtest/store/{symbol}")
def backtest_store_peek(symbol: str, n: int = 30):
    import astock

    sym = astock.resolve_symbol(symbol)
    if not sym:
        raise HTTPException(400, "无法解析的代码")
    return {"data": peek_bars(sym, n)}


@router.get("/api/backtest/runs")
def backtest_runs(limit: int = 40):
    return {"data": list_runs(limit)}


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
