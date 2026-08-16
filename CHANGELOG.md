# Changelog

本项目的版本号唯一来源是 `frontend/package.json`；后端 HTTP API、`/api/health`、
前端界面与 MCP `serverInfo` 全部从它读取（见 `backend/version.py`）。

## Unreleased

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
