"""Vibe-Research 后端 —— A股数据层 HTTP 接口（FastAPI）。

端点全部在 /api 下，前端 vite 代理 /api → localhost:8900。
只读、无状态、按用户传入代码返回客观数据。不预置标的、不建议。

启动：
    uvicorn app:app --host 127.0.0.1 --port 8900
"""

from __future__ import annotations

import json
import os
from pathlib import Path


def _load_dotenv(path: Path | None = None) -> None:
    """Load backend/.env into os.environ (no python-dotenv dependency).

    Existing process env wins. Lines: KEY=VALUE, optional quotes, # comments.
    """
    env_path = path or Path(__file__).with_name(".env")
    if not env_path.is_file():
        return
    try:
        text = env_path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if not key or key in os.environ:
            continue
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        os.environ[key] = val


_load_dotenv()

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

import astock
import chat as chat_layer
import cli_runtime
import gstock
import gstock_deep
import newsradar
import portfolio as pf
import ctp_account as ctp
import market
import myreports as mr
import ovlab
import fino
import reflection as reflect_layer
import weather as weather_layer

app = FastAPI(title="Vibe-Research API", version="0.2.2")

# 每半小时后台刷新持仓数据
pf.start_scheduler(1800)

# CORS：默认放开（本地自托管友好）；公网部署时用 VR_ALLOW_ORIGINS 收紧成白名单。
#   例：VR_ALLOW_ORIGINS="https://myhost"  （逗号分隔多个）
_ORIGINS = [
    o.strip() for o in os.environ.get("VR_ALLOW_ORIGINS", "*").split(",") if o.strip()
] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# 可选鉴权：设了 VR_API_KEY 就要求所有 /api/* 带 `Authorization: Bearer <key>`
#   （本地自托管不设=开放；公网部署务必设，否则别人能读你的持仓/调你的后端）。
_API_KEY = os.environ.get("VR_API_KEY", "").strip()


@app.middleware("http")
async def _require_api_key(request: Request, call_next):
    if (
        _API_KEY
        and request.method != "OPTIONS"
        and request.url.path.startswith("/api/")
        and request.url.path != "/api/health"
    ):
        if request.headers.get("authorization", "") != f"Bearer {_API_KEY}":
            return JSONResponse(
                {"detail": "未授权：缺少或错误的 API Key（VR_API_KEY）"},
                status_code=401,
            )
    return await call_next(request)


_CODE_RE = r"^\d{6}$"


def _validate(code: str) -> str:
    code = (code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    return code


@app.get("/api/health")
def health():
    return {"ok": True, "service": "vibe-research-api", "version": "0.2.2"}


@app.get("/api/weather")
def weather(
    city: str = Query("上海", description="城市名 / 机场代码, 如 上海 / Shanghai / JFK"),
    days: int = Query(7, ge=1, le=16, description="预报天数, 1-16, 默认 7"),
):
    """Current weather + multi-day forecast. Open-Meteo primary (up to 16d), wttr enrich. No API key."""
    try:
        return {"data": weather_layer.get_weather(city, days=days)}
    except Exception as e:
        raise HTTPException(502, f"天气查询失败: {e}") from e


class LLMConfig(BaseModel):
    provider: str = ""  # cli-* = 订阅接入（调本机 CLI）；其余 = API 接入
    baseURL: str = ""  # 订阅接入时留空
    apiKey: str = ""  # 订阅接入时留空
    model: str


class ChatReq(BaseModel):
    messages: list[dict]
    context: str = ""
    llm: LLMConfig


@app.post("/api/chat")
def chat(req: ChatReq):
    """系统 AI 对话，**流式** NDJSON（每行一个事件 {type: tool|delta|done|error}）。

    - API 接入：OpenAI 兼容 function-calling，边流答案边推工具调用事件。
    - 订阅接入（provider=cli-*）：调本机已登录的 CLI，stdout 边出边流（数据靠 context）。
    配置错误（缺 key / 未装 CLI）走 HTTP 400；运行时错误走流内 error 事件。用户配置随请求传入，后端不持久化。
    """
    if not req.messages:
        raise HTTPException(400, "messages 不能为空")
    if not req.llm.model:
        raise HTTPException(400, "缺少模型配置，请先在「接入 AI」里选择")

    is_cli = req.llm.provider.startswith("cli-")
    if is_cli:
        kind = req.llm.provider[4:]
        if not cli_runtime.detect_cli(kind):
            raise HTTPException(
                400,
                f"未检测到「{kind}」对应的本机命令。请先安装并登录该 CLI，或改用「API 接入」。",
            )
    elif not req.llm.apiKey or not req.llm.baseURL:
        raise HTTPException(400, "缺少 Base URL 或 API Key，请先在「接入 AI」里填写")

    cfg = req.llm.model_dump()

    def gen():
        try:
            events = (
                chat_layer.run_chat_cli_stream if is_cli else chat_layer.run_chat_stream
            )(cfg, req.messages, req.context)
            for ev in events:
                yield json.dumps(ev, ensure_ascii=False) + "\n"
        except Exception as e:
            yield (
                json.dumps(
                    {"type": "error", "message": f"对话失败：{e}"}, ensure_ascii=False
                )
                + "\n"
            )

    return StreamingResponse(gen(), media_type="application/x-ndjson")


def _check_llm(llm: LLMConfig) -> dict:
    """校验模型配置并返回 cfg（chat / reflect 流式端点共用）。

    配置问题走 HTTP 400（前端能弹提示引导去「接入 AI」页），运行时错误留给流内 error 事件。
    """
    if not llm.model:
        raise HTTPException(400, "缺少模型配置，请先在「接入 AI」里选择")
    if llm.provider.startswith("cli-"):
        kind = llm.provider[4:]
        if not cli_runtime.detect_cli(kind):
            raise HTTPException(
                400,
                f"未检测到「{kind}」对应的本机命令。请先安装并登录该 CLI，或改用「API 接入」。",
            )
    elif not llm.apiKey or not llm.baseURL:
        raise HTTPException(400, "缺少 Base URL 或 API Key，请先在「接入 AI」里填写")
    return llm.model_dump()


def _ndjson(events):
    """把事件生成器包成 NDJSON 流；运行时异常转成流内 error 事件，不中断连接。"""

    def gen():
        try:
            for ev in events():
                yield json.dumps(ev, ensure_ascii=False) + "\n"
        except Exception as e:
            yield (
                json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False)
                + "\n"
            )

    return StreamingResponse(gen(), media_type="application/x-ndjson")


class ReflectReq(BaseModel):
    source: str
    title: str = ""
    llm: LLMConfig


@app.post("/api/reflect")
def reflect(req: ReflectReq):
    """反思：对一段已写好的分析做推理审计（哪些有数据支撑、最脆弱一环、验证清单），流式 NDJSON。"""
    if not (req.source or "").strip():
        raise HTTPException(400, "source 不能为空")
    cfg = _check_llm(req.llm)
    return _ndjson(
        lambda: reflect_layer.run_reflection_stream(cfg, req.source, req.title)
    )


class HoldingIn(BaseModel):
    code: str
    shares: float
    cost: float


@app.get("/api/portfolio")
def portfolio_get():
    """持仓 + 实时盈亏（浮动盈亏红涨绿跌）。"""
    try:
        return {"data": pf.get_portfolio()}
    except Exception as e:
        raise HTTPException(502, f"持仓读取异常：{e}") from e


@app.post("/api/portfolio/holding")
def portfolio_add(h: HoldingIn):
    """加一笔持仓（同代码按加权平均成本合并）。存本地，不上传。"""
    code = (h.code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    if h.shares <= 0:
        raise HTTPException(400, "数量必须大于 0")
    # 成本价不限正负：融券 / 返息 / 摊薄后为负成本等情形按结果计算，用户想怎么输就怎么输。
    return {"data": pf.add_holding(code, h.shares, h.cost)}


@app.delete("/api/portfolio/holding")
def portfolio_remove(code: str = Query(...)):
    return {"data": pf.remove_holding(code.strip())}


# ---- 我的研报（用户上传自己的研报，存本地、不上传、不进开源仓库）----


class ReportIn(BaseModel):
    name: str
    content_b64: str


@app.get("/api/myreports")
def myreports_list():
    return {"data": mr.list_reports()}


@app.post("/api/myreports")
def myreports_upload(r: ReportIn):
    """上传一份研报（base64）→ 存本地 + 按文件名自动打行业标签。"""
    try:
        return {"data": mr.save_report(r.name, r.content_b64)}
    except mr.ReportError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/myreports/file/{rid}")
def myreports_file(rid: str):
    """下载/预览某份研报原文件。"""
    hit = mr.report_path(rid)
    if not hit:
        raise HTTPException(404, "研报不存在")
    path, name = hit
    return FileResponse(str(path), filename=name)


@app.delete("/api/myreports/{rid}")
def myreports_delete(rid: str):
    return {"data": {"ok": mr.delete_report(rid)}}


class CloseIn(BaseModel):
    code: str
    date: str
    price: float
    shares: float
    cost: float


@app.post("/api/portfolio/close")
def portfolio_close(c: CloseIn):
    """记一笔已清仓（已实现盈亏）。存本地。"""
    code = (c.code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    if c.price <= 0 or c.shares <= 0:
        raise HTTPException(400, "清仓价与股数必须大于 0")
    # 买入成本不限正负（同持仓录入）：按 (清仓价 - 成本) × 股数 的结果计算已实现盈亏。
    date = (c.date or "").strip()
    if not date:
        raise HTTPException(400, "请填清仓日期")
    from datetime import datetime

    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "清仓日期格式应为 YYYY-MM-DD") from None
    return {"data": pf.close_position(code, date, c.price, c.shares, c.cost)}


@app.delete("/api/portfolio/close")
def portfolio_close_remove(index: int = Query(...)):
    return {"data": pf.remove_closed(index)}


@app.post("/api/portfolio/refresh")
def portfolio_refresh():
    """手动刷新：立即重拉行情算盈亏。"""
    try:
        return {"data": pf.get_portfolio()}
    except Exception as e:
        raise HTTPException(502, f"刷新失败：{e}") from e


@app.get("/api/portfolio/ctp/status")
def portfolio_ctp_status():
    """CTP 配置 / 依赖 / 登录状态（不主动连前置）。"""
    return {"data": ctp.config_status()}


@app.get("/api/portfolio/ctp/logs")
def portfolio_ctp_logs(since: int = Query(0, ge=0)):
    """CTP 操作日志（供前端轮询）。"""
    return {"data": ctp.get_logs(since)}


@app.post("/api/portfolio/ctp/login")
def portfolio_ctp_login():
    """点击登录：连前置 + 认证 + 登录，保持会话（不下单）。"""
    try:
        return {"data": ctp.login()}
    except ctp.CtpError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"CTP 登录异常：{e}") from e


@app.post("/api/portfolio/ctp/logout")
def portfolio_ctp_logout():
    """退出登录，断开 CTP 会话。"""
    try:
        return {"data": ctp.logout()}
    except ctp.CtpError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"CTP 退出异常：{e}") from e


@app.get("/api/portfolio/ctp")
def portfolio_ctp():
    """CTP 只读查询资金 + 持仓（需已登录，不下单）。"""
    try:
        return {"data": ctp.fetch_portfolio()}
    except ctp.CtpError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"CTP 持仓查询异常：{e}") from e


@app.get("/api/portfolio/ctp/market-equity")
def portfolio_ctp_market_equity():
    """轮询后台市值权益任务(期权合约/行情流控, 不阻塞主查询)。"""
    return {"data": ctp.get_market_equity_job()}


@app.get("/api/portfolio/ctp/settlement")
def portfolio_ctp_settlement(
    day: str = Query(..., description="YYYYMMDD 或 YYYYMM"),
    force: bool = Query(False, description="忽略本地缓存强制重查"),
):
    """查单日结算单并解析市值权益（有缓存则直接读本地）。"""
    try:
        return {"data": ctp.fetch_settlement(day, force=force)}
    except ctp.CtpError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"CTP 结算单查询异常：{e}") from e


@app.get("/api/portfolio/ctp/settlement/range")
def portfolio_ctp_settlement_range(
    start: str = Query(..., description="开始日 YYYYMMDD / YYYY-MM-DD"),
    end: str | None = Query(None, description="结束日, 默认今天"),
    refresh: bool = Query(True, description="是否向 CTP 补拉缺失日"),
    force: bool = Query(False, description="忽略缓存全部重查"),
):
    """日期区间结算单: 本地缓存优先, 缺失日登录后补拉, 返回市值权益序列。"""
    try:
        return {
            "data": ctp.fetch_settlement_range(
                start, end, refresh=refresh, force=force,
            )
        }
    except ctp.CtpError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"CTP 结算区间查询异常：{e}") from e


@app.get("/api/radar")
def radar():
    """资讯雷达：12 赛道公开 RSS 资讯（读缓存，无缓存返回赛道骨架）。"""
    try:
        return {"data": newsradar.get_radar(force=False)}
    except Exception as e:
        raise HTTPException(502, f"资讯雷达异常：{e}") from e


@app.post("/api/radar/refresh")
def radar_refresh():
    """强制重抓全部 RSS 源（耗时约 20-40s），更新缓存。"""
    try:
        return {"data": newsradar.fetch_radar()}
    except Exception as e:
        raise HTTPException(502, f"资讯雷达刷新失败：{e}") from e


@app.get("/api/market/overview")
def market_overview():
    """市场情绪 + 板块资金流（板块/大盘级，全站共享缓存 5 分钟）。"""
    try:
        return {"data": market.get_overview()}
    except Exception as e:
        raise HTTPException(502, f"市场总览异常：{e}") from e


@app.get("/api/market/emotion")
def market_emotion():
    """短线情绪：连板梯队 / 最高连板 / 炸板率 / 封板率 / 晋级率 / 涨跌停家数。

    含连板梯队个股清单（code/name/连板数等）——2026-07-05 起如实展示客观公开榜单（东财同款），
    只呈现事实，不附推荐/评分/预测/买卖时机。全站共享缓存 5 分钟。
    """
    try:
        return {"data": market.get_short_term_emotion()}
    except Exception as e:
        raise HTTPException(502, f"短线情绪异常：{e}") from e


@app.get("/api/market/turnover-top")
def market_turnover_top():
    """全市场成交额榜 Top20（客观公开榜单数据，非推荐/非预测/不评分）。全站共享缓存 5 分钟。"""
    try:
        return {"data": market.get_turnover_top()}
    except Exception as e:
        raise HTTPException(502, f"成交额榜异常：{e}") from e


@app.get("/api/market/board-flow")
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


@app.get("/api/market/hsgt")
def market_hsgt():
    """北向资金分钟流向（同花顺；深股通仅供参考）。缓存 2 分钟。"""
    import astock_boards
    try:
        data = _cached("hsgt", "live", 120, astock_boards.hsgt_realtime)
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"北向资金异常：{e}") from e


@app.get("/api/market/hot-list")
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


@app.get("/api/market/stock-monitor")
def market_stock_monitor():
    """交易所重点监控池。缓存 10 分钟。"""
    import astock_boards
    try:
        data = _cached("monitor", "active", 600, lambda: astock_boards.em_stock_monitor(True))
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"重点监控池异常：{e}") from e


@app.get("/api/market/price-anomaly")
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


@app.get("/api/market/limit-pools")
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


@app.get("/api/market/ths-limit-up")
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


@app.get("/api/iwencai/status")
def iwencai_status():
    """iwencai 是否已配置 API key（不暴露 key）。"""
    return {"data": {"configured": astock.iwencai_configured()}}


@app.get("/api/iwencai/search")
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


@app.get("/api/stock-basic")
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


@app.get("/api/global/indices")
def global_indices():
    """全球指数快照（道指 / 标普500 / 纳斯达克 / 恒生 / 恒生科技）—— A 股看隔夜外围脸色。缓存 5 分钟。"""
    try:
        return {"data": market.get_global_indices()}
    except Exception as e:
        raise HTTPException(502, f"全球指数异常：{e}") from e


@app.get("/api/global/stock")
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


@app.get("/api/global/us/kline")
def global_us_kline(
    symbol: str = Query(..., min_length=1, max_length=16),
    num: int = Query(180, ge=20, le=1000),
):
    """美股日 K（默认前复权 Yahoo；不可达回退新浪不复权）。symbol 如 AAPL / TSLA。缓存 5 分钟。"""
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


@app.get("/api/global/hk/kline")
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


@app.get("/api/global/hk/cashflow")
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


@app.get("/api/global/stock/fundamentals")
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


@app.get("/api/global/stock/statements")
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


@app.get("/api/global/stock/fund-flow")
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


@app.get("/api/global/stock/short-volume")
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


@app.get("/api/global/stock/sec-filings")
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


@app.get("/api/global/sec/daily")
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


@app.get("/api/global/earnings-calendar")
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


@app.get("/api/global/treasury-curve")
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


@app.get("/api/global/edgar/screener")
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


@app.get("/api/global/movers")
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


@app.get("/api/global/short-ranking")
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


@app.get("/api/global/stock/news")
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


@app.get("/api/global/stock/options")
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


@app.get("/api/indices")
def indices():
    """A股大盘指数实时行情（上证/深证成指/创业板指/沪深300）。仅标准库。"""
    try:
        return {"data": astock.index_quote()}
    except Exception as e:
        raise HTTPException(502, f"指数行情异常：{e}") from e


@app.get("/api/quote")
def quote(codes: str = Query(..., description="逗号分隔的 6 位代码")):
    """实时行情：现价/涨跌/PE/PB/市值/换手/涨跌停。仅标准库，永远可用。"""
    lst = [c.strip() for c in codes.split(",") if c.strip()]
    if not lst or any(not c.isdigit() or len(c) != 6 for c in lst):
        raise HTTPException(400, "codes 必须是逗号分隔的 6 位数字")
    try:
        return {"data": astock.tencent_quote(lst)}
    except Exception as e:
        raise HTTPException(502, f"行情源异常：{e}") from e


import time as _time

_PCT_CACHE: dict = {}


@app.get("/api/valuation/percentile")
def valuation_percentile(code: str = Query(...)):
    """PE-TTM / PB 历史分位（近5年）。全站缓存 30 分钟/代码（历史序列日频、变化慢）。"""
    code = _validate(code)
    hit = _PCT_CACHE.get(code)
    if hit and _time.time() - hit[0] < 1800:
        return {"data": hit[1]}
    try:
        data = astock.valuation_percentile(code)
        _PCT_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"估值分位异常：{e}") from e


_ANN_CACHE: dict = {}


@app.get("/api/announcements")
def announcements(code: str = Query(...)):
    """个股近期公告（东财，仅 requests）。缓存 15 分钟/代码。"""
    code = _validate(code)
    hit = _ANN_CACHE.get(code)
    if hit and _time.time() - hit[0] < 900:
        return {"data": hit[1]}
    try:
        data = astock.announcements(code)
        _ANN_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"公告源异常：{e}") from e


_FIN_CACHE: dict = {}


@app.get("/api/financials")
def financials(code: str = Query(...)):
    """财务关键指标（同花顺财务摘要，最新报告期）。缓存 30 分钟/代码。"""
    code = _validate(code)
    hit = _FIN_CACHE.get(code)
    if hit and _time.time() - hit[0] < 1800:
        return {"data": hit[1]}
    try:
        data = astock.financials(code)
        _FIN_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"财务摘要异常：{e}") from e


@app.get("/api/valuation")
def valuation(code: str = Query(...)):
    """完整估值：行情 + 一致预期 + 前向PE/PEG/消化年数。"""
    code = _validate(code)
    try:
        return {"data": astock.full_valuation(code)}
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"估值计算异常：{e}") from e


@app.get("/api/reports")
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


@app.get("/api/news")
def news(code: str = Query(...), limit: int = Query(20, ge=1, le=50)):
    """个股新闻（东财，需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.stock_news(code, limit=limit)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"新闻源异常：{e}") from e


@app.get("/api/cls-telegraph")
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


@app.get("/api/global-news")
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


@app.get("/api/info")
def info(code: str = Query(...)):
    """个股基本面：行业/股本/上市时间（需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.individual_info(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"基本面源异常：{e}") from e


@app.get("/api/disclosure")
def disclosure(code: str = Query(...)):
    """巨潮公告列表（需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.disclosure(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"公告源异常：{e}") from e


@app.get("/api/kline")
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


@app.get("/api/astock/light-kline")
def astock_light_kline(
    code: str = Query(..., min_length=6, max_length=6),
    resolution: str = Query("1D", description="1=分时 / 5=五日 / 1D=日K前复权"),
    num: int = Query(365, ge=20, le=1000),
):
    """A 股轻量图（腾讯）：分时 / 5日 / 日K前复权。仅需标准库，不依赖 mootdx。缓存 60 秒。"""
    code = _validate(code)
    res = resolution.strip()
    if res not in ("1", "5", "1D"):
        raise HTTPException(400, "resolution 仅支持 1 / 5 / 1D")
    try:
        data = _cached(
            f"ashare_light:{res}:{num}",
            code,
            60,
            lambda: astock.light_kline(code, res, num=num),
        )
        if not data:
            raise HTTPException(404, f"未取到「{code}」的 K 线")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"A股轻量K线异常：{e}") from e


@app.get("/api/finance")
def finance(code: str = Query(...)):
    """季报财务快照（需 mootdx）。"""
    code = _validate(code)
    try:
        return {"data": astock.finance(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"财务源异常：{e}") from e


# ---------------------------------------------------------------------------
# 资金面 / 筹码 / 信号（东财数据中心，v3.3 并入）—— 均为「用户查的那只股」的公开数据。
# 东财有 1s 限流，这些多为日/季级静态数据，统一走 30 分钟缓存，进一步降低被封风险。
# ---------------------------------------------------------------------------

_DC_CACHE: dict = {}  # key=(endpoint, code) -> (ts, data)


def _cached(endpoint: str, code: str, ttl: int, fetch):
    key = (endpoint, code)
    hit = _DC_CACHE.get(key)
    if hit and _time.time() - hit[0] < ttl:
        return hit[1]
    data = fetch()
    _DC_CACHE[key] = (_time.time(), data)
    return data


@app.get("/api/margin")
def margin(code: str = Query(...)):
    """融资融券明细（东财，日级）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {
            "data": _cached("margin", code, 1800, lambda: astock.margin_trading(code))
        }
    except Exception as e:
        raise HTTPException(502, f"融资融券异常：{e}") from e


@app.get("/api/block-trade")
def block_trade(code: str = Query(...)):
    """大宗交易（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("block", code, 1800, lambda: astock.block_trade(code))}
    except Exception as e:
        raise HTTPException(502, f"大宗交易异常：{e}") from e


@app.get("/api/holders")
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


@app.get("/api/dividend")
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


@app.get("/api/fund-flow")
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


@app.get("/api/fund-flow/minute")
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


@app.get("/api/market/etf-flow")
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


@app.get("/api/shareholder-changes")
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


@app.get("/api/market/lpr")
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


@app.get("/api/market/bond-yield")
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


@app.get("/api/dragon-tiger")
def dragon_tiger(code: str = Query(...)):
    """龙虎榜：该股近期上榜记录 + 买卖席位 + 机构净买（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {
            "data": _cached("dt", code, 1800, lambda: astock.dragon_tiger_board(code))
        }
    except Exception as e:
        raise HTTPException(502, f"龙虎榜异常：{e}") from e


@app.get("/api/dragon-tiger/daily")
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


@app.get("/api/lockup")
def lockup(code: str = Query(...)):
    """限售解禁日历：历史解禁 + 未来 90 天待解禁（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {
            "data": _cached("lockup", code, 1800, lambda: astock.lockup_expiry(code))
        }
    except Exception as e:
        raise HTTPException(502, f"解禁日历异常：{e}") from e


@app.get("/api/blocks")
def blocks(code: str = Query(...)):
    """个股所属板块/概念归属（东财 slist）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {
            "data": _cached("blocks", code, 1800, lambda: astock.concept_blocks(code))
        }
    except Exception as e:
        raise HTTPException(502, f"板块归属异常：{e}") from e


@app.get("/api/hot-concepts")
def hot_concepts(code: str = Query(...)):
    """个股当下被市场归到哪些概念在炒（东财热门概念命中）。缓存 15 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("hotcon", code, 900, lambda: astock.hot_concepts(code))}
    except Exception as e:
        raise HTTPException(502, f"热门概念异常：{e}") from e


@app.get("/api/investor-qa")
def investor_qa(code: str = Query(...)):
    """互动易问答（巨潮）：投资者提问 + 公司回复。缓存 15 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("irm", code, 900, lambda: astock.investor_qa(code))}
    except Exception as e:
        raise HTTPException(502, f"互动易异常：{e}") from e


@app.get("/api/industry")
def industry(top: int = Query(20, ge=5, le=50)):
    """全行业涨跌幅排名（东财行业板块，板块级、零个股名单）。缓存 5 分钟。"""
    key = ("industry", str(top))
    hit = _DC_CACHE.get(key)
    if hit and _time.time() - hit[0] < 300:
        return {"data": hit[1]}
    try:
        data = astock.industry_comparison(top_n=top)
        # Empty result usually means upstream blip — do not cache, allow retry
        if data.get("top"):
            _DC_CACHE[key] = (_time.time(), data)
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"行业排名异常：{e}") from e


# ---------------------------------------------------------------------------
# OpenVlab 期权 / 期货波动率市场数据(移植自 openvlab.cn 爬虫)
#   公开 REST 接口, 无鉴权. 全站共享缓存 5 分钟. 只客观呈现, 不推荐 / 不预测.
# ---------------------------------------------------------------------------


def _ovlab_call(fn, label: str):
    """OpenVlab 端点统一异常包装: 缺依赖 501, 其他 502."""
    try:
        return {"data": fn()}
    except ovlab.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"OpenVlab {label}异常：{e}") from e


@app.get("/api/ovlab/market")
def ovlab_market():
    """OpenVlab 市场概览: 全部品种的行情 / 平值隐波 / 偏度 / carry 等概览 (ctamap-all)。缓存 5 分钟。"""
    return _ovlab_call(ovlab.get_market_overview, "市场概览")


@app.get("/api/ovlab/detail")
def ovlab_detail(
    prod_und: str = Query(
        ..., min_length=1, max_length=32, description="标的代码, 如 510300"
    ),
    exps: str | None = Query(None, description="可选, 逗号分隔的合约月份列表"),
):
    """OpenVlab 单个标的详细数据 (dto/{prodUnd})。缓存 5 分钟。"""
    exp_list = [e.strip() for e in exps.split(",") if e.strip()] if exps else None
    return _ovlab_call(
        lambda: ovlab.get_product_detail(prod_und.strip(), exp_list), "个股详情"
    )


@app.get("/api/ovlab/volatility-ts")
def ovlab_volatility_ts():
    """OpenVlab 波动率期限结构汇总 (volatility-ts-all)。部分字段可能受限。缓存 5 分钟。"""
    return _ovlab_call(ovlab.get_volatility_term_structures, "波动率期限结构")


# —— 期货期限结构 ——


@app.get("/api/ovlab/future-ts-all")
def ovlab_future_ts_all():
    """OpenVlab 期货期限结构汇总 (future-ts-all)，全品种。缓存 5 分钟。"""
    return _ovlab_call(ovlab.get_future_term_structures_all, "期货期限结构汇总")


@app.get("/api/ovlab/future-ts")
def ovlab_future_ts(
    prod_und: str = Query(
        ..., min_length=1, max_length=32, description="标的代码, 如 MA"
    ),
):
    """OpenVlab 单品种期货期限结构 (future-ts/{prodUnd})。缓存 5 分钟。"""
    return _ovlab_call(
        lambda: ovlab.get_future_term_structure(prod_und.strip()), "期货期限结构"
    )


# —— 异动 / 资金流 ——


@app.get("/api/ovlab/flow-alert")
def ovlab_flow_alert():
    """OpenVlab 异动榜 (flow-alert)：合约/规则/价格/涨跌/持仓量/窗口成交量/权利金。缓存 5 分钟。"""
    return _ovlab_call(ovlab.get_flow_alerts, "异动榜")


class FlowDataReq(BaseModel):
    product: str | None = None
    page: int = 1
    page_size: int = 20


@app.post("/api/ovlab/flow-data")
def ovlab_flow_data(req: FlowDataReq):
    """OpenVlab 资金流分页数据 (flow-data, POST)。不缓存（参数多变）。"""
    body: dict = {"page": req.page, "pageSize": req.page_size}
    if req.product:
        body["product"] = req.product.strip()
    return _ovlab_call(lambda: ovlab.get_flow_data(body), "资金流")


# —— 持仓 / 仓差 / 季节性 ——


class WarehouseHistoryReq(BaseModel):
    product: str


@app.post("/api/ovlab/warehouse-history")
def ovlab_warehouse_history(req: WarehouseHistoryReq):
    """OpenVlab 单品种多年持仓历史 (warehouse/history, POST)。缓存 5 分钟。"""
    return _ovlab_call(
        lambda: ovlab.get_warehouse_history(req.product.strip()), "持仓历史"
    )


class SeasonalHistoryReq(BaseModel):
    years: list[str] | None = None
    product: str | None = None


@app.post("/api/ovlab/warehouse-seasonal")
def ovlab_warehouse_seasonal(req: SeasonalHistoryReq):
    """OpenVlab 全品种季节性持仓 (warehouse/seasonal-history-all, POST)。缓存 5 分钟。"""
    return _ovlab_call(
        lambda: ovlab.get_warehouse_seasonal_history_all(req.years, req.product),
        "季节性持仓",
    )


# —— K 线 / 价格波动率 (POST, 需具体合约代码) ——


class CodesReq(BaseModel):
    codes: list[str]


@app.post("/api/ovlab/last-bars")
def ovlab_last_bars(req: CodesReq):
    """OpenVlab 最新 K 线 (last-bars, POST)。codes 为具体合约代码如 ps2609-C-40000。不缓存。"""
    return _ovlab_call(lambda: ovlab.get_last_bars(req.codes), "最新K线")


class PriceVolSeriesReq(BaseModel):
    # Accept list (preferred) or JSON/comma string for older clients
    codes: list[str] | str


@app.post("/api/ovlab/price-volatility-series")
def ovlab_price_volatility_series(req: PriceVolSeriesReq):
    """OpenVlab 价格+隐波分时预览 (price-volatility-series)。

    codes: 品种:到期月 列表, 如 [\"MA:202609\"], 或 JSON 字符串. 缓存 5 分钟.
    """
    return _ovlab_call(
        lambda: ovlab.get_price_volatility_series(req.codes), "价格波动率序列"
    )


# —— 元数据 ——


@app.get("/api/ovlab/product-exps")
def ovlab_product_exps(
    prod_und: str | None = Query(None, description="可选, 指定单品种"),
):
    """OpenVlab 全品种合约月份列表 (product-exps)。缓存 30 分钟。"""
    return _ovlab_call(lambda: ovlab.get_product_exps(prod_und), "合约月份")


@app.get("/api/ovlab/exchange-info")
def ovlab_exchange_info():
    """OpenVlab 交易所信息 (exchange-info)。缓存 1 小时。"""
    return _ovlab_call(ovlab.get_exchange_info, "交易所信息")


@app.get("/api/ovlab/sector-info")
def ovlab_sector_info():
    """OpenVlab 板块信息 (sector-info)。缓存 1 小时。"""
    return _ovlab_call(ovlab.get_sector_info, "板块信息")


@app.get("/api/ovlab/next-trading-day")
def ovlab_next_trading_day():
    """OpenVlab 下一交易日 (next-trading-day)。缓存 1 小时。"""
    return _ovlab_call(ovlab.get_next_trading_day, "下一交易日")


@app.get("/api/ovlab/holidays")
def ovlab_holidays(
    exchange: str = Query(
        ..., min_length=1, max_length=16, description="交易所代码, 如 CZCE"
    ),
):
    """OpenVlab 某交易所节假日日历 (holidays/{exchange})。缓存 1 小时。"""
    return _ovlab_call(lambda: ovlab.get_holidays(exchange.strip()), "节假日")


@app.get("/api/ovlab/expired")
def ovlab_expired(
    prod_und: str = Query(..., min_length=1, max_length=32, description="标的代码"),
):
    """OpenVlab 某标的已过期合约 (expired/{prodUnd})。缓存 30 分钟。"""
    return _ovlab_call(lambda: ovlab.get_expired(prod_und.strip()), "已过期合约")


# —— 轻量行情图表 (chart/light) ——
@app.get("/api/ovlab/kline-history")
def ovlab_kline_history(
    response: Response,
    symbol: str = Query(
        ..., min_length=1, max_length=64, description="合约代码, 如 SC2609"
    ),
    resolution: str = Query("1D", description="周期: 1D / 1H / 5m / 1m"),
    from_ts: int | None = Query(None, description="Unix 秒, 默认近 1 年"),
    to_ts: int | None = Query(None, description="Unix 秒, 默认当前"),
):
    """OpenVlab K 线历史 (history)。不缓存。"""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return _ovlab_call(
        lambda: ovlab.get_kline_history(symbol.strip(), resolution, from_ts, to_ts),
        "K 线历史",
    )


@app.get("/api/ovlab/atmvol-history")
def ovlab_atmvol_history(
    response: Response,
    symbol: str = Query(
        ..., min_length=1, max_length=64, description="合约代码, 如 SC2609"
    ),
    resolution: str = Query("1D"),
    from_ts: int | None = Query(None),
    to_ts: int | None = Query(None),
):
    """OpenVlab ATM 隐含波动率历史 (history-atmvol)。不缓存。"""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return _ovlab_call(
        lambda: ovlab.get_atmvol_history(symbol.strip(), resolution, from_ts, to_ts),
        "ATMV 历史",
    )


@app.get("/api/ovlab/last-bar")
def ovlab_last_bar(
    response: Response,
    code: str = Query(
        ..., min_length=1, max_length=64, description="合约代码, 如 SC2609"
    ),
):
    """OpenVlab 单合约最新 bar (last-bar/{code})。不缓存。"""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return _ovlab_call(lambda: ovlab.get_last_bar(code.strip()), "最新 bar")


@app.get("/api/ovlab/search-symbols")
def ovlab_search_symbols(
    keyword: str = Query("", description="模糊关键词"),
    limit: int = Query(30, ge=1, le=200),
):
    """OpenVlab 标的搜索 (search-symbols)。短缓存 60s。"""
    return _ovlab_call(lambda: ovlab.search_symbols(keyword.strip(), limit), "标的搜索")


@app.get("/api/ovlab/symbol-info")
def ovlab_symbol_info(
    code: str = Query(
        ..., min_length=1, max_length=64, description="合约代码, 如 SC2609"
    ),
):
    """OpenVlab 合约元信息 (symbol/{code}): 交易时段/价格精度/到期日。缓存 30 分钟。"""
    return _ovlab_call(lambda: ovlab.get_symbol_info(code.strip()), "合约信息")


@app.get("/api/ovlab/volatility-surface")
def ovlab_volatility_surface(
    product: str = Query(
        ..., min_length=1, max_length=32, description="标的代码, 如 SC"
    ),
):
    """OpenVlab 波动率曲面 (volatility-surface/{product})。缓存 2 分钟。"""
    return _ovlab_call(
        lambda: ovlab.get_volatility_surface(product.strip()), "波动率曲面"
    )


class SkewmapReq(BaseModel):
    selectedExpiries: dict | None = None


@app.post("/api/ovlab/skewmap")
def ovlab_skewmap(req: SkewmapReq):
    """OpenVlab 偏度图 (skewmap, POST)。不缓存。"""
    return _ovlab_call(
        lambda: ovlab.get_skewmap(req.model_dump(exclude_none=True)), "偏度图"
    )


@app.get("/api/ovlab/surfacemap")
def ovlab_surfacemap(product: str | None = Query(None, description="可选标的代码")):
    """OpenVlab 曲面图 (surfacemap, GET)。缓存 2 分钟。"""
    params = {"product": product.strip()} if product and product.strip() else {}
    return _ovlab_call(lambda: ovlab.get_surfacemap(params), "曲面图")


# —— 持仓排名 (flow/option-flow) ——
@app.get("/api/ovlab/option-position-products")
def ovlab_option_position_products():
    """OpenVlab 期权持仓品种列表 (option-position/products)。缓存 1 小时。"""
    return _ovlab_call(ovlab.get_option_position_products, "期权持仓品种")


@app.get("/api/ovlab/option-position-details")
def ovlab_option_position_details(
    product: str = Query(
        ..., min_length=1, max_length=32, description="品种, 如 SC/IO"
    ),
    code: str = Query(..., min_length=1, max_length=64, description="合约, 如 SC2609"),
    direction: str = Query(..., description="方向: C 或 P"),
    day: str = Query(..., description="日期 YYYY-MM-DD"),
):
    """OpenVlab 期权持仓明细 (option-position/details)。缓存 5 分钟。"""
    return _ovlab_call(
        lambda: ovlab.get_option_position_details(
            product.strip(), code.strip(), direction.strip(), day.strip()
        ),
        "期权持仓明细",
    )


@app.get("/api/ovlab/future-position-products")
def ovlab_future_position_products():
    """OpenVlab 期货持仓品种列表 (future-position/products)。缓存 1 小时。"""
    return _ovlab_call(ovlab.get_future_position_products, "期货持仓品种")


@app.get("/api/ovlab/future-position-details")
def ovlab_future_position_details(
    product: str = Query(..., min_length=1, max_length=32, description="品种, 如 RB"),
    code: str = Query(..., min_length=1, max_length=64, description="合约, 如 rb2608"),
    direction: str = Query("0", description="方向 (后端忽略, 传 0 即可)"),
    day: str = Query(..., description="日期 YYYY-MM-DD"),
):
    """OpenVlab 期货持仓明细 (future-position/details)。缓存 5 分钟。"""
    return _ovlab_call(
        lambda: ovlab.get_future_position_details(
            product.strip(), code.strip(), direction.strip(), day.strip()
        ),
        "期货持仓明细",
    )


# ---------------------------------------------------------------------------
# Fino 机构观点 (/api/fino/*)
# ---------------------------------------------------------------------------


def _fino_call(fn, label: str):
    """Fino 端点统一异常包装: 缺依赖 501, 其他 502."""
    try:
        return {"data": fn()}
    except fino.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"Fino {label}异常: {e}") from e


@app.get("/api/fino/overview")
def fino_overview(
    report_type: str = Query("daily", description="daily / weekly"),
    start_date: str = Query("", description="起始日 YYYYMMDD, 空则今天"),
    end_date: str = Query("", description="截止日 YYYYMMDD, 空则今天"),
    codes: str = Query("", description="品种代码逗号分隔, 如 CU,RB; 空则全量"),
):
    """Fino 机构观点汇总。缓存 10 分钟。"""
    code_list = [c for c in codes.split(",") if c.strip()]
    return _fino_call(
        lambda: fino.get_overview(
            report_type.strip(), start_date.strip(), end_date.strip(), code_list
        ),
        "机构观点汇总",
    )


@app.get("/api/fino/detail")
def fino_detail(
    report_type: str = Query("daily", description="daily / weekly"),
    start_date: str = Query("", description="起始日 YYYYMMDD, 空则今天"),
    end_date: str = Query("", description="截止日 YYYYMMDD, 空则今天"),
    codes: str = Query("", description="品种代码逗号分隔, 如 CU,RB; 空则全量"),
):
    """Fino 机构观点明细 (逐条)。缓存 10 分钟。"""
    code_list = [c for c in codes.split(",") if c.strip()]
    return _fino_call(
        lambda: fino.get_detail(
            report_type.strip(), start_date.strip(), end_date.strip(), code_list
        ),
        "机构观点明细",
    )
