<p align="center"><b>简体中文</b> | <a href="README_en.md">English</a></p>

<h1 align="center">Vibe-Research · 个人 AI 投研系统（A股/美股/港股）</h1>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![GitHub stars](https://img.shields.io/github/stars/simonlin1212/Vibe-Research?style=social)](https://github.com/simonlin1212/Vibe-Research/stargazers)
[![官网 viberesearch.wiki](https://img.shields.io/badge/🌐_官网-viberesearch.wiki-F35D2B?style=flat)](https://viberesearch.wiki)
[![English README](https://img.shields.io/badge/📖_English-README-1F6FEB?style=flat)](README_en.md)

<p align="center">
  <a href="https://viberesearch.wiki">官网</a> ·
  <a href="#功能">功能</a> ·
  <a href="#数据源data-sources">数据源</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#接入-ai">接入 AI</a> ·
  <a href="#合规">合规</a> ·
  <a href="#相关生态">相关生态</a>
</p>

> **Vibe-Research: Your Personal Trading Research Agent** · A股 / 美股 / 港股 的个人投研 Agent。
>
> A股 / 美股 / 期权期货、资讯雷达、我的持仓。把数据和功能配齐，由**你自己的 AI** 驱动投资研究。

Vibe-Research 是一个开源的「个人 AI 投研看板」，**主推 A 股、兼看美股 / 港股**（A 股常要看隔夜外围脸色，数据配上更全）。它不替你做决定——把行情、研报、估值、财务、公告、资金面、资讯都配齐，放进一个干净的看板，再留一个能接入**你自己的 AI** 的接口。方向和结论，交给你自己配置的模型 / agent。

**看板读法**：复盘页是一屏驾驶舱（桌面无需滚动，点面板放大）；K 线 / 详情 / 公告 / 美股 / 期权 / 持仓走同一套深蓝青顶栏，不再切主题、不再套玻璃卡片。

> *Vibe-Research: Your Personal Trading Research Agent. An open dashboard for China A-share (plus US / HK): it wires up all the data and plugs into **your own AI / agent** — it never recommends a stock. You bring the model, it brings the data.*

## 功能

每个页面的具体模块：

| 页面 | 包含的模块 / 能力 |
|---|---|
| 🇨🇳&nbsp;**A&#8288;股** | 顶栏：**复盘** / **K线** / **详情** / **公告**。整站顶栏下方横向滚动行情条（全球指数 + 美债 10Y·2Y，约 20s 刷新，与驾驶舱共用 `world-indices`）。复盘是一屏驾驶舱（可放大面板）：**全球关键指数**（A/港/美/汇率）/ **市场板块实时热点** / 情绪+北向 / **板块资金流向**（分钟累计蝴蝶图，点击筛主力净流入）/ **主力净流入排行**（分时 + 净额/净占比）/ **个股榜单**（热门/涨跌，分时 + 主力资金 + 成交额）/ **大宗商品**（期货分时 + **生意社现期/基差表**） / 涨跌停池 / 自选 / 龙虎·资金·8 条产业链。**实时热点 · 7×24 快讯**仍是右下角悬浮球（财联社 / 东财） |
| 🪟&nbsp;**财&#8288;报&#8288;窗&#8288;口** | 顶栏进入 `/fin`：披露日历（A 股柱带 + **美股财报日历**）/ 业绩预告 / 行业·个股盈利榜 / 公司近 12 期趋势。不预置标的，从最近浏览或搜索/榜单选公司后，叠上本仓库已有的**财务摘要、前向估值/PEG、公告、研报**，并可跳转个股详情 |
| 📡&nbsp;**资&#8288;讯&#8288;雷&#8288;达** | 右下角**悬浮球**：财联社电报 + 东财 7×24（新电报角标 / 顶部 toast） |
| ⭐&nbsp;**自&#8288;选&#8288;股** | **批量粘贴一串代码即加**（逗号 / 空格 / 换行都行）· 一屏表格总览（现价 / 涨跌 / PE / PB / 换手）· **实时行情开关**（右上角，默认关；开了在交易时段每 3 秒自动刷新，非交易时段与页面切走时自动暂停）· 一键交给 AI 读。只存本地 |
| 💼&nbsp;**我&#8288;的&#8288;持&#8288;仓** | **A股**：录入即实时盈亏 · 已清仓记录（只存本地）。**期货账户**：CTP 只读 · 区间结算单本地缓存 · 净值/累计收益/盈亏日历/统计（账号在本机 `~/.vibe-research/ctp.json`）|
| 📄&nbsp;**我&#8288;的&#8288;研&#8288;报** | **拖拽 / 多选上传**自己的研报（PDF / Word / txt / 表格 / 图片）· 按文件名**自动分行业**归档 · 下载 / 删除。**只存本地部署目录、不上传、不进仓库** |
| 📝&nbsp;**研&#8288;究&#8288;记&#8288;录** | 复盘 / 今日要点 / 问 AI 本地沉淀，随时回看 · **反思审计**：让 AI 回头审这段推理——哪些结论有数据撑着、哪些是脑补、最脆弱的一环在哪、要验证得看什么 |
| 🌊&nbsp;**期&#8288;权&#8288;/&#8288;期&#8288;货** | **OpenVlab** 公开数据：市场概览（全部品种现价 / 涨跌 / 平值隐波 / 隐波百分位 / 22 日实波 / VolAlphaT / Carry / 偏度及百分位 / 主力合约 / 到期日 / 夜盘 / 境外）· 单品种详情（dto）· 波动率期限结构汇总。只客观呈现，不推荐不预测 |
| 🇺🇸&nbsp;**美&#8288;股** | 本地观察列表（ticker）· 东财快照行情 · **日 K + 成交量**（默认前复权 Yahoo）· **财报日历** · **SEC 当日申报流**（需 `VR_SEC_CONTACT`）。点列表即切图；只客观呈现，不推荐不预测 |
| 🤖&nbsp;**AI&#8288;观&#8288;察** | 顶栏进入：公有云 Token 消耗（OpenRouter 日榜）· LLM 价格趋势 / 降价事件（TrakToken TTSI）· 大模型价格表与智能×成本散点（Artificial Analysis，可选 key）· AI 基建 CapEx/ROI（SEC + 模型外推）。只客观呈现，预测段标「模型假设」 |
| 🌤️&nbsp;**天&#8288;气** | 顶栏天气图标进入：当前气温 / 体感 / 湿度 / 风力 · **7/10/14 天预报** · 逐时/日高低温折线图 · 城市快捷切换（默认上海，本地记忆）。`GET /api/weather?city=&days=`；主源 Open-Meteo（最长 16 天），wttr.in 补充实况字段，**无需 API Key** |
| 🔌&nbsp;**接&#8288;入&nbsp;AI** | 订阅接入（本机 CLI，免 key）· API 多模型（自动填 baseURL）· MCP（挂进 Claude Code 等 agent）|

> **投研分析框架**：让 AI 分析个股时，自动按 估值 / 资金面 / 财报质量 / 行业景气 / 事件催化与风险 五维组织结论——框架只规定「怎么读数据」、不规定买卖，方向仍由你自己的 AI 决定。
>
> 连板股 / 成交额榜 / 龙虎榜等均为**客观公开榜单数据，只呈现事实、不推荐、不预测**。

## 数据源（Data Sources）

Vibe-Research 把三套公开数据源**直接集成进仓库**——`git clone` 下来**开箱即用，无需另外下载、接线**。

### A 股全栈数据 · AStockData

- **就在本仓库的 [`a-stock-data/`](a-stock-data/) 文件夹里**（v3.6.0）。十层数据架构、47 个端点、15 个数据源，`a-stock-data/SKILL.md` **内嵌全部调用代码**，自包含、零第三方数据封装依赖，东财接口已内置限流防封，主源被封还能降级到备用源。
- **覆盖**：行情 / K线 / 研报 / 一致预期 / 估值 / 历史分位 / 财务三表 / 公告 / 龙虎榜 / 融资融券 / 大宗交易 / 股东户数 / 分红 / 资金流 / 解禁 / 概念板块 / 打板情绪 / ETF 期权 / 互动易 / 全市场行业排名 …
- **轻量图表 API**：`GET /api/astock/light-kline?code=600519&resolution=1D`（`1` 分时 / `5` 五日 / `1D` 日K前复权，腾讯 ifzq，标准库即可，缓存 60 秒）
- **复盘预热**：后端启动后后台定时预拉复盘常用接口 + **国内指数分时**（含恒生）+ **驾驶舱热路径**（全球指数 / 板块热点 / 个股榜 / 主力净流入 / 分钟资金流 / 商品），交易时段约 90 秒一次；分钟资金流按板块分键缓存，二次访问不再串行 16 次东财 kline。首屏走 `GET /api/market/review-snapshot`（一次返回复盘聚合，避免 10+ 请求撞东财限流）；顶栏行情条与全球指数格共用 `world-indices`。`GET /api/market/review-warmup` 看预热状态；`VR_REVIEW_WARMUP=0` 可关
- **生意社现货（参考看板补齐）**：`GET /api/market/spot-table` 现货/期货/基差对照（8h 缓存，历史落在 `~/.vibe-research/spot-history.json`）· `GET /api/market/chem-spot?id=` 化工现货中位数。驾驶舱商品格「现期」tab 读现期表。
- **期货日 K / 个股板块 / 直播快讯**：`GET /api/market/future-daily?code=nf_AU0`（新浪内盘/外盘日 K）· `GET /api/market/stock-boards?code=600519`（东财行业/地域/概念）· `GET /api/market/lives`（新浪 7×24，失败回退华尔街见闻；不进驾驶舱格子，快讯仍是右下角球）
- **给 agent 用**：用 Claude Code 等 agent 跑本仓库时，要调 A 股数据就看 [`a-stock-data/SKILL.md`](a-stock-data/SKILL.md)——每个接口都有 copy-paste 即用的代码。Vibe-Research 后端的数据层（`backend/astock.py`）也是从它移植的。
- **运行依赖**：`pip install mootdx requests pandas stockstats`（自包含，v3.0 起已移除 akshare 依赖）。
- **更新 / 上游**：<https://github.com/simonlin1212/a-stock-data> —— 想跟进最新端点、扩数据源，去这里看；**但即便你不更新，仓库自带的这份也是固定可用的快照，可以一直用。**

### 美股 / 港股数据 · global-stock-data

- **就在本仓库的 [`global-stock-data/`](global-stock-data/) 文件夹里**（v2.0.3）。13 层数据架构、30+ 个端点、11 个数据源、零鉴权，覆盖美港股行情 / K线 / 技术指标 / 三表财报 / 资金流 / 期权（CBOE 官方期权链含完整希腊字母与 0DTE 流）/ FINRA 空头成交量 / SEC EDGAR 申报流与全市场筛选。每个数据源都标注了合规级别。
- 后端 `backend/gstock.py` + `gstock_deep.py`：全球指数 + 美港股行情/关键财务 + **估值/分析师/机构持仓（Yahoo quoteSummary，403 回退 v7 quote，再回退东财 PE/PB + GMAININDICATOR 利润率；不把营收/净利当成 PE）** + **三表关键科目/资金流（东财）** + **FINRA 空头成交量/全市场空头榜** + **CBOE 期权 0DTE/异动** + **SEC 申报 / EDGAR Screener / 财报日历** + **美/港涨跌榜（market_stock_list）** + **个股新闻（Yahoo search，crumb 被拦时走 RSS）**。个股页输 `AAPL` / `00700` 即可。
- **美股日 K**：`GET /api/global/us/kline?symbol=AAPL&num=180`（Yahoo，失败回退新浪）；**港股日 K**：`GET /api/global/hk/kline?symbol=00700`（Yahoo query1/query2，403 回退腾讯 ifzq 前复权）。
- **美股页**：观察列表 + K 线 + **EDGAR Screener（S 级）** + 涨跌/空头榜 + 选中标的期权/资金流 + 财报日历 + SEC 日报 + 美债曲线。
- **AI 观察**：`GET /api/ai-watch/openrouter-usage`（需 `OPENROUTER_API_KEY`，无 key 读本地缓存）· `spend-index`（TrakToken RSS）· `aa-models`（可选 `ARTIFICIAL_ANALYSIS_API_KEY`）· `ai-infra`（SEC CapEx + 模型外推）。快照落在 `~/.vibe-research/ai-watch/`。
- **SEC**：设置 `VR_SEC_CONTACT="Name you@example.com"`，否则 SEC 端点返回 503。
- **CBOE 期权**：合规 C 级，仅个人研究；商用须先取得 Cboe 授权。延时数据，不用于实盘下单。
- **韩股**：加 `.KS`（如 `005930.KS`）；仅行情。台股走 ADR（如 `TSM`）。
- **上游**：<https://github.com/simonlin1212/global-stock-data>

### 全球资讯 · investment-news

- 12 赛道 108 个公开 RSS 源，已并入 `backend/newsradar.py` + `backend/news_sources.json`：纯标准库、零 key、已按合规词表过滤（剔除赌 / 预测市场 / 加密等）。
- **上游**：<https://github.com/simonlin1212/investment-news>

### 期权/期货 · OpenVlab

- 接入 [openvlab.cn](https://www.openvlab.cn/market) 的全部公开 REST 接口（无鉴权），并入 `backend/ovlab.py`：
  - **市场概览** `GET /api/ovlab/market` — 全部品种现价 / 涨跌 / 平值隐波 / 隐波百分位 / 22 日实波 / VolAlphaT / Carry / 偏度及百分位 / 主力合约 / 到期日 / 夜盘 / 境外
  - **单品种详情** `GET /api/ovlab/detail?prod_und=510300` — dto（含主力合约月份、希腊字母、隐波曲线、各合约报价）
  - **期权波动率期限结构** `GET /api/ovlab/volatility-ts`
  - **期货期限结构** `GET /api/ovlab/future-ts-all` · `GET /api/ovlab/future-ts?prod_und=MA`
  - **异动榜** `GET /api/ovlab/flow-alert` — 合约 / 触发规则 / 价格 / 涨跌 / 持仓量 / 窗口成交量 / 权利金
  - **资金流** `POST /api/ovlab/flow-data` — 分页资金流
  - **持仓历史** `POST /api/ovlab/warehouse-history` — 单品种多年持仓（year2013~2026 + ratioData），仓差 / 季节性分析
  - **季节性持仓** `POST /api/ovlab/warehouse-seasonal` — 全品种按年份分组的持仓，季节性规律研究
  - **K 线 / 价格波动率** `POST /api/ovlab/last-bars` · `POST /api/ovlab/price-volatility-series`（body: `{codes: ["MA:202609", ...]}`，返回当日分时价格+隐波序列；市场概览「走势」列同源，缓存 5 分钟）
  - **轻量行情图表**（移植自 `/chart/light`）`GET /api/ovlab/kline-history?symbol=SC2609&resolution=1D`（K 线 OHLC + 持仓 + 成交量）· `GET /api/ovlab/atmvol-history`（ATM 隐含波动率历史）· `GET /api/ovlab/last-bar?code=SC2609`（实时最新 bar）· `GET /api/ovlab/search-symbols?keyword=SC`（标的搜索）· `GET /api/ovlab/symbol-info?code=SC2609`（合约元信息：交易时段 / 价格精度 / 到期日）· `GET /api/ovlab/volatility-surface?product=SC`（波动率曲面）· `POST /api/ovlab/skewmap`（偏度图）· `GET /api/ovlab/surfacemap`（曲面图）
  - **持仓排名**（移植自 `/flow/option-flow`、`/future/position-ranking`）`GET /api/ovlab/option-position-products`（期权持仓品种列表）· `GET /api/ovlab/option-position-details?product=IO&code=IO2608&direction=C&day=2026-07-03`（期权持仓明细，方向 C/P）· `GET /api/ovlab/future-position-products`（期货持仓品种列表）· `GET /api/ovlab/future-position-details?product=RB&code=rb2608&direction=0&day=2026-08-03`（期货持仓明细：买方/卖方/净多/净空 4 张期货公司持仓排名表 + 增减 + 净多/净空第一）
  - **异动资金流** `POST /api/ovlab/flow-data`（期权异动明细分页：合约/最新价/涨跌幅/持仓量/持仓变化/成交量/成交额/买卖盘占比/OTM/DTE，可按品种筛选，不缓存）
  - **元数据** `GET /api/ovlab/product-exps`（合约月份）· `/exchange-info` · `/sector-info` · `/next-trading-day` · `/holidays?exchange=CZCE` · `/expired?prod_und=510300`
- 前端「期权/期货」页 8 个 tab：市场概览（含**走势预览**列：价格+隐波分时叠加迷你图，悬停放大，对齐 [openvlab.cn/market](https://www.openvlab.cn/market)）/ 单品种详情 / **轻量图表**（K 线主图 + ATM 隐波副图 + 实时刷新 + 周期切换）/ **T型报价**（期权链买卖价/最新价/涨跌幅）/ 异动榜 / **异动资金流**（期权异动明细分页表，持仓变化/买卖盘占比）/ 持仓历史 / **持仓排名**（期货/期权持仓排名榜，期货公司持仓 + 增减 + 净多/净空第一）。AI 工具层（`tools.py`）注册 14 个 `query_ovlab_*` 工具（含波动率/期货期限结构、K线/ATM隐波、合约搜索、资金流、波动率曲面，前端虽部分未展示但 AI 可查），问 AI / MCP 均可调用。缓存分层：行情/概览 5 分钟、走势预览序列 5 分钟、波动率曲面 2 分钟、合约搜索 60 秒、合约元信息/到期月份 30 分钟、交易所/板块/节假日 1 小时、实时 K 线 / 最新 bar / flow-data 不缓存。**只客观呈现公开数据，不推荐、不预测、不评分。**

> 数据均来自公开源。Vibe-Research 只做客观信息整理与公开榜单呈现（连板股 / 成交额榜等，与东财 / 同花顺同款客观数据），**只呈现事实、不推荐个股、不预测涨跌、不给买卖时机、不做主观评分**；用这些数据做什么分析、看什么方向，由你和你自己的 AI 决定。

## 架构

一套数据层 + 两条 AI 出口：

```
Vibe-Research/
├── a-stock-data/      A 股全栈数据工具箱（数据源，v3.6.0，自带即用）
├── global-stock-data/ 美股 / 港股数据工具箱（数据源，v2.0.3，自带即用）
├── backend/           FastAPI :8900
│   ├── astock.py        A 股数据（移植自 a-stock-data）
│   ├── gstock.py        美股 / 港股行情与关键财务
│   ├── gstock_deep.py   估值/三表/资金流/SEC/空头/财报日历
│   ├── ai_watch/        AI 观察：OpenRouter / TTSI / AA / 基建 ROI
│   ├── newsradar.py     资讯雷达（移植自 investment-news）
│   ├── market.py        市场情绪 + 板块资金流 + 全球指数
│   ├── ovlab.py         期权 / 期货波动率（移植自 openvlab.cn 爬虫）
│   ├── portfolio.py     A 股持仓 + 已清仓（存本地用户目录）
│   ├── ctp_account.py   期货 CTP 只读查资金/持仓（可选 openctp-ctp）
│   ├── tools.py         AI 工具层（48 个数据工具，chat / MCP 共用）
│   ├── chat.py          系统 AI（OpenAI 兼容 function-calling）
│   ├── reflection.py    反思审计（对已有分析做推理审计）
│   └── mcp_server.py    MCP server（给 Claude Code 等 agent）
└── frontend/          Vite + React 19 + TS + Tailwind（深蓝青驾驶舱）:5899
```

**分级依赖**：行情（腾讯）+ 研报 / 公告（东财）**秒装可用**；akshare / mootdx 惰性导入，缺失时对应端点返回 501 + 安装提示，不拖垮服务。

## 快速开始

### Windows（双击 bat，无需 venv）

分别双击项目根目录下的两个脚本（各开一个窗口）：

- `start-backend.bat` — 后端 `:8900`（系统 Python 直接装依赖并启动）
- `start-frontend.bat` — 前端 `:5899`（缺 `node_modules` 时自动 `npm install`）

浏览器打开 http://localhost:5899

### macOS / Linux

```bash
# 后端（:8900）
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8900

# 前端（:5899）
cd frontend && npm install && npm run dev
# 浏览器打开 http://localhost:5899
```

### 服务器部署 / 自动更新

- 手动：`bash deploy/update.sh`（参数见脚本注释）
- systemd 首次安装：`bash deploy/install-systemd.sh`
- **GitHub Actions 自动部署**（push `main` → SSH → pull + update）：见 [`deploy/README.md`](deploy/README.md)

默认假定 `VR_PYTHON=/root/miniconda3/bin/python`、目录 `/root/Vibe-Research-main`。

## 接入 AI

在「接入 AI」页配置一次，全站的「问 AI / 复盘 / 今日要点」就都用你自己的模型。**分析都由你的模型给出，本产品不校准、无倾向。** 三种方式：

### 1. 订阅接入（调本机已登录的 CLI，免 API key）

用你自己的**订阅额度**，不用付 API 费。已支持：**Claude Code · Codex · Qwen Code · DeepSeek CLI**。

- **前提**：① 后端跑在你本机（云端读不到你本机 CLI）；② 对应 CLI 已安装并登录，命令在 `PATH` 上。例如：
  - Claude Code：`npm i -g @anthropic-ai/claude-code` → `claude`（用 Claude 订阅登录）
  - Codex：装 OpenAI Codex CLI → `codex login`（用 ChatGPT 订阅）
  - Qwen / DeepSeek：装各自 CLI 并登录
- 在「接入 AI 页 → 订阅接入」选一个即可，**无需填 key**。
- 原理：后端 `cli_runtime.py` 检测本机命令并 `spawn` 它一次性作答（数据已在提示词里）。⚠️ CLI 不做多轮工具调用，适合「复盘 / 今日要点 / 个股页问 AI」这类**数据已备好**的场景；要 AI 自己现场调数据工具的自由问答，用下面的「API 接入」。

### 2. API 接入（填自己的 key）

「接入 AI 页 → API 接入」选一个模型，**baseURL 自动填好**，只需粘 key。内置 **DeepSeek / 豆包 / MiniMax / OpenAI / OpenRouter / Groq / Together / MiMo / 任意 OpenAI 兼容端点**。这条支持 function-calling——AI 会自己调数据工具（行情/估值/研报/新闻）再作答。key 只存你本地浏览器、随请求发给你自己的后端、不上传、不进仓库。

### 3. MCP（给 Claude Code / 高手 agent）

把后端挂成 MCP server，agent 用自己的订阅额度调 Vibe-Research 的数据工具、多步分析。命令见 [`backend/README.md`](backend/README.md)。要更全量的 A 股数据端点，用根目录 [`a-stock-data/`](a-stock-data/SKILL.md) 工具箱。

## 反思审计

对一段已写好的分析做推理审计，挑出「听起来合理但没有依据」的部分。
实测能揪出诸如「获得机构广泛认可」（用三家推断整体）、「频繁上调预期」（未量化）这类似是而非的表述。

开销小——**只有 1 次模型调用**，输入就是你选中的那段文本（超过 1.2 万字会自动截断并提示）。产物是「怎么继续验证」，不是买卖结论。

## 测试

```bash
cd backend && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -m "not live"   # 离线单测 + API 校验（快、稳，无需联网）
.venv/bin/pytest -m live          # 联网核对数据源 shape（升级 / 发布前跑一遍）
```

## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)。版本号唯一来源是 `frontend/package.json`，后端 API / 前端界面 / MCP `serverInfo` 全部从它读取。

## 合规

- 只做客观数据整理与公开榜单呈现：**不荐股、不预测涨跌、不给买卖时机、不承诺收益、不做主观评分**；中立无倾向。
- 连板股 / 成交额榜等均为**客观公开榜单数据**（东财 / 同花顺同款），产品只如实呈现、不附带任何推荐或预测。
- 所有分析方向由你自己配置的 AI 给出，与本产品无关。UI 无买卖按钮；估值历史分位只标位置、不划买卖线。
- **持仓 / 关注股 / 上传的研报 / API key 只存本地，不上传、不进仓库。**
- 持仓与上传的研报默认存在**用户目录 `~/.vibe-research/`**（可用环境变量 `VR_DATA_DIR` 换根目录、`VR_REPORTS_DIR` 单独指定研报目录）——在项目文件夹之外，**重新下载 / 覆盖更新项目文件夹不会丢数据**；旧版本存在 `backend/.cache/` 的数据，新版首次启动自动迁移（复制，原文件保留）。

## 相关生态

Vibe-Research 用到的数据 / 工具，来自同一套自研开源体系（都在 [`simonlin1212`](https://github.com/simonlin1212)）：

| 仓库 | 定位 |
|---|---|
| [**a-stock-data**](https://github.com/simonlin1212/a-stock-data) | A 股全栈数据工具包（10 层 · 44 端点 · 15 数据源）—— 本项目的 A 股数据引擎 |
| [**global-stock-data**](https://github.com/simonlin1212/global-stock-data) | 美股 / 港股全栈数据工具包（13 层 · 30+ 端点 · 11 数据源） |
| [**investment-news**](https://github.com/simonlin1212/investment-news) | 全球产业链资讯看板（12 赛道一一对应 A 股板块）—— 本项目的资讯源 |
| [**Agent-Staff**](https://github.com/simonlin1212/Agent-Staff) | 把公司 Agent 化：每部门一个 AI agent + CEO 参谋长，常驻飞书 |

## 联系作者

作者 **Simon**，独立开发者。

- 🐦 X：[@linsizhen](https://x.com/linsizhen)
- ✉️ 邮箱：<simonlin0423@gmail.com>
- 💬 欢迎交流**企业 AI 落地方案**；项目相关问题也可提 [Issue](https://github.com/simonlin1212/Vibe-Research/issues)。

## 致谢

- A 股数据引擎：[a-stock-data](https://github.com/simonlin1212/a-stock-data)（作者：Simonlin1212）
- 美股 / 港股数据引擎：[global-stock-data](https://github.com/simonlin1212/global-stock-data)（作者：Simonlin1212）
- 资讯：[investment-news](https://github.com/simonlin1212/investment-news)（作者：Simonlin1212）
- 界面设计语言参考并致谢：[HKUDS/Vibe-Trading](https://github.com/HKUDS/Vibe-Trading)（作者：HKUDS · 仅借鉴 UI，底层为全新实现）

## 免责声明

本项目仅供学习与研究，**不构成任何投资建议**。看板只做客观数据整理与公开榜单呈现——不推荐个股、不预测涨跌、不给买卖时机、不承诺收益；所有分析方向由你自己配置的 AI 给出，与本产品无关。股市有风险，请独立决策、自行核实，风险自担。

## License

MIT
