from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

import gstock
import gstock_deep
import market
from api_common import _cached

router = APIRouter(tags=["global"])

@router.get("/api/global/indices")
def global_indices():
    """全球指数快照（道指 / 标普500 / 纳斯达克 / 恒生 / 恒生科技）—— A 股看隔夜外围脸色。缓存 5 分钟。"""
    try:
        return {"data": market.get_global_indices()}
    except Exception as e:
        raise HTTPException(502, f"全球指数异常：{e}") from e


@router.get("/api/global/stock")
def global_stock(
    symbol: str = Query(..., min_length=1, max_length=16),
    with_metrics: bool = Query(
        True, description="是否拉关键财务；观察列表可传 false 加速"
    ),
):
    """美股 / 港股个股聚合：行情 + 关键财务指标（东财域内源）。symbol 如 AAPL / BABA / 00700。"""
    try:
        data = gstock.us_hk_stock(symbol.strip(), with_metrics=with_metrics)
        if not data:
            raise HTTPException(404, f"未找到美股/港股代码「{symbol}」")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"美港股查询异常：{e}") from e


@router.get("/api/global/us/kline")
def global_us_kline(
    symbol: str = Query(..., min_length=1, max_length=16),
    num: int = Query(180, ge=20, le=1000),
):
    """美股日 K（Yahoo 前复权; 回退新浪不复权, 再回退 Stooq）。symbol 如 AAPL / TSLA。缓存 5 分钟。"""
    sym = symbol.strip().upper()
    try:
        data = _cached(
            f"us_kline:{num}", sym, 300, lambda: gstock.us_stock_kline(sym, num=num)
        )
        if not data:
            raise HTTPException(404, f"未找到美股「{symbol}」的 K 线（仅美股 ticker）")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"美股 K 线异常：{e}") from e


@router.get("/api/global/hk/kline")
def global_hk_kline(
    symbol: str = Query(..., min_length=1, max_length=16),
    num: int = Query(180, ge=20, le=1000),
):
    """港股日 K（Yahoo 前复权）。symbol 如 00700。缓存 5 分钟。"""
    sym = symbol.strip()
    try:
        data = _cached(
            f"hk_kline:{num}",
            sym.upper(),
            300,
            lambda: gstock.hk_stock_kline(sym, num=num),
        )
        if not data:
            raise HTTPException(404, f"未找到港股「{symbol}」的 K 线（仅港股）")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"港股 K 线异常：{e}") from e


@router.get("/api/global/hk/cashflow")
def global_hk_cashflow(symbol: str = Query(..., min_length=1, max_length=16)):
    """港股现金流量表（东财域内源 RPT_HKSK_FN_CASHFLOW）：经营/投资/筹资/净增加，多期。symbol 如 00700。"""
    try:
        data = gstock.hk_cashflow(symbol.strip())
        if not data:
            raise HTTPException(
                404, f"未找到港股「{symbol}」的现金流数据（仅港股支持）"
            )
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"港股现金流查询异常：{e}") from e


@router.get("/api/global/stock/fundamentals")
def global_stock_fundamentals(symbol: str = Query(..., min_length=1, max_length=16)):
    """美/港股估值+分析师+机构持仓（Yahoo）。韩股无此层。"""
    try:
        data = _cached(
            "g_fundamentals",
            symbol.strip().upper(),
            900,
            lambda: gstock_deep.stock_fundamentals(symbol.strip()),
        )
        if not data:
            raise HTTPException(404, f"未找到「{symbol}」的基本面数据")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"美港股基本面异常：{e}") from e


@router.get("/api/global/stock/statements")
def global_stock_statements(
    symbol: str = Query(..., min_length=1, max_length=16),
    statement: str = Query("income", description="income|balance|cashflow"),
    periods: int = Query(5, ge=2, le=12),
):
    """美/港股三表关键科目（东财，按报告期透视）。"""
    st = statement.strip().lower()
    if st not in ("income", "balance", "cashflow"):
        raise HTTPException(400, "statement 须为 income / balance / cashflow")
    try:
        data = _cached(
            f"g_stmt:{st}:{periods}",
            symbol.strip().upper(),
            1800,
            lambda: gstock_deep.financial_statements(symbol.strip(), st, periods),
        )
        if not data:
            raise HTTPException(404, f"未找到「{symbol}」的{st}报表")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"美港股报表异常：{e}") from e


@router.get("/api/global/stock/fund-flow")
def global_stock_fund_flow(
    symbol: str = Query(..., min_length=1, max_length=16),
    limit: int = Query(60, ge=5, le=200),
):
    """美/港股日级资金流（东财主力/大单等净流入）。"""
    try:
        data = _cached(
            f"g_fflow:{limit}",
            symbol.strip().upper(),
            900,
            lambda: gstock_deep.fund_flow_daily(symbol.strip(), limit),
        )
        if not data:
            raise HTTPException(404, f"未找到「{symbol}」的资金流")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"美港股资金流异常：{e}") from e


@router.get("/api/global/stock/short-volume")
def global_stock_short_volume(
    symbol: str = Query(..., min_length=1, max_length=16),
    days: int = Query(10, ge=3, le=30),
):
    """美股 FINRA 空头成交量时序（≠ short interest，看日度趋势）。"""
    try:
        data = _cached(
            f"g_short:{days}",
            symbol.strip().upper(),
            1800,
            lambda: gstock_deep.short_volume_symbol(symbol.strip(), days),
        )
        if not data:
            raise HTTPException(404, f"未找到美股「{symbol}」的空头成交量")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"空头成交量异常：{e}") from e


@router.get("/api/global/stock/sec-filings")
def global_stock_sec_filings(
    symbol: str = Query(..., min_length=1, max_length=16),
    limit: int = Query(40, ge=5, le=100),
):
    """美股个股 SEC 申报列表。需设置 VR_SEC_CONTACT。"""
    try:
        data = _cached(
            f"g_sec:{limit}",
            symbol.strip().upper(),
            1800,
            lambda: gstock_deep.sec_filings(symbol.strip(), limit=limit),
        )
        if not data:
            raise HTTPException(404, f"未找到美股「{symbol}」的 SEC 申报")
        return {"data": data}
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"SEC 申报异常：{e}") from e


@router.get("/api/global/sec/daily")
def global_sec_daily(
    date: str | None = Query(None, description="YYYYMMDD，默认最近有数据日"),
    limit: int = Query(80, ge=10, le=200),
):
    """全市场 SEC 当日申报流（默认 Form4 / 8-K / 13F）。需 VR_SEC_CONTACT。"""
    try:
        key = f"{date or 'latest'}:{limit}"
        data = _cached(
            "g_sec_daily",
            key,
            900,
            lambda: gstock_deep.daily_filings(date=date, limit=limit),
        )
        return {"data": data}
    except gstock_deep.DataNotAvailable as e:
        raise HTTPException(404, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"SEC 日报异常：{e}") from e


@router.get("/api/global/earnings-calendar")
def global_earnings_calendar(
    date: str | None = Query(None, description="起始日 YYYY-MM-DD，默认美东今天"),
    days: int = Query(7, ge=1, le=14, description="向前覆盖的交易日数(跳过周末)，默认 7"),
):
    """Nasdaq 美股财报日历（可看未来一段时间：盘前/盘后 + EPS 预期）。

    days=1 时等同单日；默认 7 个交易日。返回 by_day 分组 + 扁平 rows。
    """
    try:
        start = (date or "").strip() or None
        data = _cached(
            "g_earn_cal",
            f"{start or 'today'}:{days}",
            900,
            lambda: gstock_deep.earnings_calendar_range(start, days),
        )
        if not data:
            raise HTTPException(404, "财报日历无数据")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"财报日历异常：{e}") from e


@router.get("/api/global/treasury-curve")
def global_treasury_curve():
    """美债收益率曲线 1M~30Y（Treasury 官方 CSV，S 级）。含关键利差与较前日变化。"""
    try:
        data = _cached(
            "g_treasury",
            "latest",
            1800,
            lambda: gstock_deep.treasury_curve_overview(),
        )
        if not data:
            raise HTTPException(404, "美债收益率曲线无数据")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"美债曲线异常：{e}") from e


@router.get("/api/global/edgar/screener")
def global_edgar_screener(
    tag: str = Query("净利润", description="中文标签或 us-gaap 标签"),
    year: int | None = Query(None, description="默认去年"),
    quarter: int | None = Query(None, ge=1, le=4, description="1-4；不传=年度"),
    top: int = Query(20, ge=5, le=50),
    ascending: bool = Query(False, description="True=从小到大"),
):
    """SEC EDGAR frames 全市场横截面 screener（S 级）。"""
    try:
        key = f"{tag}:{year or 'y'}:{quarter or 'A'}:{top}:{int(ascending)}"
        data = _cached(
            "g_edgar_screen",
            key,
            1800,
            lambda: gstock_deep.edgar_screener(tag, year, quarter, top, ascending),
        )
        return {"data": data}
    except gstock_deep.DataNotAvailable as e:
        raise HTTPException(404, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"EDGAR screener 异常：{e}") from e


@router.get("/api/global/movers")
def global_movers(
    board: str = Query(
        "us_gainers",
        description="us_gainers|us_losers|us_amount|hk_gainers|hk_losers|hk_amount",
    ),
    top: int = Query(20, ge=5, le=50),
):
    """美/港全市场涨跌与成交额榜（东财 clist）。"""
    try:
        data = _cached(
            "g_movers",
            f"{board}:{top}",
            120,
            lambda: gstock_deep.market_movers(board, top),
        )
        if not data or not data.get("stocks"):
            raise HTTPException(404, "榜单暂无数据")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"市场榜单异常：{e}") from e


@router.get("/api/global/short-ranking")
def global_short_ranking(
    top: int = Query(20, ge=5, le=50),
    min_total: float = Query(1_000_000, ge=0, description="最小总成交过滤"),
):
    """FINRA 全市场空头占比榜（最新有数据交易日）。"""
    try:
        data = _cached(
            "g_short_rank",
            f"{top}:{int(min_total)}",
            1800,
            lambda: gstock_deep.short_volume_ranking_overview(top, min_total),
        )
        if not data or not data.get("rows"):
            raise HTTPException(404, "空头榜暂无数据")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"空头榜异常：{e}") from e


@router.get("/api/global/stock/news")
def global_stock_news(
    symbol: str = Query(..., min_length=1, max_length=32, description="AAPL / 00700 / Tesla"),
    count: int = Query(10, ge=1, le=30),
):
    """美/港个股新闻（Yahoo Finance search，合规 C 级）。缓存 5 分钟。"""
    try:
        data = _cached(
            f"g_news:{count}",
            symbol.strip().upper(),
            300,
            lambda: gstock_deep.stock_news(symbol.strip(), count),
        )
        if not data or not data.get("items"):
            raise HTTPException(404, f"未找到「{symbol}」相关新闻")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"个股新闻异常：{e}") from e


@router.get("/api/global/stock/options")
def global_stock_options(
    symbol: str = Query(..., min_length=1, max_length=16),
    unusual_top: int = Query(15, ge=5, le=40),
):
    """美股 CBOE 延时期权概览：P/C、加权 IV、0DTE/近月异动、ATM 切片。

    合规 C 级：仅供个人研究；商用须先取得 Cboe 授权。不返回全链（体量过大）。
    """
    try:
        data = _cached(
            f"g_opt:{unusual_top}",
            symbol.strip().upper(),
            300,
            lambda: gstock_deep.options_overview(symbol.strip(), unusual_top),
        )
        if not data:
            raise HTTPException(404, f"未找到美股「{symbol}」的期权数据（仅美股）")
        return {"data": data}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"期权数据异常：{e}") from e
