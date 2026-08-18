# Changelog

本项目的版本号唯一来源是 `frontend/package.json`；后端 HTTP API、`/api/health`、
前端界面与 MCP `serverInfo` 全部从它读取（见 `backend/version.py`）。

## Unreleased

### 改进：路由默认上一笔，少数键显式再拉

`_dc` 默认 `last=True`。路由不再按键名写 `last=`。过期再拉只留 `_cached`：自选分时 / 五日和日 K、板块成分、概念板块、涨跌幅榜、直播快讯、分钟资金流、搜索联想。

### 改进：钟养的格子 HTTP 只读上一笔

驾驶舱固定键（指数目录报价和分时、商品、行业板块 80、成交额榜、主力净流入、板块资金、北向、总览、情绪、资金页那几把、快讯 40）由预热钟强制写。网页再问只读热槽或上一笔，过期不再打腾讯/东财。自选、点开的成分、五日/日 K、概念 120、涨跌幅榜仍是第一次拉。资金流预热钥匙改成网页同一把 `ALL:15`。

### 改进：上一笔收进 TTLCache

有效值过期不再删。个股 F10、ovlab、fino、gstock 解析第一次拉过之后过期只读上一笔。自选分时和报价热槽过期仍可再拉。F10 三份缓存和 `market._CACHE` 收进同一把 `_DC_CACHE`；HTTP 用 `_dc(..., last=)` 区分只读上一笔和过期再拉。

### 改进：去掉右下角悬浮球

快讯只在复盘快讯格里看，不再挂整站未读角标球。

### 改进：少打一遍上游

整页预热不再 get_or_set 商品（只强制写那一把）。问 AI 自选读报价中心。问 AI 工具 indices 读 world_indices。

### 改进：资金页钥匙对齐，商品报价强制备热

增减持 / 国债预热改写网页同一把钥匙（`sh_chg` / `cn_bond_yield`）。商品报价按交易时段 TTL 强制重写，不再 5 秒就过期。ETF 份额和快讯 40 条挂进现有预热。

### 改进：回测 PIT 与可交易基准

财务按东财 F10 公告日入库（`np` / `revenue` / `roe`）。指数成分按中证调整公告写入变动日快照。北交所 920 涨跌停按 30%。沪深300 基准有按日成分时跑等权可交易账户（同一套 T+1/整手/佣金），没有覆盖才退回指数价格比。

### 新增：全球关键指数加上中证1000

驾驶舱 / 行情条 / 预热 / 问 AI 同一份指数目录，`sh000852` 接在中证500后面。

### 新增：标的池近 2 年日 K 库存

数据页看覆盖，点「补齐近 2 年」写入现有 `market/` parquet（原始 OHLC + 复权因子，只写已收盘 bar）。已齐的跳过。不算 enriched，不清库。回测上限仍是 20 只。

### 新增：本机数据页

顶栏「更多」里的 `/data`：看本机日历、日 K 覆盖、实验。可补齐标的池近 2 年日 K。

### 改进：回测收口三件

滚动切窗不再叠单点切窗。`daily_bars` 与 `light_kline` 日 K 共用腾讯解析。回看实验核对本机行情哈希，对不上只提示。

### 改进：回测样本外与持仓一键

样本外切窗：均线只在切点前选，切点后另开一笔钱验（不是把整段净值切开）。滚动切窗每折新开账户。持仓页「回测这些」带代码跳到 `/backtest` 并自动开跑。

### 改进：回测存档与行情层

行情改为 `market/` 分区 parquet：原始 OHLC 与复权因子分开，只写已收盘 bar，内存 DuckDB/Polars 查，不建 `.db`。实验落 `backtest/runs/<id>/`（config / 成交 / 净值 / 数据哈希），写完不改。页面可回看实验、叠沪深300。成分按日、财务 `(start,end)+公告日` 已留口。作业仍同步，不上 SQLite。

### 新增：回测 V1

顶栏 `/backtest`。自研日线账户撮合（不装 vectorbt）：次日开盘、共享现金、T+1、整手 100、印花税只卖、涨跌停看成交价对昨收。策略：买入持有 / 均线金叉死叉 / 指定买卖日。`GET /api/backtest/meta` · `POST /api/backtest/run`。问 AI 工具 `run_backtest` 只读摘要，不校准买卖。

### 改进：板块热点领涨领跌表头滚动时钉住

左右两列只滚板块行，「领涨 / 领跌」和代码、涨跌幅表头留在顶上。

### 文档：AI 改代码约定

`CONTEXT.md`：名单 / 缓存 / 报价只留一份入口，下次改代码先挂再写。

### 改进：K 线页和自选公告走报价中心

K 线自选列表 / 估值快照、自选公告里的名称不再打 `/api/quote`，和顶栏格子共用 5 秒报价中心。腾讯已有的 PE/市值跟着这条走。

### 改进：问 AI 全球指数与预热共用缓存

`get_global_indices` 不再另存 5 分钟份，与复盘清单的 `world_indices` 20 秒键相同。

### 改进：复盘清单 / 上下文 / 指数目录收成一份

预热、邮件、问 AI 不再各写一份「该拉哪些格」。`POST /api/market/review-context` 由后端打包复盘上下文（含自选），网页不再本地拼快照。全球指数只认一份指数目录（中证500，不再混中证1000）；问 AI 工具的全球指数与驾驶舱同源。

### 改进：去掉没有页面的功能与空 HTTP 入口

README 不再写「我的研报 / 研究记录 / 反思审计」。删掉对应后端（`myreports` / `reflection` / `/api/reflect`）、死前端 client（`agents.ts` / `ndjson.ts`），以及前端从不打的 HTTP 壳（`/api/radar*` `/kline` `/finance` `/disclosure` `/indices` `/industry` `/global/indices` `/market/overview` `/emotion` `/turnover-top` `/world-indices` `/board-flow` `/hot-list` `/stock-monitor` `/price-anomaly` `/limit-pools` `/ths-limit-up`、部分 ovlab 空路由）。`review-snapshot` 不再返回恒为 None 的占位字段。AI / MCP 仍直调底层函数。

### 改进：复盘邮件把 Markdown 表格渲染成 HTML

正文不再整段塞进 `<pre>`。指数/板块这类 `| 列 |` 表会显示成带边框的表格，标题和加粗也能看。

### 新增：工作日收盘后 AI 复盘邮件

opt-in。接入 AI 页可开关、改北京时间、改收件人（`PUT /api/market/review-mail`，立刻生效）。SMTP 授权码和模型 key 仍在 `backend/.env`。默认 16:10、仅工作日、每天最多一封。复用现有复盘提示词。`GET /api/market/review-mail` 看状态（不回密码/key）；`POST /api/market/review-mail/run` 立刻试发。

### 改进：AI 当日复盘带入当前看板快照

点「AI 复盘 / 问 AI」时，把驾驶舱各格打成文本快照再发给模型：全球指数、涨跌分布、涨跌停、板块热点、板块资金、主力净流入、个股榜、商品、**实时热点 7×24**（标题+全文+产业链/宏观/政策标签，跟当前财联社/新浪源）、自选、龙虎、ETF/北向/利率。缺的格子会标明「未取到」，避免模型编数字。CLI 没有工具调用，必须靠这份快照。超长时先丢掉更旧的快讯，不把正文拦腰截断。

### 改进：复盘「市场板块实时热点」左右分栏

默认左领涨 / 右领跌，点板块后原来的成分股列表出在另一半；再点同一板块或点「关闭」回到双列。已去掉顶栏轮播和领涨/领跌互斥切换。

### 改进：去掉资金页「行业级净流入 / 流出」速览

与复盘「板块资金流向」重复，资金页只留 ETF / 利率 / 增减持。

### 新增：ETF 基金份额日线

`GET /api/market/etf-shares?code=` 或 `?codes=`：沪市走上交所日频（万份转亿份），深市走深交所基金规模（份转亿份），本地缓存；季报申购/赎回走东财。复盘资金页一张图看 510050 / 510300 / 510500 / 588000 / 159915 / 159919。

## v0.3.2 — 2026-08-16

研究桌：把 Vibe-Trading 里值得进投研看板的公开源接进来，不搬回测引擎 / 券商 / Swarm。

### 新增：`/research` 研究桌

四块只读面板：日收益 **Pearson 相关热力图**、**ETF 穿透**、**13F 环比**、加密/韩股 K 线。

- `GET /api/research/sources` · `/kline` · `/correlation` · `/etf-holdings` · `/13f`
- AI 工具：`query_ext_kline` / `query_correlation` / `query_etf_holdings` / `query_13f`

### 行情源

- **Stooq**：美股日 K 第三兜底（Yahoo → 新浪 → Stooq），无 key
- **Baostock**：A 股日 K 兜底（腾讯 / mootdx 空时）；可选 `pip install baostock`
- **OKX / Binance** 公开 REST；**CCXT / pykrx** 可选

### 修复：复盘自选「净额 / 净占比」一直是 —

自选复用了个股行，但没开资金流。对齐参考看板：行上 `flow`，可见时 30s 轮询，60ms 窗口合成一次 `GET /api/market/stock-flows`（东财 ulist `f62`/`f184`，30s 缓存）。

### ETF / 13F 陷阱按已验证事实处理

- 东财星号行是发行人十大流通股东交叉引用，不计入基金披露覆盖率；`as_of` 从 payload 读
- N-PORT 用 `repPdDate` 而不是 `repPdEnd`
- 13F 信息表按根标签发现；value 单位不只按申报日切

## v0.3.1 — 2026-08-09

三个用户报告的 bug + 版本号治理。感谢 [@lihaoran0412](https://github.com/lihaoran0412)
一口气提了三份带根因和文件行号的报告，质量很高。

### 修复：`query_market scope=turnover` 字段全为 null（#28）

`tools.py` 按 `turnover` / `changePct` 取字段，而 `astock.market_turnover_rank()`
实际返回的是 `price` / `pct` / `amount` / `mcap` / `float_cap` / `industry`——键名对不上，
每条只剩 `name` 和 `code`，其余一片空白。已对齐字段名，实测 20 条全部有值。

### 修复：Windows 下 MCP server stdout GBK 编码崩溃（#27）

Windows 上 Python 的 stdio 默认编码是 GBK(cp936)。JSON-RPC 响应里带中文、RSS 正文里的
`\xa0`（不换行空格）等字符 GBK 编不出来，**整条响应写不出去**——客户端表现为工具调用
失败 + 反复重连；即便不崩，中文也会被按 UTF-8 解 GBK 字节，全是乱码。

`mcp_server.main()` 现在在读写任何协议内容之前把 stdio 钉死成 UTF-8。选择重配而不是
退让成 `ensure_ascii=True`：后者能防崩，但会把中文全变成转义序列、体积翻几倍，而 MCP
协议本身就要求 UTF-8。

### 改进：证券搜索加备用端点，并区分「接口不可用」与「查无此票」（#26）

报告者的环境下美股/港股/韩股查询全部失败，而产品只回一句「未找到对应代码」，
他只能自己逆向排查到底哪一步坏了。

⚠️ **该接口从我们这边实测是正常的**（AAPL / 00700 / TSLA 均能解析），所以更可能是
IP 风控或链路问题，而非接口下线。但暴露出的两个真问题已修：

- **`except Exception: return None` 把两种情况压成一个返回值**——"这只票不存在"和
  "接口请求失败"从此不可区分。现在后者抛 `SearchUnavailable`，带上真实的底层错误，
  并明说「这与查无此代码是两回事」。
- **单一端点故障会让整块功能瘫痪**——新增备用端点 `searchadapter.eastmoney.com`，
  主端点失败自动切换。**并且必须校验响应结构再收手**：主端点返回「合法 JSON 但没有
  `QuotationCodeTable`」（接口改版 / 风控页 / HTTP 错误页，`em_get` 不做
  `raise_for_status`）时会被误当成"查得到但没匹配"，备用端点根本轮不上——而这恰恰
  就是本 issue 描述的情形，不校验的话这次修复等于没修。

### 修复：MCP `serverInfo` 版本号仍写死 `0.2.2`（#20 补漏）

#20 只列了 3 处硬编码，照着改会漏掉第 4 处：MCP 客户端初始化拿到的还是旧版本。
现抽出 `backend/version.py` 作为唯一读取点，四处同源。

**刻意独立成模块而不是从 `app` 导入**：`app.py` 在导入时会 `pf.start_scheduler(1800)`
起后台线程，MCP 服务只想拿个版本号，不该承担那个副作用。读取失败的警告走 **stderr**——
MCP 的 stdout 专供 JSON-RPC，往那儿打一行警告会插在初始化响应之前，客户端可能拒收整条流。

### 测试

`backend/` 90 passed（新增 11 例），含三条反向边界：GBK stdout 下不修就必崩（先证明坑
真实存在）、接口正常但查无此票仍返回 None、读不到版本号时 stdout 必须为空。

---

## v0.3.0 及更早

本文件自 v0.3.1 起维护；更早的版本历史见
[Releases](https://github.com/simonlin1212/Vibe-Research/releases)。
