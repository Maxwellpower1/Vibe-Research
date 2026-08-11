from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

import astock
from api_common import (
    _ANN_CACHE,
    _FIN_CACHE,
    _PCT_CACHE,
    _cached,
    _validate,
    _validate_symbol,
)

router = APIRouter(tags=["ashare"])

@router.get("/api/stock-basic")
def stock_basic(code: str = Query(...)):
    """个股基本资料（行业/股本/上市日，东财 push2）。缓存 30 分钟。"""
    import astock_boards
    code = _validate(code)
    try:
        data = _cached(
            "stock_basic",
            code,
            1800,
            lambda: astock_boards.stock_basic_info(code),
        )
        if not data:
            raise HTTPException(404, f"未找到「{code}」基本资料")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"基本资料异常：{e}") from e


@router.get("/api/indices")
def indices():
    """A股/港股对照指数实时行情。仅标准库。缓存 60 秒（warmup 会预热）。"""
    try:
        return {"data": _cached("indices", "live", 60, astock.index_quote)}
    except Exception as e:
        raise HTTPException(502, f"指数行情异常：{e}") from e


@router.get("/api/quote")
def quote(codes: str = Query(..., description="逗号分隔的 6 位代码")):
    """实时行情：现价/涨跌/PE/PB/市值/换手/涨跌停。仅标准库，永远可用。"""
    lst = [c.strip() for c in codes.split(",") if c.strip()]
    if not lst or any(not c.isdigit() or len(c) != 6 for c in lst):
        raise HTTPException(400, "codes 必须是逗号分隔的 6 位数字")
    try:
        return {"data": astock.tencent_quote(lst)}
    except Exception as e:
        raise HTTPException(502, f"行情源异常：{e}") from e


@router.get("/api/valuation/percentile")
def valuation_percentile(code: str = Query(...)):
    """PE-TTM / PB 历史分位（近5年）。全站缓存 30 分钟/代码（历史序列日频、变化慢）。"""
    code = _validate(code)
    try:
        data = _PCT_CACHE.get_or_set(
            code, lambda: astock.valuation_percentile(code), ttl=1800
        )
        return {"data": data}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"估值分位异常：{e}") from e


@router.get("/api/announcements")
def announcements(code: str = Query(...)):
    """个股近期公告（东财，仅 requests）。缓存 15 分钟/代码。"""
    code = _validate(code)
    try:
        data = _ANN_CACHE.get_or_set(code, lambda: astock.announcements(code), ttl=900)
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"公告源异常：{e}") from e


@router.get("/api/financials")
def financials(code: str = Query(...)):
    """财务关键指标（同花顺财务摘要，最新报告期）。缓存 30 分钟/代码。"""
    code = _validate(code)
    try:
        data = _FIN_CACHE.get_or_set(code, lambda: astock.financials(code), ttl=1800)
        return {"data": data}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"财务摘要异常：{e}") from e


@router.get("/api/valuation")
def valuation(code: str = Query(...)):
    """完整估值：行情 + 一致预期 + 前向PE/PEG/消化年数。"""
    code = _validate(code)
    try:
        return {"data": astock.full_valuation(code)}
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"估值计算异常：{e}") from e


@router.get("/api/reports")
def reports(code: str = Query(...), pages: int = Query(2, ge=1, le=5)):
    """个股研报列表（东财，含 PDF 链接）。仅需 requests。"""
    code = _validate(code)
    try:
        rows = astock.eastmoney_reports(code, max_pages=pages)
        for r in rows:
            r["pdfUrl"] = (
                astock.pdf_url(r.get("infoCode", "")) if r.get("infoCode") else None
            )
        return {"data": rows}
    except Exception as e:
        raise HTTPException(502, f"研报源异常：{e}") from e


@router.get("/api/news")
def news(code: str = Query(...), limit: int = Query(20, ge=1, le=50)):
    """个股新闻（东财，需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.stock_news(code, limit=limit)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"新闻源异常：{e}") from e


@router.get("/api/info")
def info(code: str = Query(...)):
    """个股基本面：行业/股本/上市时间（需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.individual_info(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"基本面源异常：{e}") from e


@router.get("/api/disclosure")
def disclosure(code: str = Query(...)):
    """巨潮公告列表（需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.disclosure(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"公告源异常：{e}") from e


@router.get("/api/kline")
def kline(
    code: str = Query(...),
    category: int = Query(4),
    offset: int = Query(60, ge=1, le=800),
):
    """K线（需 mootdx）。category 4=日 5=周 6=月 11=60分钟。"""
    code = _validate(code)
    try:
        return {"data": astock.kline(code, category=category, offset=offset)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"K线源异常：{e}") from e


@router.get("/api/astock/light-kline")
def astock_light_kline(
    code: str = Query(..., min_length=5, max_length=8, description="6位 / sh000001 / hkHSI"),
    resolution: str = Query("1D", description="1=分时 / 5=五日 / 1D=日K前复权"),
    num: int = Query(365, ge=20, le=1000),
):
    """轻量图（腾讯）：分时 / 5日 / 日K前复权。仅需标准库，不依赖 mootdx。缓存 60 秒。

    指数：sh000001 上证 / sz399006 创业板 / sh000688 科创50 / sh000852 中证1000 /
    hkHSI 恒生 / hkHSTECH 恒生科技。
    """
    code = _validate_symbol(code)
    res = resolution.strip()
    if res not in ("1", "5", "1D"):
        raise HTTPException(400, "resolution 仅支持 1 / 5 / 1D")
    try:
        # Minute charts refresh often via warmup; 120s TTL covers open-session interval.
        ttl = 120 if res == "1" else 60
        data = _cached(
            f"ashare_light:{res}:{num}",
            code,
            ttl,
            lambda: astock.light_kline(code, res, num=num),
        )
        if not data:
            raise HTTPException(404, f"未取到「{code}」的 K 线")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"A股轻量K线异常：{e}") from e


@router.get("/api/finance")
def finance(code: str = Query(...)):
    """季报财务快照（需 mootdx）。"""
    code = _validate(code)
    try:
        return {"data": astock.finance(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"财务源异常：{e}") from e


@router.get("/api/margin")
def margin(code: str = Query(...)):
    """融资融券明细（东财，日级）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {
            "data": _cached("margin", code, 1800, lambda: astock.margin_trading(code))
        }
    except Exception as e:
        raise HTTPException(502, f"融资融券异常：{e}") from e


@router.get("/api/block-trade")
def block_trade(code: str = Query(...)):
    """大宗交易（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("block", code, 1800, lambda: astock.block_trade(code))}
    except Exception as e:
        raise HTTPException(502, f"大宗交易异常：{e}") from e


@router.get("/api/holders")
def holders(code: str = Query(...)):
    """股东户数变化（东财，季度级）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {
            "data": _cached(
                "holders", code, 1800, lambda: astock.holder_num_change(code)
            )
        }
    except Exception as e:
        raise HTTPException(502, f"股东户数异常：{e}") from e


@router.get("/api/dividend")
def dividend(code: str = Query(...)):
    """分红送转历史（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {
            "data": _cached(
                "dividend", code, 1800, lambda: astock.dividend_history(code)
            )
        }
    except Exception as e:
        raise HTTPException(502, f"分红送转异常：{e}") from e


@router.get("/api/fund-flow")
def fund_flow(code: str = Query(...)):
    """个股资金流（东财 push2his，120 日主力净流入）。缓存 15 分钟。
    注：push2his 对部分大陆住宅 IP 有间歇风控，可能返回空（非代码问题）。"""
    code = _validate(code)
    try:
        return {
            "data": _cached(
                "fundflow", code, 900, lambda: astock.stock_fund_flow_120d(code)
            )
        }
    except Exception as e:
        raise HTTPException(502, f"资金流异常：{e}") from e


@router.get("/api/fund-flow/minute")
def fund_flow_minute(code: str = Query(...)):
    """个股当日分钟级主力/大小单净流入（东财 push2）。缓存 60 秒。单位元。"""
    code = _validate(code)
    try:
        rows = _cached(
            "fundflow_min",
            code,
            60,
            lambda: astock.eastmoney_fund_flow_minute(code),
        )
        last = rows[-1] if rows else None
        day_main = round(sum(float(r.get("main_net") or 0) for r in rows), 2) if rows else 0.0
        return {
            "data": {
                "code": code,
                "count": len(rows),
                "day_main_net": day_main,
                "latest": last,
                "rows": rows,
            }
        }
    except Exception as e:
        raise HTTPException(502, f"分钟资金流异常：{e}") from e


@router.get("/api/shareholder-changes")
def shareholder_changes(
    code: str | None = Query(None, description="6 位代码; 空=全市场"),
    change_type: str = Query("all", description="all|增持|减持"),
    limit: int = Query(40, ge=5, le=100),
):
    """股东/高管增减持（东财）。可按个股或全市场。缓存 10 分钟。"""
    c = (code or "").strip()
    if c:
        c = _validate(c)
    ct = change_type if change_type in ("all", "增持", "减持") else "all"
    try:
        rows = _cached(
            "sh_chg",
            f"{c or 'ALL'}:{ct}:{limit}",
            600,
            lambda: astock.shareholder_changes(c, ct, limit),
        )
        return {
            "data": {
                "code": c or None,
                "change_type": ct,
                "total": len(rows),
                "note": "客观公开披露 · 非推荐",
                "rows": rows,
            }
        }
    except Exception as e:
        raise HTTPException(502, f"增减持异常：{e}") from e


@router.get("/api/dragon-tiger")
def dragon_tiger(code: str = Query(...)):
    """龙虎榜：该股近期上榜记录 + 买卖席位 + 机构净买（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {
            "data": _cached("dt", code, 1800, lambda: astock.dragon_tiger_board(code))
        }
    except Exception as e:
        raise HTTPException(502, f"龙虎榜异常：{e}") from e


@router.get("/api/dragon-tiger/daily")
def dragon_tiger_daily(
    date: str | None = Query(None, description="YYYY-MM-DD；默认最近有数据交易日"),
    top: int = Query(40, ge=10, le=200),
    min_net_buy: float | None = Query(None, description="净买入下限(万元)，可选"),
):
    """全市场龙虎榜（东财公开榜单）。缓存 10 分钟。客观呈现，不附推荐。"""
    try:
        key = f"{date or 'auto'}:{top}:{min_net_buy if min_net_buy is not None else 'all'}"
        data = _cached(
            "dt_daily",
            key,
            600,
            lambda: astock.daily_dragon_tiger(date, min_net_buy, top=top),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"全市场龙虎榜异常：{e}") from e


@router.get("/api/lockup")
def lockup(code: str = Query(...)):
    """限售解禁日历：历史解禁 + 未来 90 天待解禁（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {
            "data": _cached("lockup", code, 1800, lambda: astock.lockup_expiry(code))
        }
    except Exception as e:
        raise HTTPException(502, f"解禁日历异常：{e}") from e


@router.get("/api/blocks")
def blocks(code: str = Query(...)):
    """个股所属板块/概念归属（东财 slist）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {
            "data": _cached("blocks", code, 1800, lambda: astock.concept_blocks(code))
        }
    except Exception as e:
        raise HTTPException(502, f"板块归属异常：{e}") from e


@router.get("/api/hot-concepts")
def hot_concepts(code: str = Query(...)):
    """个股当下被市场归到哪些概念在炒（东财热门概念命中）。缓存 15 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("hotcon", code, 900, lambda: astock.hot_concepts(code))}
    except Exception as e:
        raise HTTPException(502, f"热门概念异常：{e}") from e


@router.get("/api/investor-qa")
def investor_qa(code: str = Query(...)):
    """互动易问答（巨潮）：投资者提问 + 公司回复。缓存 15 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("irm", code, 900, lambda: astock.investor_qa(code))}
    except Exception as e:
        raise HTTPException(502, f"互动易异常：{e}") from e


@router.get("/api/industry")
def industry(top: int = Query(20, ge=5, le=50)):
    """全行业涨跌幅排名（东财行业板块，板块级、零个股名单）。缓存 5 分钟。"""
    try:
        data = _cached(
            "industry",
            str(top),
            300,
            lambda: astock.industry_comparison(top_n=top),
            valid=lambda d: bool(isinstance(d, dict) and d.get("top")),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"行业排名异常：{e}") from e
