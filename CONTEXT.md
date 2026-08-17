# Vibe-Research

个人一站式投研平台（复盘看板 + 全 A 选股）：把公开行情和复盘材料配齐，结论由使用者自己的 AI 写。不荐股、不预测。

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
`/api/quote` 是遗留 HTTP 适配，新页面订阅报价中心。全 A 横截面不准塞进这里。
_Avoid_: quoteHub, market quotes client, 第二条报价轮询, 休市再写一套间隔, 5000 只进报价中心

**标的池**:
全 A 六位代码的唯一名单。名称写在同一份文件的 `names`，不是第二张 instruments 表。广度、板块轮动、横截面都读这份。
入口: `backend/universe.py`（`load` / `name_map` / `rows` / `search`）。文件 `VR_DATA_DIR/a-share-codes.json`（新浪 `hs_a` 拉满后落下，24h）。
联想走现有 `GET /api/fin/suggest`：先扫这份（代码/名称前缀 → 拼音首字母 → 包含），空了再腾讯智能框。搜索读过期名单，24h 只卡广度。名单进进程内存、拼音预热一次，不是第二份表。名称不够厚时非数字查询直接走腾讯，避免本地落空再打一枪。
_Avoid_: 第二份代码名单, a-share-codes 再写一处, TickFlow instruments parquet / DuckDB 维表, 第二条搜索 HTTP

**板块归属**:
shy313 概念/行业快照，给横截面 JOIN、个股 profile、轮动反查。
入口: `backend/ths_ext.py`。文件 `VR_DATA_DIR/ths-ext.json`（24h）。不是 TickFlow 式同步/清库。
_Avoid_: 第二份板块 JSON, parquet 扩展表, 数据页同步按钮

**横截面快照**:
全 A 当日价 / 涨跌 / PE / PB / 市值 / 换手 + 行业概念。给二期选股页用，先数据层。
入口: `backend/screener_snap.py`。180 秒一把钥匙。打腾讯不写报价中心 5 秒缓存。不进复盘预热，不加 HTTP。
_Avoid_: 第二把全 A 估值钥匙, 预热里拉 5000 只, 选股页还没做先写 README

**全 A 库存**:
标的池近 2 年已收盘日 K。原始 OHLC 与复权因子仍写 `VR_DATA_DIR/market/`，和回测同一仓。
入口: `backend/backtest/universe_sync.py`。数据页看覆盖，点一次补齐；已齐的跳过，收盘后同一按钮做增量。命令行同一条路: `python backend/fill_2y_bars.py`（可 `--index sh000905` 或跟 6 位代码）。只写已收盘 bar。不算 TickFlow enriched，不清库。不进复盘预热、不进报价中心。
_Avoid_: 第二套 parquet 目录, 盘后 enriched 管道, 启动就扫 5000 只, 同步按钮墙

**缓存键**:
同一份数只用 `api_common._cached` 的一把钥匙和 TTL。全球指数是 `("world_indices", "live")`、20 秒；`market.get_global_indices` 与复盘清单共用这把。
统一成调用同一函数之后，看外面有没有第二层 `market._CACHE` 壳。
_Avoid_: 第二份 TTL、market._CACHE 再包一层

**问 AI**:
使用者把自己的模型接到复盘页。产品只提供复盘上下文和只读数据工具，不校准结论。
_Avoid_: chat widget, LLM service

**交易日历**:
A 股这一天开不开市。复盘邮件、预热、网页报价中心/分时中心的休市间隔只问这个，不各自判 weekday。
入口: `backend/trading_calendar.py`。`is_cn_trading_day()` 不打网上游；后台刷新上证日 K 日期（东财 push2his，挂了走 push2delay，再挂走已有 `astock.daily_bars("sh000001")`）。网页读预热状态的 `trading_day`。
拿不到日历或日期超出覆盖：只判周末。
_Avoid_: 第二份 weekday 列表、akshare 日历

**回测**:
自选 / 持仓的日线账户模拟。信号日不等于成交日。默认次日开盘。一笔共享现金。T+1、整手 100、佣金双边、印花税只卖。涨跌停看成交价对昨收带宽。净值只从现金+市值来。
行情: `VR_DATA_DIR/market/` 分区 parquet（原始 OHLC 与复权因子分开），内存 DuckDB / Polars 查，不建 `.db`。只写已收盘 bar（`trading_calendar.last_closed_session`，15:00）。
成分股按日快照（中证调整公告写入变动日，`members_on(asof)` 取 `<= asof` 最新一张）。财务用 `(start, end)` + 公告日，东财 F10 `NOTICE_DATE` 入库 `np` / `revenue` / `roe`。自选默认仍是静态池；勾选按日成分才回放。沪深300 基准有覆盖时是等权可交易账户（同一套撮合），没有快照才退回指数价格比。北交所 920 涨跌停按 30%。
实验: `VR_DATA_DIR/backtest/runs/<id>/` 写完不改。账户写 config / 成交 / 净值；因子写 config / factor.json。`meta.kind` 区分 account / factor。作业先同步；要排队再加 `jobs.json`，不上 SQLite。
入口: `backend/backtest/`；HTTP `GET /api/backtest/meta` · `GET /api/backtest/progress` · `GET /api/backtest/index-pool` · `POST /api/backtest/run` · `POST /api/backtest/factor` · `POST /api/backtest/factor/compare` · `GET/DELETE /api/backtest/runs` · `GET /api/backtest/store` · `POST /api/backtest/store/members` · `POST /api/backtest/store/fundamentals`。进度在内存里, 网页在跑时轮询, 不是 TickFlow worker/SSE, 不上 jobs.json。网页 `/backtest`（账户 / 因子）· `/data`。日 K 走 `astock.daily_bars`（与 `light_kline` 同一腾讯日 K 解析 `_tencent_daily`）。因子从这份日 K 现场算：TickFlow 那组技术因子（动量 / RSI / ATR / 量比 / MACD / KDJ / 振幅）+ 3 条只用 OHLCV 的 WorldQuant 公式。换手率要流通股本，库存没有，不加。不做 TickFlow enriched，不上 460 条整库 Alpha Zoo。
一键导入指数成分：东财最新名单写入 `market/members/`，并拉中证调整公告按变动日补快照（`GET /api/backtest/index-pool?history=1`）。账户 / 因子硬顶 600，中证500 能一次进完。不是无上限：全 A 五千只同步跑会打挂，V1 也不做每天重选全 A。表单填的仍是最新名单（静态池，有幸存者偏差）；勾选按日成分才用 `members_on` 回放。不是 TickFlow 命名池直接当回测宇宙。
本机数据页看日历 / 标的池日 K / 按日成分 / 财务 PIT / 实验。可点补齐近 2 年、按日成分、财务 PIT，只写已收盘 bar，不算 enriched，不清库。回测页 `GET /api/backtest/store?codes=` 看这批齐不齐，缺的跑的时候现拉。`POST /api/backtest/store/members` · `POST /api/backtest/store/fundamentals`。
问 AI 工具 `run_backtest` 只读成交摘要和净值，不校准该不该买。
样本外: 参数只在切点前选；`stats_oos_fresh` 是切点后新开的一笔钱（均线仍用切点前历史）。滚动切窗每折新开账户，开着时不再叠单点切窗。回看账户实验用本机 parquet 对 `data_hash`（超过 40 只跳过，避免打开卡死服务）；因子回看只读落盘结果，不重算哈希。对不上只提示、不改 run。持仓页「回测这些」进 `/backtest?codes=&from=portfolio&autostart=1`。
V1 做: 全 A 横截面数据层 + 标的池近 2 年日 K 库存。回测优先读这份库存，缺的再补；账户 / 因子硬顶 600（够中证500，不是全 A）。静态池可做动量轮动。因子页：Rank IC / 五档净值 / 多空，可改方向 / 分层 / 等权或因子加权；对照最多 6 个因子。财务 PIT 因子（ROE/净利润/营收）按公告日。账户有止损、最长持有、月收益和回撤段。均线 / 动量窗口只在样本内选。因子实验也落 runs/，和账户分开列。写明幸存者偏差。实验条可叠对照；成交按标的汇总；可填回表单再跑。
V1 不做: TickFlow enriched、整库 Alpha Zoo（460）、全样本网格搜参、分钟成交、监控中心、LLM 荐股胜率、选股页、每天重选的全 A 策略组合回测。
_Avoid_: vectorbt, Backtrader, 第二条日历, 第二条报价轮询, 重叠持有期×252/horizon 年化, SQLite/.db, 用已跑完净值切窗冒充 walk-forward, TickFlow 式盘后 enriched/清库, 第二份代码名单, 第二份板块 JSON, 第二套行情目录

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
- 标的池 / 横截面：`backend/tests/test_cross_section.py`（只有 `a-share-codes.json`；快照不写报价 5 秒缓存）
- 全 A 库存：`backend/tests/test_universe_sync.py`（补齐走 `ensure_bars`，已齐跳过，不进预热）
- 因子：`backend/tests/test_backtest_factor.py`（IC / 五档走日 K 面板，不建 enriched）
- 指数成分导入：`backend/tests/test_backtest_index_pool.py`（今日快照走 members/，fetch 可注入，不扫全 A）
- 按日成分 / 财务 PIT / 可交易基准：`backend/tests/test_backtest_pit.py`（调整公告可注入，不打中证/东财；没有快照时基准才用价格比）
