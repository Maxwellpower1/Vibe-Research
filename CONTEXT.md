# Vibe-Research

个人投研看板：把公开行情和复盘材料配齐，结论由使用者自己的 AI 写。不荐股、不预测。

只改本仓库。未要求不 commit、不 push。答复用中文、人话。少写代码：能挂到已有入口就挂。

加格子、加指数、加给模型看的字段、页面上要显示实时价：先读下面的词，再改对应入口。完成标准：没有第二份名单、第二把缓存钥匙、第二条 `/api/quote` 轮询。README 只写人能点到的页面。

## Language

**复盘快照**:
驾驶舱首屏要画的那几格数字（指数、总览、情绪、行业、龙虎、北向）。按 paint / top / full 分批取。
入口: `backend/review_snapshot.py`（读复盘清单）。
_Avoid_: snapshot payload, BFF, review DTO

**复盘清单**:
「复盘要拉哪些格、走腾讯还是东财、用哪条缓存」的唯一名单。预热、邮件、问 AI 都读这份。
入口: `backend/review_jobs.py`。缓存键与 `GET /api/market/*` 对齐，预热填过的问 AI 再取不再打上游。
_Avoid_: job list, warmup steps, panel catalog

**复盘上下文**:
把复盘数字打成一段给模型看的中文快照。网页问 AI 和定时邮件用同一段，缺的格写「未取到」。
入口: `backend/review_context.py`；HTTP `POST /api/market/review-context`。网页只调 `api.reviewContext`。
加一段给模型看的内容：改这个打包口和 `EXPECTED`。
_Avoid_: prompt packer, reviewContext.ts, system prompt

**指数目录**:
驾驶舱那 14 个指数（含中证500 `sh000905`，不含中证1000 `sh000852`）的唯一名单。复盘快照、报价中心、问 AI 工具都认这份。
入口: `backend/index_catalog.py`。前端 `frontend/src/config/cockpit.ts` 的 `WORLD_INDEX_DEFS` 必须同序同码。
`astock.A_INDICES`、`cockpit_live.WORLD_INDICES` 从这里来。
_Avoid_: A_INDICES, WORLD_INDICES, WORLD_INDEX_DEFS（实现名，不是领域名）

**报价中心**:
网页里全球指数 / 商品 / 自选 / K 线页 / 自选公告表共用的那一份实时报价。开市 5 秒，休市/午休拉长，仍走这里。间隔问 `ashareSession.hubPollMs`（交易日来自预热状态的 `trading_day`）。
入口: `frontend/src/lib/quoteHub.ts` 的 `useQuotes`。字段用 `pct` / `prev` / `turnover`，以及腾讯已有的 `pe_ttm` / `pb` / `mcap_yi`。
`/api/quote` 是遗留 HTTP 适配，新页面订阅报价中心。
_Avoid_: quoteHub, market quotes client, 第二条报价轮询, 休市再写一套间隔

**缓存键**:
同一份数只用 `api_common._cached` 的一把钥匙和 TTL。全球指数是 `("world_indices", "live")`、20 秒；`market.get_global_indices` 与复盘清单共用这把。
统一成调用同一函数之后，看外面有没有第二层 `market._CACHE` 壳。
_Avoid_: 第二份 TTL、market._CACHE 再包一层

**问 AI**:
使用者把自己的模型接到复盘页。产品只提供复盘上下文和只读数据工具，不校准结论。
_Avoid_: chat widget, LLM service

**交易日历**:
A 股这一天开不开市。复盘邮件、预热、网页报价中心/分时中心的休市间隔只问这个，不各自判 weekday。
入口: `backend/trading_calendar.py`。`is_cn_trading_day()` 不打网上游；后台刷新东财上证日 K 日期。网页读预热状态的 `trading_day`。
拿不到日历或日期超出覆盖：只判周末。
_Avoid_: 第二份 weekday 列表、akshare 日历

## 就地改

大文件就地改：`backend/astock.py`、`frontend/src/pages/StockData.tsx`、`frontend/src/pages/CtpPortfolio.tsx`、`frontend/src/lib/api.ts`。

报价中心、分时、快讯三个 hub 各自保留。`CockpitLayout` / `QuoteStockRow` 继续用。

东财 `push2` / `push2delay` 主机轮询只在东财挂了、有的格子活有的死时再动。

## 验分叉

改完按触及面跑，用「会不会再分叉」来验，不单验「函数返回了 dict」。

- 后端：`cd backend && python -m pytest -m "not live"`
- 前端：`cd frontend && npm test` 且 `npx tsc -b`
- 指数目录：`backend/tests/test_index_catalog.py` + `frontend/tests/review-context.test.mjs`
- 报价中心：`frontend/tests/quote-hub.test.mjs`（K 线页 / 自选公告走 `useQuotes`）
- 缓存键：预热填过 `world_indices` 后，`get_global_indices` 不再打上游
