from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

import astock
import market
import newsradar
import review_snapshot
import review_warmup
from api_common import _cached, _DC_CACHE

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
    scope: str = Query("full", description="paint|top|full"),
    board_type: str = Query("industry", description="industry|concept|region"),
    period: str = Query("today", description="today|5d|10d"),
    limit_kind: str = Query("zt", description="zt|zb|dt|yzt|jm"),
):
    """每日复盘首屏聚合。读同一套 TTL 缓存, 避免前端 10+ 请求撞东财串行锁。"""
    sc = (scope or "full").strip().lower()
    if sc not in ("paint", "top", "full"):
        raise HTTPException(400, "scope 须为 paint / top / full")
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


def _parse_flow_codes(codes: str, cap: int = 40) -> list[str]:
    raw: list[str] = []
    seen: set[str] = set()
    for part in codes.split(","):
        k = part.strip()
        if len(k) >= 8 and k[:2].isalpha():
            k = k[2:]
        if not (k.isdigit() and len(k) == 6) or k in seen:
            continue
        seen.add(k)
        raw.append(k)
        if len(raw) >= cap:
            break
    return raw


def _flow_cached(raw: list[str]) -> dict[str, dict]:
    import cockpit_live
    out: dict[str, dict] = {}
    miss: list[str] = []
    for c in raw:
        key = ("stock_flow_ulist", c)
        if key in _DC_CACHE:
            out[c] = _DC_CACHE.get(key)
        else:
            miss.append(c)
    if miss:
        fetched = cockpit_live.stock_flow_map(miss)
        for c in miss:
            val = fetched.get(c) or {"main_net": None, "main_pct": None, "netIn": None, "netRatio": None}
            _DC_CACHE.set(("stock_flow_ulist", c), val, ttl=30)
            out[c] = val
    return out


@router.get("/api/market/stock-flows")
def market_stock_flows(codes: str = Query(..., min_length=6, max_length=400)):
    """Quote-row fund flow. Same as marketingdashboard /api/stock-flows: ulist, 30s, max 40."""
    raw = _parse_flow_codes(codes)
    if not raw:
        raise HTTPException(400, "codes 须为逗号分隔的 6 位 A 股代码")
    try:
        cached = _flow_cached(raw)
    except Exception as e:
        raise HTTPException(502, f"自选资金流异常: {e}") from e
    rows = []
    for c in raw:
        rec = cached.get(c) or {}
        if rec.get("netIn") is None and rec.get("main_net") is None:
            continue
        net = rec.get("netIn") if rec.get("netIn") is not None else rec.get("main_net")
        ratio = rec.get("netRatio") if rec.get("netRatio") is not None else rec.get("main_pct")
        rows.append({"code": c, "netIn": net, "netRatio": ratio})
    return {"data": rows}


@router.get("/api/market/stock-flow-batch")
def market_stock_flow_batch(codes: str = Query(..., min_length=6, max_length=400)):
    """Map form of stock-flows (code -> main_net / main_pct)."""
    raw = _parse_flow_codes(codes)
    if not raw:
        raise HTTPException(400, "codes 须为逗号分隔的 6 位 A 股代码")
    try:
        return {"data": _flow_cached(raw)}
    except Exception as e:
        raise HTTPException(502, f"自选资金流异常: {e}") from e


@router.get("/api/market/stock-flow")
def market_stock_flow(
    top: int = Query(15, ge=5, le=40),
    board: str | None = Query(None, description="BK#### industry/concept board"),
):
    """个股主力净流入排行(东财 clist). 可按板块成分过滤. 缓存 2 分钟."""
    import astock_boards
    try:
        key = f"{(board or 'all').strip().upper()}:{top}"
        data = _cached(
            "stock_flow",
            key,
            120,
            lambda: astock_boards.stock_moneyflow(top, board),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"个股资金流异常：{e}") from e


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
    period: str = Query("hour", description="hour|day"),
    top: int = Query(30, ge=5, le=50),
):
    """同花顺热榜。客观公开榜单。缓存 3 分钟。"""
    import astock_boards
    try:
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


@router.get("/api/market/breadth")
def market_breadth():
    """Full A-share change-pct percentiles + 8-band histogram. Cache 3 min."""
    import cross_section
    try:
        return {"data": cross_section.market_breadth()}
    except Exception as e:
        raise HTTPException(502, f"涨跌幅分位异常：{e}") from e


@router.get("/api/market/ths-profile")
def market_ths_profile(code: str = Query(..., description="6-digit A-share code")):
    """shy313 Tonghuashun industry path + concepts for one stock."""
    import ths_ext
    c = (code or "").strip()
    if not c.isdigit() or len(c) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    try:
        return {"data": ths_ext.profile(c)}
    except Exception as e:
        raise HTTPException(502, f"同花顺归属异常：{e}") from e


@router.get("/api/market/ths-rotation")
def market_ths_rotation(
    kind: str = Query("concept", description="concept|industry"),
    top: int = Query(15, ge=5, le=40),
):
    """THS concept/industry today avg change-pct (shy313 members x Eastmoney clist)."""
    import ths_ext
    k = (kind or "concept").strip().lower()
    if k not in ("concept", "industry"):
        raise HTTPException(400, "kind 须为 concept 或 industry")
    try:
        return {"data": ths_ext.rotation(k, top)}
    except Exception as e:
        raise HTTPException(502, f"同花顺轮动异常：{e}") from e


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


@router.get("/api/iwencai/select")
def iwencai_select(
    q: str = Query(..., min_length=1, max_length=80),
    limit: int = Query(12, ge=1, le=30),
):
    """iwencai 选股 (/v1/query2data)。客观名单, 不附推荐。需 IWENCAI_API_KEY。"""
    try:
        return {"data": astock.iwencai_select(q, limit=limit)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        msg = str(e)
        status = 429 if "次数已用完" in msg else 502
        raise HTTPException(status, f"iwencai 选股异常：{e}") from e


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


@router.get("/api/market/quotes")
def market_quotes(
    codes: str = Query(..., min_length=3, description="comma-separated sh600519,usIXIC,whUSDCNY"),
):
    """Cockpit quote hub. Tencent equities/indices only (per-code 5s cache). Futures use /commodities."""
    import cockpit_live
    raw = [c.strip() for c in codes.split(",") if c.strip()][:80]
    if not raw:
        raise HTTPException(400, "codes 不能为空")
    try:
        return {"data": cockpit_live.quotes_cached(raw)}
    except Exception as e:
        raise HTTPException(502, f"行情批量异常：{e}") from e


@router.get("/api/market/world-indices")
def market_world_indices():
    """全球关键指数 (A/HK/US/FX). 缓存 20 秒."""
    import cockpit_live
    try:
        data = _cached("world_indices", "live", 20, cockpit_live.world_indices)
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"全球指数异常：{e}") from e


@router.get("/api/market/boards")
def market_boards(
    kind: str = Query("01", description="01 industry / 02 concept"),
    direction: str = Query("0", description="0 down(leaders) / 1 up(laggards)"),
    n: int = Query(40, ge=5, le=200),
):
    """市场板块实时热点. 缓存 20 秒."""
    import cockpit_live
    k = "02" if kind == "02" else "01"
    d = "1" if direction == "1" else "0"
    try:
        data = _cached(
            "sector_boards",
            f"{k}:{d}:{n}",
            20,
            lambda: cockpit_live.sector_boards(k, d, n),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"板块热点异常：{e}") from e


@router.get("/api/market/board-stocks")
def market_board_stocks(
    code: str = Query(..., description="Tencent pt* or BK####"),
    n: int = Query(12, ge=5, le=80),
):
    """板块成分股. 腾讯 pt* 优先, 东财 BK 兜底. 缓存 20 秒."""
    import cockpit_live
    raw = (code or "").strip()
    try:
        data = _cached(
            "board_stocks",
            f"{raw}:{n}",
            20,
            lambda: cockpit_live.board_stocks(raw, n),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"板块成分异常：{e}") from e


@router.get("/api/market/rank")
def market_rank(
    sort: str = Query("amount", description="amount|changepercent"),
    asc: int = Query(0, ge=0, le=1),
    n: int = Query(30, ge=5, le=50),
):
    """个股榜单 (成交额/涨跌幅), 含成交额. 缓存 20 秒."""
    import cockpit_live
    key = sort if sort in ("amount", "changepercent", "turnoverratio") else "amount"
    try:
        data = _cached(
            "stock_rank",
            f"{key}:{asc}:{n}",
            20,
            lambda: cockpit_live.stock_rank(key, asc, n),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"个股榜单异常：{e}") from e


@router.get("/api/market/board-flow-intraday")
def market_board_flow_intraday(
    n: int = Query(16, ge=6, le=24),
    curves: bool = Query(True, description="false=only ranks (2 Eastmoney pages)"),
):
    """板块资金流向. curves=0 只回流入/流出榜; curves=1 再补分钟曲线. 分键缓存."""
    import cockpit_live
    try:
        if curves:
            data = _cached(
                "board_flow_intraday",
                str(n),
                120,
                lambda: cockpit_live.board_flow_intraday(n, curves=True),
            )
        else:
            data = _cached(
                "board_flow_ranks",
                str(n),
                60,
                lambda: cockpit_live.board_flow_intraday(n, curves=False),
                valid=lambda d: isinstance(d, list) and len(d) > 0,
            )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"板块分钟资金流异常：{e}") from e


@router.get("/api/market/commodities")
def market_commodities(
    codes: str = Query("", description="hf_GC,nf_AU0,BTCUSDT"),
):
    """大宗商品快照. 缓存 20 秒."""
    import cockpit_live
    raw = (codes or "").strip() or cockpit_live.DEFAULT_FUTURES
    try:
        data = _cached(
            "commodities",
            raw,
            20,
            lambda: cockpit_live.futures_quotes(raw),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"大宗商品异常：{e}") from e


@router.get("/api/market/commodity-minutes")
def market_commodity_minutes(
    codes: str = Query("", description="comma-separated hf_/nf_/BTCUSDT"),
):
    """大宗商品分钟线. 缓存 60 秒."""
    import cockpit_live
    raw = (codes or "").strip() or cockpit_live.DEFAULT_FUTURES
    try:
        data = _cached(
            "commodity_minutes",
            raw,
            60,
            lambda: cockpit_live.future_minutes([c.strip() for c in raw.split(",") if c.strip()]),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"商品分钟线异常：{e}") from e


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


@router.get("/api/market/spot-table")
def market_spot_table():
    """生意社现货/期货基差对照表. 缓存 8 小时."""
    import sunsirs
    try:
        data = _cached("spot_table", "sf", 8 * 3600, sunsirs.spot_table)
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"生意社现期表异常：{e}") from e


@router.get("/api/market/chem-spot")
def market_chem_spot(
    cid: str = Query(..., min_length=1, max_length=10, alias="id"),
    name: str = Query("", max_length=40),
):
    """生意社化工现货中位数. 缓存 8 小时."""
    import sunsirs
    try:
        data = _cached(
            "chem_spot",
            f"{cid}:{name}",
            8 * 3600,
            lambda: sunsirs.chem_spot(cid, name),
        )
        return {"data": data}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"生意社化工现货异常：{e}") from e


@router.get("/api/market/future-daily")
def market_future_daily(
    code: str = Query(..., min_length=4, max_length=16),
    n: int = Query(400, ge=20, le=2000),
):
    """新浪期货日 K (hf_ 外盘 / nf_ 内盘). 缓存 1 小时."""
    import cockpit_live
    try:
        data = _cached(
            "future_daily",
            f"{code}:{n}",
            3600,
            lambda: cockpit_live.future_daily(code, n),
        )
        return {"data": data}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"期货日K异常：{e}") from e


@router.get("/api/market/stock-boards")
def market_stock_boards(code: str = Query(..., min_length=6, max_length=8)):
    """个股所属行业/地域/概念 (东财 f127/f128/f129). 缓存 24 小时."""
    import cockpit_live
    try:
        data = _cached(
            "stock_boards",
            code.strip().lower(),
            24 * 3600,
            lambda: cockpit_live.stock_boards(code),
        )
        return {"data": data}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"个股板块异常：{e}") from e


@router.get("/api/market/stock-boards-batch")
def market_stock_boards_batch(codes: str = Query(..., min_length=6, max_length=200)):
    """批量个股行业/概念, 最多 12 只. 与单票接口共用 24h 缓存."""
    import cockpit_live
    raw: list[str] = []
    seen: set[str] = set()
    for part in codes.split(","):
        k = part.strip()
        if not k or k in seen:
            continue
        seen.add(k)
        raw.append(k)
        if len(raw) >= 12:
            break
    def _one(c: str) -> dict:
        return _cached(
            "stock_boards",
            c.lower(),
            24 * 3600,
            lambda: cockpit_live.stock_boards(c),
        )

    return {"data": cockpit_live.stock_boards_map(raw, fetch=_one)}


@router.get("/api/market/lives")
def market_lives(
    page: int = Query(1, ge=1, le=20),
    size: int = Query(40, ge=10, le=50),
):
    """新浪7x24直播, 失败回退华尔街见闻快讯. 缓存 8 秒. 不进驾驶舱格子."""
    import lives_feed
    try:
        data = _cached(
            "market_lives",
            f"{page}:{size}",
            8,
            lambda: lives_feed.market_lives(page, size),
        )
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"直播快讯异常：{e}") from e
