from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

import ths_quote

router = APIRouter(tags=["ths"])


def _ths_call(fn, label: str):
    """同花顺 fuyao 端点统一异常包装: 缺依赖 501, 参数错 400, 其他 502."""
    try:
        return {"data": fn()}
    except ths_quote.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"同花顺{label}异常：{e}") from e


@router.get("/api/ths/snapshot")
def ths_snapshot(
    codes: str = Query(..., min_length=1, description="逗号分隔, 裸码(600519)或带市场(17_600519)"),
):
    """同花顺批量快照: 股票/指数/商品指数. 5s 热缓存 + 上一笔."""
    raw = [c.strip() for c in codes.split(",") if c.strip()][:50]
    if not raw:
        raise HTTPException(400, "codes 不能为空")
    return _ths_call(lambda: ths_quote.snapshot_codes(raw), "快照")


@router.get("/api/ths/kline")
def ths_kline(
    code: str = Query(..., min_length=1, max_length=32, description="裸码或 17_600519"),
    period: str = Query("day_1", description="day_1 日K(前复权) / min_1 / min_5"),
    count: int = Query(400, ge=1, le=2000),
):
    """同花顺 K线: 日K 缓存 300s, 分钟 30s."""
    pair = ths_quote.split_code(code)
    if not pair:
        raise HTTPException(400, f"无法识别代码市场: {code} (可用 17_600519 显式指定)")
    mkt, c = pair
    return _ths_call(lambda: ths_quote.kline_cached(mkt, c, period.strip(), count), "K线")
