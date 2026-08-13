from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

import astock
import market
import newsradar
import review_snapshot
import review_warmup
from api_common import _cached

router = APIRouter(tags=["market"])

@router.get("/api/radar")
def radar():
    """资讯雷达：12 赛道公开 RSS 资讯（读缓存，无缓存返回赛道骨架）。"""
    try:
        return {"data": newsradar.get_radar(force=False)}
    except Exception as e:
        raise HTTPException(502, f"资讯雷达异常：{e}") from e


@router.post("/api/radar/refresh")
def radar_refresh():
    """强制重抓全部 RSS 源（耗时约 20-40s），更新缓存。"""
    try:
        return {"data": newsradar.fetch_radar()}
    except Exception as e:
        raise HTTPException(502, f"资讯雷达刷新失败：{e}") from e


@router.get("/api/market/overview")
def market_overview():
    """市场情绪 + 板块资金流（板块/大盘级，全站共享缓存 5 分钟）。"""
    try:
        return {"data": market.get_overview()}
    except Exception as e:
        raise HTTPException(502, f"市场总览异常：{e}") from e


@router.get("/api/market/emotion")
def market_emotion():
    """短线情绪：连板梯队 / 最高连板 / 炸板率 / 封板率 / 晋级率 / 涨跌停家数。

    含连板梯队个股清单（code/name/连板数等）——2026-07-05 起如实展示客观公开榜单（东财同款），
    只呈现事实，不附推荐/评分/预测/买卖时机。全站共享缓存 5 分钟。
    """
    try:
        return {"data": market.get_short_term_emotion()}
    except Exception as e:
        raise HTTPException(502, f"短线情绪异常：{e}") from e


@router.get("/api/market/turnover-top")
def market_turnover_top():
    """全市场成交额榜 Top20（客观公开榜单数据，非推荐/非预测/不评分）。全站共享缓存 5 分钟。"""
    try:
        return {"data": market.get_turnover_top()}
    except Exception as e:
        raise HTTPException(502, f"成交额榜异常：{e}") from e


@router.get("/api/market/review-warmup")
def market_review_warmup_status():
    """复盘缓存预热状态（后台 daemon；可用 VR_REVIEW_WARMUP=0 关闭）。"""
    return {"data": review_warmup.status()}


@router.get("/api/market/review-snapshot")
def market_review_snapshot(
    scope: str = Query("full", description="top|full"),
    board_type: str = Query("industry", description="industry|concept|region"),
    period: str = Query("today", description="today|5d|10d"),
    limit_kind: str = Query("zt", description="zt|zb|dt|yzt|jm"),
):
    """每日复盘首屏聚合。读同一套 TTL 缓存, 避免前端 10+ 请求撞东财串行锁。"""
    sc = (scope or "full").strip().lower()
    if sc not in ("top", "full"):
        raise HTTPException(400, "scope 须为 top 或 full")
    try:
        return {
            "data": review_snapshot.build_review_snapshot(
                scope=sc,
                board_type=board_type,
                board_period=period,
                limit_kind=limit_kind,
            )
        }
    except Exception as e:
        raise HTTPException(502, f"复盘快照异常：{e}") from e


@router.get("/api/market/board-flow")
def market_board_flow(
    board_type: str = Query("industry", description="industry|concept|region"),
    period: str = Query("today", description="today|5d|10d"),
    top: int = Query(20, ge=5, le=50),
):
    """板块资金流向（东财 clist）。客观公开榜单。缓存 3 分钟。"""
    import astock_boards
    try:
        key = f"{board_type}:{period}:{top}"
        data = _cached(
            "board_flow",
            key,
            180,
            lambda: astock_boards.board_fund_flow(board_type, period, top),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"板块资金流异常：{e}") from e


@router.get("/api/market/hsgt")
def market_hsgt():
    """北向资金分钟流向（同花顺；深股通仅供参考）。缓存 2 分钟。"""
    import astock_boards
    try:
        data = _cached("hsgt", "live", 120, astock_boards.hsgt_realtime)
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"北向资金异常：{e}") from e


@router.get("/api/market/hot-list")
def market_hot_list(
    source: str = Query("ths", description="ths|em"),
    period: str = Query("hour", description="ths: hour|day"),
    top: int = Query(30, ge=5, le=50),
):
    """同花顺热榜 / 东财人气榜。客观公开榜单。缓存 3 分钟。"""
    import astock_boards
    try:
        if source == "em":
            data = _cached("hot_em", str(top), 180, lambda: astock_boards.em_hot_rank(top))
        else:
            data = _cached(
                "hot_ths",
                f"{period}:{top}",
                180,
                lambda: astock_boards.ths_hot_list(period, top),
            )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"热榜异常：{e}") from e


@router.get("/api/market/stock-monitor")
def market_stock_monitor():
    """交易所重点监控池。缓存 10 分钟。"""
    import astock_boards
    try:
        data = _cached("monitor", "active", 600, lambda: astock_boards.em_stock_monitor(True))
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"重点监控池异常：{e}") from e


@router.get("/api/market/price-anomaly")
def market_price_anomaly(top: int = Query(60, ge=10, le=200)):
    """日内严重异常波动。缓存 5 分钟。"""
    import astock_boards
    try:
        data = _cached(
            "anomaly",
            str(top),
            300,
            lambda: astock_boards.em_price_anomaly(top),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"日内异动异常：{e}") from e


@router.get("/api/market/limit-pools")
def market_limit_pools(
    pool: str = Query("zt", description="zt|zb|dt|yzt"),
    top: int = Query(40, ge=5, le=100),
):
    """打板池明细（涨停/炸板/跌停/昨涨停）。客观公开榜单。缓存 3 分钟。"""
    import astock_boards
    try:
        data = _cached(
            "limit_pool",
            f"{pool}:{top}",
            180,
            lambda: astock_boards.limit_up_pools(pool, top=top),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"打板池异常：{e}") from e


@router.get("/api/market/ths-limit-up")
def market_ths_limit_up(
    date: str | None = Query(None, description="YYYYMMDD 或 YYYY-MM-DD"),
):
    """同花顺涨停揭秘（原因题材/板型/封板率）。客观公开榜单。缓存 3 分钟。"""
    try:
        key = (date or "").strip() or "today"
        data = _cached(
            "ths_limit_up",
            key,
            180,
            lambda: astock.ths_limit_up_pool(date),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"同花顺涨停揭秘异常：{e}") from e


@router.get("/api/iwencai/status")
def iwencai_status():
    """iwencai 是否已配置 API key（不暴露 key）。"""
    return {"data": {"configured": astock.iwencai_configured()}}


@router.get("/api/iwencai/search")
def iwencai_search(
    q: str = Query(..., min_length=1, max_length=120),
    channel: str = Query("report", description="report|announcement|news"),
    size: int = Query(20, ge=5, le=50),
):
    """iwencai NL 语义搜索（需 IWENCAI_API_KEY）。客观结果，不附推荐。"""
    try:
        return {"data": astock.iwencai_search(q, channel=channel, size=size)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"iwencai 搜索异常：{e}") from e


@router.get("/api/cls-telegraph")
def cls_telegraph(limit: int = Query(50, ge=10, le=100)):
    """财联社电报（全市场实时快讯，零 key）。缓存 60 秒。客观呈现，不附推荐。"""
    try:
        data = _cached(
            "cls_tg",
            str(limit),
            60,
            lambda: astock.cls_telegraph(limit),
        )
        if not data:
            raise HTTPException(404, "财联社电报暂无数据")
        return {"data": {"source": "财联社", "count": len(data), "items": data}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"财联社电报异常：{e}") from e


@router.get("/api/global-news")
def global_news(limit: int = Query(50, ge=10, le=100)):
    """东财全球财经资讯 7x24。缓存 60 秒。客观呈现，不附推荐。"""
    try:
        data = _cached(
            "em_global_news",
            str(limit),
            60,
            lambda: astock.eastmoney_global_news(limit),
        )
        if not data:
            raise HTTPException(404, "东财全球资讯暂无数据")
        return {"data": {"source": "东财7x24", "count": len(data), "items": data}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"东财全球资讯异常：{e}") from e


@router.get("/api/market/etf-flow")
def market_etf_flow(
    sort_by: str = Query("net_inflow", description="net_inflow|change_pct"),
    limit: int = Query(40, ge=5, le=100),
):
    """ETF 资金流向排行（东财）。金额单位亿元。客观公开榜单。缓存 3 分钟。"""
    sb = sort_by if sort_by in ("net_inflow", "change_pct") else "net_inflow"
    try:
        rows = _cached(
            "etf_flow",
            f"{sb}:{limit}",
            180,
            lambda: astock.etf_fund_flow(sb, limit),
        )
        return {
            "data": {
                "sort_by": sb,
                "total": len(rows),
                "note": "客观公开榜单 · 东财 ETF 资金流 · 非推荐",
                "rows": rows,
            }
        }
    except Exception as e:
        raise HTTPException(502, f"ETF 资金流异常：{e}") from e


@router.get("/api/market/lpr")
def market_lpr(days: int = Query(365, ge=30, le=2000)):
    """LPR 贷款市场报价利率（全国银行间同业拆借中心）。缓存 1 小时。"""
    try:
        rows = _cached("lpr", str(days), 3600, lambda: astock.lpr_rates(days))
        latest = rows[0] if rows else None
        return {
            "data": {
                "latest": latest,
                "total": len(rows),
                "source": "chinamoney.com.cn",
                "note": "客观利率报价 · 非预测",
                "rows": rows,
            }
        }
    except Exception as e:
        raise HTTPException(502, f"LPR 异常：{e}") from e


@router.get("/api/market/bond-yield")
def market_bond_yield(
    curve_type: str = Query("treasury", description="treasury|policy"),
):
    """中债国债/政策性金融债收益率曲线。缓存 1 小时。"""
    ct = curve_type if curve_type in ("treasury", "policy") else "treasury"
    try:
        data = _cached(
            "cn_bond_yield",
            ct,
            3600,
            lambda: astock.bond_yield_curve(ct),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"国债收益率异常：{e}") from e
