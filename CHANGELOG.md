# Changelog

本项目的版本号唯一来源是 `frontend/package.json`；后端 HTTP API、`/api/health`、
前端界面与 MCP `serverInfo` 全部从它读取（见 `backend/version.py`）。

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
