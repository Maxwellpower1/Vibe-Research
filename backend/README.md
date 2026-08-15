# Vibe-Research Backend

A股数据层 + 可插拔 AI 层。全部只读、无状态；不预置任何标的、不推荐、不预测。

## 安装

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

> 行情 + 研报只需 `fastapi / uvicorn / requests`（秒装、必可用）。
> 一致预期 / 新闻 / 公告需 `akshare`，K线 / 财务需 `mootdx`；未装时对应端点返回 501 + 安装提示，不影响其余功能。

## 1. HTTP API（给网页前端 + 系统 AI）

```bash
.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8900
```

| 端点 | 说明 | 依赖 |
|---|---|---|
| `GET /api/health` | 健康检查 | — |
| `GET /api/indices` | 大盘指数实时行情 | stdlib |
| `GET /api/quote?codes=600519,000858` | 实时行情（PE/PB/市值/涨跌停…，与 `/market/quotes` 共用 5s 腾讯缓存） | stdlib |
| `GET /api/valuation?code=600519` | 完整估值（前向PE/PEG/消化年数） | requests+akshare |
| `GET /api/valuation/percentile?code=600519` | 估值历史分位（近5年·百度股市通） | akshare |
| `GET /api/financials?code=600519` | 财务关键指标（同花顺摘要，最新报告期，前端个股页用） | akshare |
| `GET /api/reports?code=600519` | 个股研报列表（含 PDF 链接） | requests |
| `GET /api/announcements?code=600519` | 近期公告（东财） | requests |
| `GET /api/news?code=600519` | 个股新闻 | akshare |
| `GET /api/cls-telegraph` | 财联社电报（全市场快讯，零 key） | requests |
| `GET /api/kline?code=600519` | K线 | mootdx |
| — | *（AI 工具层走腾讯 K 线，mootdx 仅作备份：mootdx 是 TCP 7709，部分网络连不通要等十几秒超时）* | — |
| `GET /api/finance?code=600519` | 季报财务快照（mootdx，前端未用 / 备用） | mootdx |
| **资金面·筹码·信号（v3.3）** | `/api/margin` · `/block-trade` · `/holders` · `/dividend` · `/fund-flow` · `/dragon-tiger` · `/dragon-tiger/daily`（全市场龙虎榜） · `/lockup` · `/blocks` · `/hot-concepts` · `/investor-qa` · `/industry` | requests |
| `GET /api/market/overview` · `/api/radar` | 市场情绪+板块资金 · 资讯雷达 | akshare / stdlib |
| `GET /api/market/review-snapshot` | 每日复盘聚合（`scope=paint|top|full`），paint 只含腾讯指数/总览 | 缓存命中秒回 |
| `GET /api/market/board-flow` · `/hsgt` · `/hot-list` · `/stock-monitor` · `/price-anomaly` · `/limit-pools` | 板块资金流 / 北向 / 同花顺热榜 / 监控池 / 异动 / 打板池 | requests |
| `GET /api/market/world-indices` · `/quotes` · `/boards` · `/board-stocks` · `/rank` · `/board-flow-intraday` · `/commodities` · `/commodity-minutes` | 全球关键指数 / 批量报价(股票指数按代码 5s, 期货走 commodities 并行) / 板块热点 / 成分股(腾讯pt*) / 个股榜单(含成交额, 新浪) / 分钟板块资金 / 大宗商品 | 腾讯/新浪/东财(仅独有资金流) |
| `GET /api/market/spot-table` · `/chem-spot` · `/future-daily` · `/stock-boards` · `/stock-boards-batch` · `/lives` | 生意社现期/基差 · 化工现货 · 新浪期货日K · 个股行业/概念(单票/批量) · 新浪7x24(华尔街见闻兜底) | requests |
| `GET /api/iwencai/status` · `/search` · `/select` | 问财是否已配置 · 研报/公告/新闻语义搜 · 选股名单(产业链刷新) | IWENCAI_API_KEY |
| `GET /api/market/breadth` · `/ths-profile` · `/ths-rotation` | 全A涨跌分位+直方图(新浪/腾讯) · shy313同花顺归属 · 概念/行业当日均涨 | requests |
| `GET /api/fin/board` · `/forecast` · `/company` · `/suggest` | 财报窗口：盈利榜+日历+行业实时涨跌 / 业绩预告 / F10+估值+公告+研报 / 代码联想 | 东财 + 本仓库财务/估值 |
| `GET /api/stock-basic?code=` | 个股基本资料（行业/地域/概念/股本/上市日） | requests |
| `POST /api/chat` | 系统 AI 对话（function calling，AI 自己调数据工具） | requests |
| `POST /api/reflect` | **反思审计**（流式 NDJSON）：对一段已写好的分析做推理审计 | requests |
| `GET /api/portfolio/ctp/status` | CTP 配置/依赖/登录状态（不主动连前置） | — |
| `GET /api/portfolio/ctp/logs` | CTP 操作日志（`?since=` 增量轮询） | — |
| `POST /api/portfolio/ctp/login` | **点击登录**（连前置并保持会话，不下单） | openctp-ctp |
| `POST /api/portfolio/ctp/logout` | 退出并断开会话 | openctp-ctp |
| `GET /api/portfolio/ctp` | 查资金/持仓（需已登录，只读）；先返回客户权益，期权市值后台算 | openctp-ctp |
| `GET /api/portfolio/ctp/market-equity` | 轮询后台市值权益（`客户权益+多头期权市值-空头期权市值`，流控不阻塞主查询） | openctp-ctp |
| `GET /api/portfolio/ctp/settlement?day=` | 查单日结算单（本地 `~/.vibe-research/ctp_settlements.json` 有则复用） | openctp-ctp |
| `GET /api/portfolio/ctp/settlement/range?start=&end=` | 区间结算单 + 市值权益 / 净值 / 累计收益 / 盈亏日历 / 统计；缓存优先。日历：盈亏=`Δequity-出入金`，收益=`盈亏-手续费` | openctp-ctp |
| `GET /api/global/stock/fundamentals?symbol=` | 美/港估值+分析师+机构持仓（Yahoo，403 回退 v7 / 东财 PE·PB） | requests |
| `GET /api/global/stock/statements?symbol=&statement=` | 三表关键科目（income/balance/cashflow，东财） | requests |
| `GET /api/global/stock/fund-flow?symbol=` | 日级资金流 | requests |
| `GET /api/global/stock/short-volume?symbol=` | FINRA 空头成交量时序（仅美股） | requests |
| `GET /api/global/stock/sec-filings?symbol=` | 个股 SEC 申报列表（需 `VR_SEC_CONTACT`） | requests |
| `GET /api/global/sec/daily` | 全市场 SEC 当日流 Form4/8-K/13F（需 `VR_SEC_CONTACT`） | requests |
| `GET /api/global/earnings-calendar` | Nasdaq 财报日历 | requests |
| `GET /api/global/treasury-curve` | 美债收益率曲线 1M~30Y + 关键利差（Treasury，S 级） | requests |
| `GET /api/global/hk/kline?symbol=` | 港股日 K（Yahoo 前复权） | requests |
| `GET /api/global/edgar/screener` | SEC EDGAR frames 全市场 screener（S 级，需 VR_SEC_CONTACT） | requests |
| `GET /api/global/movers?board=` | 美/港涨跌与成交额榜（东财 market_stock_list，C 级） | requests |
| `GET /api/global/short-ranking` | FINRA 全市场空头占比榜 | requests |
| `GET /api/global/stock/news?symbol=` | 美/港个股新闻（Yahoo search，C 级） | requests |
| `GET /api/global/stock/options?symbol=` | CBOE 延时期权概览（0DTE/近月异动·P/C·IV；仅美股，合规 C 级个人研究） | requests |

`/api/reflect` 请求体：`{"source": "待审的分析文本", "title": "可选标题", "llm": {...}}`。
事件类型：`status` · `delta` · `done` · `error`。

> `/api/reflect` **不产出买卖结论**：终点是「怎么继续验证」。

> 上表为主要端点；完整路由清单见 `app.py`。要更全量的 A 股数据（打板 / ETF期权 / 全市场行业排名等），用根目录 [`a-stock-data/`](../a-stock-data/SKILL.md) 工具箱。

`/api/chat` 请求体：
```json
{
  "messages": [{"role": "user", "content": "茅台估值贵不贵？"}],
  "context": "本页上下文（可空）",
  "llm": {"baseURL": "https://api.deepseek.com", "apiKey": "sk-…", "model": "deepseek-chat"}
}
```
`llm` 由前端从本地配置随请求带上，后端不持久化 key。

## 2. MCP Server（给 Claude Code / 高手 agent）

零第三方依赖，复用同一套数据工具。挂进 Claude Code：

```bash
claude mcp add vibe-research -- \
  "$(pwd)/.venv/bin/python" "$(pwd)/mcp_server.py"
```

挂上后，你的 agent 直接拥有行情 / 估值 / 研报 / 新闻 / 资金 / 期权期货等 **48 个** 数据工具（与网页「问 AI」同一套 `tools.TOOLS`），
用你自己的订阅额度调数据、多步分析——无需 API key、不占本产品成本。

### 完整 A 股数据工具箱（随仓库自带）

MCP 暴露网页 AI 同一套工具（48 个）。若 agent 需要更全的 A 股数据（龙虎榜 / 融资融券 / 大宗交易 / 股东户数 / 分红 / 资金流 / 解禁 / 概念板块 / 打板情绪 / ETF 期权 / 互动易 / 全市场行业排名 …共 **47 个端点**），本仓库根目录**自带完整数据源** [`a-stock-data/`](../a-stock-data/SKILL.md)（a-stock-data v3.6.0）：

- 要调哪个接口，直接看 [`a-stock-data/SKILL.md`](../a-stock-data/SKILL.md)——每个端点都有 copy-paste 即用的代码（内嵌全部调用逻辑，零第三方数据封装依赖，东财接口已内置限流防封）。
- 运行依赖：`pip install mootdx requests pandas stockstats`（自包含，v3.0 起已移除 akshare）。
- 上游与更新：[github.com/simonlin1212/a-stock-data](https://github.com/simonlin1212/a-stock-data)（不更新也能一直用，自带的是固定可用快照）。
- 分工：**MCP 48 工具** = 网页 / 问 AI 常用；**自带数据源 40+ 端点** = agent 深度自助调研的全量工具箱。二者同源，按需取用。

## 合规

- 数据端点只返回客观行情/研报/财报/新闻，不含任何建议、排名、预测。
- `/api/chat` 的 system prompt 内置中立红线：不荐股、不预测涨跌、不给买卖时机、不构成投资建议。
- 分析结论一律由用户配置的模型 / agent 给出，本产品只提供数据与工具。
