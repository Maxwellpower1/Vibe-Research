from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

import fin_window
from api_common import _cached, _read

router = APIRouter(tags=["fin"])


@router.get("/api/fin/board")
def fin_board(period: str = Query("", description="YYYY-MM-DD report date")):
    """盈利榜 + 行业聚合 + 披露日历. 并行拉东财, 缓存 1 小时."""
    p = fin_window.valid_period(period)
    try:
        data = _cached("fin_board", p, 3600, lambda: fin_window.finance_board(p))
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"财报宏观包异常：{e}") from e


@router.get("/api/fin/forecast")
def fin_forecast(period: str = Query("", description="YYYY-MM-DD report date")):
    """业绩预告. 缓存 1 小时."""
    p = fin_window.valid_period(period)
    try:
        data = _cached("fin_forecast", p, 3600, lambda: fin_window.finance_forecast(p))
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"业绩预告异常：{e}") from e


@router.get("/api/fin/company")
def fin_company(code: str = Query(..., description="6-digit or sh600519")):
    """单公司: F10 近 12 期 + 主营/现金流. 缓存 30 分钟."""
    raw = fin_window.bare_code(code)
    if not raw:
        raise HTTPException(400, "代码须为 6 位数字")
    try:
        data = _read("fin_company", raw, 1800, lambda: fin_window.company_bundle(raw))
        return {"data": data}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"公司财报异常：{e}") from e


@router.get("/api/fin/suggest")
def fin_suggest(q: str = Query(..., min_length=1), n: int = Query(8, ge=1, le=15)):
    """A 股代码/名称联想. 缓存 10 分钟."""
    key = q.strip()[:20]
    try:
        data = _cached("fin_suggest", key, 600, lambda: fin_window.suggest_ashare(key, n))
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"证券搜索异常：{e}") from e
