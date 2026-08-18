# Vibe-Research

个人一站式投研平台：把公开行情和复盘材料配齐，结论由使用者自己的 AI 写。

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
驾驶舱那 17 个指数（含中证500 `sh000905`、中证1000 `sh000852`、日经225 `jpN225`、韩国KOSPI `ksKOSPI`）的唯一名单。复盘快照、报价中心、问 AI 工具都认这份。恒生 / 恒科 / 日经 / KOSPI 画在宏观观察「标的」格、纳指期货下面，不另开名单。纳指期货 NQ 是 `hf_NQ`，比特币是新浪 `hf_BTC`（期货 CFD），都不进指数目录。
入口: `backend/index_catalog.py`。前端 `frontend/src/config/cockpit.ts` 的 `WORLD_INDEX_DEFS` 必须同序同码。
`astock.A_INDICES`、`cockpit_live.WORLD_INDICES` 从这里来。
_Avoid_: A_INDICES, WORLD_INDICES, WORLD_INDEX_DEFS（实现名，不是领域名）

**衍生目录**:
期权驾驶舱首屏要画的国内品种唯一名单（21 个：股指 IO/HO/MO、ETF 期权 5 个、商品期权 13 个），码是 OpenVlab `ctamap-all` 的 `product`，按活数据校准（无国债、无 HC）。预热不进复盘清单。
入口: `backend/deriv_catalog.py`。前端 `frontend/src/config/deriv.ts` 的 `DERIV_DEFS` 必须同序同码。
_Avoid_: 第二份品种 JSON, 把 OpenVlab 塞进 review_jobs / 报价中心

**期权驾驶舱**:
`/derivatives` 默认那一屏（顶栏紧挨 A 股；旧 `/ovlab` 书签 301 过来，查询串保留）。格子从 `GET /api/ovlab/market`（钥匙 `ovlab_market`）筛衍生目录，异动走 `ovlab_flow_alert`（对齐 [openvlab.cn/flow/option-flow](https://www.openvlab.cn/flow/option-flow)：表列时间/合约/成交异动·走势异动·连续成交/剩余天数/区间涨幅/区间成交量；阈值本机 `deriv.alertThresh`：三类可关，成交异动默认额10万或量100手（下限1万/50手），走势异动默认1分钟涨幅20%且额1万（额下限1000），连续成交默认2秒额5万（下限5万），不另开轮询；盘中钥匙 `ovlab_flow_alert` 60s 过期重取，休市冻结），迷你走势只对可见目录码调 `price-volatility-series`。首行：**行情观察**主卡一张竖表（股指+商品主力，默认股指在上，点列头整表排序，含隐波/IV分位色带/溢价）| 临期期权日历 | **期限结构** | 异动。卡内 tab 切自选合约（`WatchPanel`，本机 `deriv.watch`）与「指数」（`ThsCmdIndexPanel`：同花顺商品指数 850xxx 快照+分钟分时，名单 `frontend/src/config/thsCmdIndex.ts`，走 `GET /api/ths`，不进指数目录/衍生目录/报价中心）；临期日历走 `product-exps` 月历，只画当前查看月且未过期，切月看远月，格子标交易所短名，点/悬停列出当日标的；手机全宽叠卡。第二行留给 **T 型报价联动区**（`TQuotePanel` 占主宽度 + 右侧一小条上下叠日K/分时）：点「行情观察」的品种行切 T 型报价品种并在右下出该标的日K/分时（行上的合约码仍是跳 K线页；T 表换月不覆盖标的图）；T 表与期限结构品种下拉可搜代码/名称（本地过滤，不另轮询）；换品种/到期月默认 ATM 购出图，点 T 表某档 Call/Put 切该期权合约图。T 表默认全部行权价（从上到下降序，点行权价列头切升序），可关「隐藏实值」（只藏实值侧格子，ATM 两边都留，本机 `deriv.tquote.hideItm`），IV 相对 ATM 着色、持仓为相对可见档最大仓的半透明横条（购向右/沽向左）、最大持仓档标「仓」；品种下拉旁大号显示标的最新价/涨跌（复用行情观察 `ovlab_market` 同快照，不另轮询）；概览含当月远期涨跌 / ATM隐波 / PCR / 购沽持仓 / 偏度 / 预期波动。T 表 ← `GET /api/ovlab/tquote?product=`：`volatility-surface` 按到期月解析出行权价链（IV 买卖/理论 IV/Delta/持仓），价格列是 Black-76 理论价（theoIv+forward 反推，平价关系自洽），旁标相对昨理论价涨幅（昨=forward_yd+theovol_yday 同式反推，不另开接口），每档带 `callCode/putCode`（`{prod}{exp[2:]}{C/P}{strike:g}`，全交易所+ETF 实测通用），每月带 `und`（期货期权 `{prod}{ym}`，ETF 用基金代码）。股指（IF/IH/IM）近月上游往往只给 ATM 附近几档，T 表按已有间距把梯子补到约 ±15% / 至少 25 档，翼侧 IV 用微笑插值（不另开接口）。**期权日K** ← `GET /api/ovlab/option-daily?code=&und=`：OpenVlab `history` 对期权码分钟级给真值（历史段约小时级快照、当日 1 分钟），后端按交易日聚合 OHLCV（夜盘 >=20 点归次交易日、凌晨 <6 点归前一晚的次交易日、周末顺延，`_trading_day`），IV 叠加标的历史隐波日线（`history-atmvol`，ETF 无则空）；缓存 5min 随时段冻结。**期权分时** ← 前端直拉 `history`+`history-atmvol`（期权码，当日分钟），零轴=分钟 pct 字段反推昨结，图上叠成交量；X 轴铺满当日交易时段槽位（ETF/股指日盘 09:30-15:00，商品 09:00-15:00 跳 10:15 休，有夜盘再加 21:00 起），未到时刻空着，开盘不拉满整宽；十字光标读价/IV/量（类目轴走 dataIndex，不能把 value 当数字下标）。注意：last-bar 对期权码回退标的期货（所以自选/行情不用它画期权），`surface` 字段偶发 `"nan"` 字符串，`_sfloat` 必须挡非有限值否则响应 JSON 序列化 500（EG 实盘踩过）。内页签只有 K线（`?tab=kline`：`DerivLightChart`，A股轻量图同口径：自选合约列表、分时零轴=last-bar `pre_close`、5日零轴=首笔，叠 ATM隐波/持仓量）。旧书签 `?tab=detail/quote/flow` 回到驾驶舱。CTP 账户数据不进这一页（留在 /portfolio）。**期限结构卡** ← `GET /api/ovlab/term-structure?products=`：`volatility-surface` 的 `forward_td/yd` 按到期月抽成远期曲线（并发拉取+缓存 60s 随时段冻结），覆盖**全市场 domestic 品种**（75 个，无期权的上游返回空自动不进曲线），上部下拉选品种（可搜），今实线/昨虚线与持仓柱叠同一图（左轴价、右轴仓），今曲线点上标现值/涨幅（涨幅=(今-昨)/昨，红涨绿跌）。期货走 `GET /api/ovlab/future-ts?prod_und=`（上游 `future-ts/{prodUnd}` 的 `future_tday/yday` + `oi_tday`，对齐 [openvlab.cn/future/term-structure](https://www.openvlab.cn/future/term-structure)）；ETF 无此接口，退回 surface Call+Put。同卡叠该品种**仓单**（最新/日变/近90日折线，品种下拉正下方常显）：`GET /api/ovlab/warehouse-receipt?product=`，上游 `warehouse/history` 同一把钥匙 `ovlab_wh_history`（对齐 [openvlab.cn/future/warehouse-receipt](https://www.openvlab.cn/future/warehouse-receipt)），不另开缓存；有品种无点仍回 `{product, last:null}`（空 `{}` 会让前端一直转圈）；默认选第一个有仓单的商品（不默认股指）；股指/ETF 标「无仓单」。品种选择只在本格内，不跟 T 型报价联动；上游 `future-ts-all` 只覆盖 6 个品种，单品种 `future-ts/{prodUnd}` 才有全月份持仓。
ovlab 缓存随交易时段：盘中过期重取、上游失败回落上一笔；休市（盘后/午休/周末）冻结只喂上一笔，冷键放行一次。后端启动 `ovlab.warm_once` 填一次首屏钥匙（market / flow-alert / product-exps / future-ts-all / 目录码分时）。时段窗口前后端各一份（`ovlab.deriv_market_open` / `derivShared.derivSession`），改窗口两边同步。
入口: `frontend/src/pages/DerivCockpit.tsx` + `frontend/src/hooks/useDerivData.ts` + `frontend/src/components/deriv/`。
_Avoid_: 第二条 /api/ovlab/market 轮询, 同一屏两条分时源（新浪 commodity-minutes 不进这页）, CTP 接口

**同花顺行情**:
fuyao 网关（`quota-h.10jqka.com.cn`）的快照 / 日 K / 分钟线：股票（沪 17 深 33）、指数（沪 16 深 32）、同花顺指数（64，含商品 850xxx）、板块（48）。免鉴权，Referer 必须带 stockpage 代码路径，裸域名 403。字段是数字 ID；涨跌幅不取上游 199112（语义随市场漂移），由 最新/昨收 现算。不进报价中心、不进复盘清单，是独立数据源。
入口: `backend/ths_quote.py`；HTTP `GET /api/ths/snapshot` · `GET /api/ths/kline`（period: day_1/min_1/min_5）。期权驾驶舱行情观察「指数」tab 挂这份快照+分钟线。
_Avoid_: hexin-v 逆向, 第二条报价轮询, 199112 当统一涨跌幅

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
全 A 当日价 / 涨跌 / PE / PB / 市值 / 换手 + 行业概念。给选股用，先数据层。
入口: `backend/screener_snap.py`。180 秒一把钥匙。打腾讯不写报价中心 5 秒缓存。不进复盘预热，不加 HTTP。
_Avoid_: 第二把全 A 估值钥匙, 预热里拉 5000 只

**全 A 库存**:
标的池近 3 年已收盘日 K（和回测最长 lookback 同一窗口）。原始 OHLC 与复权因子仍写 `VR_DATA_DIR/market/`，和回测同一仓。
入口: `backend/backtest/universe_sync.py`（`STORE_LOOKBACK` / `LOOKBACKS`）。数据页看覆盖，点一次补齐；已齐的跳过，收盘后同一按钮做增量。命令行同一条路: `python backend/fill_2y_bars.py`（可 `--index sh000905` 或跟 6 位代码）。只写已收盘 bar。不清库。不进复盘预热、不进报价中心。
_Avoid_: 第二套 parquet 目录, 盘后 enriched 管道, 启动就扫 5000 只, 同步按钮墙

**缓存键**:
同一份数只用一把钥匙。`TTLCache` 有效值过期不删，留作上一笔：`get()` 只认热槽，`get_last()` 可读上一笔，`get_or_set(serve_last=True)` 第一次填过之后不再出网。空结果仍是短负缓存，过期就扔，不留下一笔。
HTTP `_dc` 默认上一笔。过期再拉只走 `_cached`：自选分时 / 五日和日 K、点开的板块成分、概念板块、涨跌幅榜、直播快讯、分钟资金流、搜索联想。钟养的格子预热 `_put` / `put_fetch` 强制写。个股 F10（估值分位 / 公告 / 财务 / 基本资料 / 公司财报包等）、ovlab、fino、gstock 解析也走上一笔。
全球指数是 `("world_indices", "live")`；总览 / 情绪 / 成交额榜也挂这套，不另开 `market._CACHE`。
_Avoid_: 第二份 TTL、market._CACHE 再包一层、过期就打上游、旁路第二份 last dict、路由按键名写 last=、F10 再开三份 TTLCache

**问 AI**:
使用者把自己的模型接到复盘页。复盘上下文和数据工具走现有入口。
_Avoid_: chat widget, LLM service

**交易日历**:
A 股这一天开不开市。复盘邮件、预热、网页报价中心/分时中心的休市间隔只问这个，不各自判 weekday。
入口: `backend/trading_calendar.py`。`is_cn_trading_day()` 不打网上游；后台刷新上证日 K 日期（东财 push2his，挂了走 push2delay，再挂走已有 `astock.daily_bars("sh000001")`）。网页读预热状态的 `trading_day`。
回测加减交易日也走这里: `day_shift` / `floor_day` / `ceiling_day` / `count_day_frames`，用同一份日期集，不另开日历表。
拿不到日历或日期超出覆盖：只判周末。
_Avoid_: 第二份 weekday 列表、akshare 日历、Omicron / 第二套 int 日期表

**回测**:
自选 / 持仓的日线账户模拟。信号日不等于成交日。默认次日开盘。一笔共享现金。T+1、整手 100、佣金双边、印花税只卖。涨跌停看成交价对昨收带宽。净值只从现金+市值来。
行情: `VR_DATA_DIR/market/` 分区 parquet（原始 OHLC 与复权因子分开），内存 DuckDB / Polars 查，不建 `.db`。只写已收盘 bar（`trading_calendar.last_closed_session`，15:00）。
成分股按日快照（中证调整公告写入变动日，`members_on(asof)` 取 `<= asof` 最新一张）。财务用 `(start, end)` + 公告日，东财 F10 `NOTICE_DATE` 入库 `np` / `revenue` / `roe`。自选默认仍是静态池；勾选按日成分才回放。沪深300 基准有覆盖时是等权可交易账户（同一套撮合），没有快照才退回指数价格比。北交所 920 涨跌停按 30%。
实验: `VR_DATA_DIR/backtest/runs/<id>/` 写完不改。账户写 config / 成交 / 净值；因子写 config / factor.json；模型写 config / model.json，可带成交 / 净值。`meta.kind` 区分 account / factor / model。作业先同步；要排队再加 `jobs.json`，不上 SQLite。
入口: `backend/backtest/`；HTTP `GET /api/backtest/meta` · `GET /api/backtest/progress` · `GET /api/backtest/index-pool` · `POST /api/backtest/run` · `POST /api/backtest/factor` · `POST /api/backtest/factor/compare` · `POST /api/backtest/model` · `GET/DELETE /api/backtest/runs` · `GET /api/backtest/store` · `POST /api/backtest/store/members` · `POST /api/backtest/store/fundamentals`。进度在内存里, 网页在跑时轮询, 不是 TickFlow worker/SSE, 不上 jobs.json。网页 `/backtest`（账户 / 因子 / 模型）· `/data`。日 K 走 `astock.daily_bars`（与 `light_kline` 同一腾讯日 K 解析 `_tencent_daily`）。因子从这份日 K 现场算：动量 / RSI / ATR / 量比 / MACD / KDJ / 振幅 + 超额动量 / 动量加速 / 量变 / 量价相关 / 20 日振幅 + 3 条只用 OHLCV 的 WorldQuant 公式。换手率要流通股本，库存没有时算不了。
账户策略: `hold` / `ma_cross` / `dates` / `rank_mom`（换名单、续持不调仓位）/ `top_k`（分数 → 目标权重，续持加减仓）。`top_k` 可开个股上限和行业中性（`ths_ext.profile` 末级；缺归属单独一组，不假装中性）。同一套现金、T+1、整手、涨跌停、次日开盘。模型页把 LightGBM 分数交给 `top_k`；没装 lightgbm 时接口说明。
一键导入指数成分：东财最新名单写入 `market/members/`，并拉中证调整公告按变动日补快照（`GET /api/backtest/index-pool?history=1`）。表单填的仍是最新名单（静态池，有幸存者偏差）；勾选按日成分才用 `members_on` 回放。
本机数据页看日历 / 标的池日 K / 按日成分 / 财务 PIT / 实验。可点补齐近 3 年、按日成分、财务 PIT，只写已收盘 bar，不清库。回测页 `GET /api/backtest/store?codes=` 看这批齐不齐，缺的跑的时候现拉。`POST /api/backtest/store/members` · `POST /api/backtest/store/fundamentals`。回测优先读库存，缺的再补。
问 AI 工具 `run_backtest` 读成交摘要和净值。
样本外: 参数只在切点前选；`stats_oos_fresh` 是切点后新开的一笔钱（均线仍用切点前历史）。滚动切窗每折新开账户，开着时不再叠单点切窗。回看账户实验用本机 parquet 对 `data_hash`（超过 40 只跳过，避免打开卡死服务）；因子回看只读落盘结果，不重算哈希。对不上只提示、不改 run。持仓页「回测这些」进 `/backtest?codes=&from=portfolio&autostart=1`。
因子页：Rank IC / Pearson IC / 五档净值 / 多空，可改方向 / 分层 / 等权或因子加权；对照最多 6 个因子。周/月调仓用交易周/月最后一根，不是日历周一或月初。默认剔 ST / 退（今天的名称，有前视）和次新（这段日 K 第一根 bar，面板不够长则跳过）；账户 / 因子 / 模型同一套掩码。财务 PIT 因子（ROE/净利润/营收）按公告日。账户有止损、最长持有、月收益和回撤段、Sortino。均线 / 动量 / 模型网格只在样本内选。模型实验 `kind=model`，分数进同一套撮合。因子 / 模型实验也落 runs/，和账户分开列。写明幸存者偏差。实验条可叠对照；成交按标的汇总；可填回表单再跑。
_Avoid_: 第二条日历, 第二条报价轮询, 重叠持有期×252/horizon 年化, SQLite/.db, 用已跑完净值切窗冒充 walk-forward, 第二份代码名单, 第二份板块 JSON, 第二套行情目录

## 就地改

大文件就地改：`backend/astock.py`、`frontend/src/pages/StockData.tsx`、`frontend/src/pages/CtpPortfolio.tsx`、`frontend/src/lib/api.ts`。

报价中心、分时、快讯三个 hub 各自保留。`CockpitLayout` / `QuoteStockRow` 继续用。

东财 `push2` / `push2delay` 主机轮询只在东财挂了、有的格子活有的死时再动。

## 验分叉

改完按触及面跑，用「会不会再分叉」来验，不单验「函数返回了 dict」。

- 后端：`cd backend && python -m pytest -m "not live"`
- 前端：`cd frontend && npm test` 且 `npx tsc -b`
- 指数目录：`backend/tests/test_index_catalog.py` + `frontend/tests/review-context.test.mjs`
- 衍生目录 / 期权驾驶舱导航：`backend/tests/test_deriv_catalog.py` + `frontend/tests/page-nav.test.mjs`（`/derivatives` 紧挨 `/a-share`，前后端同序同码）
- 同花顺行情：`backend/tests/test_ths_quote.py`（市场码归位、pct 现算、缓存上一笔）+ `frontend/tests/ths-cmd-index.test.mjs`（驾驶舱指数 tab 走 `/api/ths`，不进指数目录/报价中心）
- 报价中心：`frontend/tests/quote-hub.test.mjs`（K 线页 / 自选公告走 `useQuotes`）
- 缓存键：预热填过 `world_indices` 后，`get_global_indices` 不再打上游；热槽过期仍读上一笔（`backend/tests/test_clock_serve.py`、`backend/tests/test_cache.py`）
- 标的池 / 横截面：`backend/tests/test_cross_section.py`（只有 `a-share-codes.json`；快照不写报价 5 秒缓存）
- 全 A 库存：`backend/tests/test_universe_sync.py`（补齐走 `ensure_bars`，已齐跳过，不进预热）
- 因子：`backend/tests/test_backtest_factor.py`（IC / 五档走日 K 面板，不建 enriched；周/月调仓是交易期末）
- 可交易掩码 / 日历加减：`backend/tests/test_backtest_screen.py` · `backend/tests/test_trading_calendar.py`（不引入 Omicron）
- 目标权重 / 模型：`backend/tests/test_backtest_matcher.py` · `backend/tests/test_backtest_model.py`（同一套撮合，不建 .db，不引入 quantide）
- 指数成分导入：`backend/tests/test_backtest_index_pool.py`（今日快照走 members/，fetch 可注入，不扫全 A）
- 按日成分 / 财务 PIT / 可交易基准：`backend/tests/test_backtest_pit.py`（调整公告可注入，不打中证/东财；没有快照时基准才用价格比）
