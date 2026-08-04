<p align="center"><a href="README.md">简体中文</a> | <b>English</b></p>

<h1 align="center">a-stock-data</h1>

<p align="center">
  <b>Full-stack data toolkit for China A-shares — 10 layers · 47 endpoints · 15 sources · zero-auth</b>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white" alt="Python">
  <a href="https://github.com/simonlin1212/a-stock-data/stargazers"><img src="https://img.shields.io/github/stars/simonlin1212/a-stock-data?style=social" alt="Stars"></a>
  <br>
  <img src="https://img.shields.io/badge/layers-10-2ea44f.svg" alt="Layers">
  <img src="https://img.shields.io/badge/endpoints-47-2ea44f.svg" alt="Endpoints">
  <img src="https://img.shields.io/badge/sources-15-2ea44f.svg" alt="Sources">
  <img src="https://img.shields.io/badge/auth-zero-success.svg" alt="Zero Auth">
</p>

<p align="center">
  <a href="#architecture">Architecture</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#47-endpoints">Endpoints</a> ·
  <a href="./CHANGELOG.md">Changelog</a>
</p>

Full-stack data toolkit for China A-Share market — 10-layer architecture · 47 endpoints (44 primary + 3 official backups) · 15 data sources · zero third-party data wrapper dependencies

A self-contained Skill file that consolidates raw A-share data from 15 sources into a ready-to-use toolkit for AI coding assistants. No need to memorize mootdx candlestick parameters, Eastmoney PDF Referer headers, or iwencai X-Claw authentication — it's all handled. And when a primary source bans you, there's a backup-source quick reference to fall back on.

> Compatible with [Claude Code](https://github.com/anthropics/claude-code) · [Codex](https://github.com/openai/codex) · [OpenClaw](https://github.com/anthropics/openclaw)
>
> The Skill file is structured Markdown + embedded Python. Any AI coding assistant with context injection can use it.

---

## Architecture

```
China A-Share Full-Stack Data · 10-Layer Architecture · V3.6.0
│  (Priority: prefer mootdx/Tencent — never IP-banned; Eastmoney only for exclusive data, with built-in throttling)
├── Market Data    mootdx + Tencent + Baidu K-line   Candlesticks (w/ MA5/10/20) + Order Book + PE/PB + Index/ETF
├── Research       Eastmoney + THS + iwencai          Stock reports / Industry reports / PDF / Consensus EPS / NL search
├── Signals        THS + Eastmoney                    Hot stocks + Sector attribution + Northbound flow
│                                                     + Sector membership + Fund flow(push2) + Dragon Tiger + Lockup + Industry + Board fund flow
├── Capital Flow   Eastmoney datacenter + push2       Margin trading + Block trades + Holder count + Dividends + Fund flow(min+120d)
├── News           Eastmoney + Cailianpress           Stock news / CLS flash (✅revived in V3.4) / Global finance (mutual backup)
├── Fundamentals   mootdx + Eastmoney + Sina          37-field quarterly + F10 9 categories + Financial statements
├── Filings        cninfo + mootdx                    Full filings across SSE / SZSE / BSE
├── Limit-Up       Eastmoney push2ex + THS            ZT/ZB/DT/prev-ZT pools / limit reasons / consecutive-board ladder
│                                                     + Watch list pool + Intraday price-anomaly pool  ★V3.6
├── Options        Sina hq.sinajs                     ETF option T-quotes / Greeks / implied volatility  ★V3.3
└── Sentiment      cninfo IRM + THS + Eastmoney       Investor Q&A / hot lists / popularity rank / concept hits  ★V3.3
```

> ★V3.4 On top of the 10 layers there is now a **Backup Sources & Fallback Strategy** appendix: SSE/SZSE official + Sina + HKEX — official backup functions (dragon-tiger / fund flow / filings) + a per-layer fallback table for when a primary source bans you (see the corresponding SKILL.md section).

---

## Quick Start

**3 steps, 2 minutes.**

```bash
# 1. Create skill directory
mkdir -p ~/.claude/skills/a-stock-data

# 2. Download SKILL.md
curl -o ~/.claude/skills/a-stock-data/SKILL.md \
  https://raw.githubusercontent.com/simonlin1212/a-stock-data/main/SKILL.md

# 3. Install dependencies (V3.0: akshare no longer needed)
pip install mootdx requests pandas stockstats
```

Launch Claude Code and say "Check the valuation of 688017" — the skill activates automatically.

> **Codex / OpenClaw users:** Paste the contents of SKILL.md into your system prompt or project context file. The embedded Python code is ready to execute.

---

## 47 Endpoints

> **Counting convention:** the tables below have 48 rows but count as 47 endpoints — "Eastmoney Industry Reports" shares **the same endpoint** as "Eastmoney reportapi" (only the `qType` parameter differs) and "THS Northbound (historical)" is a local self-built cache (not a separate endpoint), so neither is counted; the single "EM Intraday Anomaly Pool" row covers **two** endpoints (`list` / `count`), adding one back. 48 − 1 − 1 + 1 = 47.

### Market Data (real-time, no IP ban)

| Endpoint | Data |
|----------|------|
| mootdx Market Data | Candlesticks (multi-period) + Level-2 order book + tick-by-tick + 46-field quote |
| Tencent Finance | PE(TTM) / PB / Market Cap / Float Cap / Turnover / Price Limits / Index / ETF |
| **Baidu K-line** | Daily K-line + MA5/MA10/MA20 moving averages included (V3.0 new) |

### Research Reports

| Endpoint | Data |
|----------|------|
| Eastmoney reportapi | Single-stock report list + ratings + 3-year EPS forecasts |
| Eastmoney Industry Reports | Industry report list (qType=1, same endpoint) + industry name/code + rating (V3.2.3) |
| Eastmoney PDF | Full research report PDF, stock & industry (Referer auth handled) |
| THS Consensus EPS | Institutional consensus EPS (direct basic.10jqka.com.cn) |
| iwencai NL Search | Natural language cross-topic report search |

### Signals

| Endpoint | Data |
|----------|------|
| THS Hot Stocks | Today's strong stocks + sector attribution tags (editorial annotations) |
| THS Northbound (real-time) | Shanghai Connect minute-level flow (Shenzhen Connect unreliable since upstream disclosure tightening — see HKEX backup for authoritative data) |
| THS Northbound (historical) | Local self-cached daily history |
| Eastmoney Sector Membership | All sectors a stock belongs to (industry/concept/region mixed) + BK code + daily change + leading stock (V3.2.2, replaced Baidu PAE, one request) |
| **Eastmoney Fund Flow** | Main / Large / Medium / Small / Super-large order minute-level net inflow (V3.1, replaced Baidu PAE) |
| Dragon Tiger Board | Appearance records + Top 5 buy/sell brokerages + institutional activity |
| Daily Dragon Tiger (Full Market) | All stocks on daily board + net buy ranking + appearance reasons |
| Lockup Expiry Calendar | Historical releases + 90-day upcoming expiry alerts |
| **Industry Ranking** | Eastmoney industry change/up/down counts (V3.0, replaced THS 401) |
| **Board Fund Flow** | Industry/concept/region × today/5d/10d main net inflow & ratio + super-large/large/medium/small tiers + leading stock (V3.5, same endpoint as Industry Ranking) |

### Capital Flow / Ownership (V3.0 New)

| Endpoint | Data |
|----------|------|
| **Margin Trading** | Daily margin balance / buy / repay + short selling balance |
| **Block Trades** | Deal price/volume + buyer/seller brokerages + premium rate |
| **Shareholder Count** | Quarterly holder count + QoQ change + avg shares per holder |
| **Dividend History** | Per-share cash dividend / bonus shares / transfer shares |
| **120-Day Fund Flow** | Main / large / medium / small order daily net inflow |

### News

| Endpoint | Data |
|----------|------|
| Stock News | Eastmoney per-stock news (direct search-api-web) |
| CLS Flash | Market-wide real-time flash (v1 API + local signature, zero key, ✅revived in V3.4.0, mutual backup with Global News) |
| Global News | Eastmoney global finance news (direct np-weblist, 7×24) |

### Fundamentals + Filings

| Endpoint | Data |
|----------|------|
| Quarterly Snapshot | 37 fields (EPS / ROE / Net Profit / Revenue...) |
| F10 Company Data | 9 categories (truncation optimization, -70% tokens) |
| Eastmoney Stock Info | Industry / total shares / float / market cap / listing date (direct push2) |
| Sina Financial Statements | Balance sheet / Income statement / Cash flow (direct quotes.sina.cn) |
| cninfo Filings | Full filings across all exchanges |

### Limit-Up / Limit-Down (V3.3 new)

| Endpoint | Data |
|----------|------|
| EM Limit-Up Pool | Consecutive boards / N-day-M-board / seal fund / break count / seal time / industry |
| EM Break-Board Pool | Opened after limit-up + amplitude / speed |
| EM Limit-Down Pool | Seal fund / consecutive limit-down / open count / board turnover |
| EM Prev-Day Limit-Up Pool | Yesterday's limit-up performance today (promotion rate / profit effect) |
| THS Limit-Up Insight | Limit reason themes / seal success rate / board type / seal amount |
| EM Watch List Pool | Exchange risk-warning / watch list + validity window (new in V3.6) |
| EM Intraday Anomaly Pool | Severe price-anomaly detail + per-stock aggregated counts + all 12 anomaly rules decoded (new in V3.6) |

### ETF Options (V3.3 new)

| Endpoint | Data |
|----------|------|
| Option Contract List | 50ETF / 300ETF / STAR50 ETF / 500ETF call & put contracts by month |
| T-Quote | Bid/ask 5 levels / open interest / strike / last / volume |
| Greeks + IV | Delta / Gamma / Theta / Vega / implied vol / theoretical value (exchange-computed, no local BSM) |

### Sentiment & Interaction (V3.3 new)

| Endpoint | Data |
|----------|------|
| Investor Q&A (IRM) | Investor questions + official company replies (unique source: how a company responds to rumors/news) |
| THS Hot List | Popularity / concept tags / rank change |
| EM Popularity Rank | Rank + rank change + name/price |
| EM Stock Concept Hits | Which concepts the market is grouping this stock under + heat |

### Backup Sources (V3.4 new · fallback when a primary source bans you)

| Endpoint | Data |
|----------|------|
| Official Dragon-Tiger Backup | SSE + SZSE official APIs, zero-auth, authoritative first-party, incl. brokerage seats (when Eastmoney is banned) |
| Fund Flow Backup | Sina daily 4-tier order net flow (super-large / large / medium / small + net inflow) |
| Filings Backup | SZSE official for Shenzhen tickers, Eastmoney for Shanghai, both with direct PDF links (when cninfo is banned) |

> Plus a **per-layer primary → independent-backup table** (exchange official / THS F10 / HKEX / cninfo webapi / Jin10 — all on different rate-limit planes) and a "confirmed dead" list — see the "Backup Sources & Fallback Strategy" section in SKILL.md.

### Authentication

All data sources except iwencai are **completely free, no API key needed**. Only iwencai semantic search requires an API key ([apply here](https://www.iwencai.com/skillhub)).

---

## Usage Examples

Just tell your AI assistant:

| Scenario | Prompt |
|----------|--------|
| Valuation | "Estimate 688017 — give me PE / PEG / payback period" |
| Sector Attribution | "Which stocks are strong today and what sectors are driving them" |
| Research Reports | "Latest reports on humanoid robot supply chain, especially ball screws and reducers" |
| Northbound Flow | "How's northbound capital flow looking today" |
| Concept Blocks | "What concept sectors does 688017 belong to" |
| Fund Flow | "Is institutional money flowing into or out of 000858 today" |
| Dragon Tiger Board | "Has 002475 appeared on the dragon tiger board recently, which brokerages are buying" |
| Daily Dragon Tiger | "Which stocks had the highest net buy on today's dragon tiger board" |
| Lockup Expiry | "Any lockup expiries coming up in the next 3 months for this stock" |
| Industry Rotation | "Which industries are up the most today, where is money flowing" |
| Margin Trading | "What's the recent trend in margin balance for 600519" |
| Block Trades | "Any recent block trades for this stock, premium or discount" |
| Shareholder Count | "Is 000858 shareholder count increasing or decreasing" |
| Dividends | "How much has Moutai paid in dividends over the years" |
| ETF Quote | "What's the price of 510050 (SSE 50 ETF) and today's change" |
| Limit-Up Sentiment | "How many stocks hit limit-up today, highest consecutive boards, break rate" |
| Limit-Up Themes | "What themes drove today's limit-ups, which are multi-day boards" |
| Watch List Pool | "Which stocks are on the exchange watch list right now, and until when" |
| Intraday Anomalies | "Which stocks had severe price anomalies today, and which rule did they trigger" |
| Anomaly × Watch List | "Of today's anomaly stocks, which are already on the watch list" |
| ETF Options | "What's the implied vol and Delta of the at-the-money 50ETF option" |
| Investor Q&A | "What are investors asking BYD recently and how did the company respond" |
| Market Heat | "Which stocks are hottest today and what concepts are they grouped under" |
| News & Filings | "Pull recent news and filings for 300476" |
| Market Flash | "Any big market news right now on the CLS flash feed" |
| Batch Compare | "Compare valuations of these 5 semiconductor stocks" |

### 4 Built-in Research Workflows

| Workflow | What it does | Time |
|----------|-------------|------|
| Single Stock Valuation | Live price → Consensus EPS → Forward PE / PEG / PE payback years | 30 sec |
| Batch Comparison | Side-by-side valuation ranking | 1 min |
| Thematic Research | iwencai multi-keyword NL search + Eastmoney PDF cross-reference | 2 min |
| New Target Research | Coverage → Valuation → Concepts → Fund flow → Dragon tiger → Lockup → Margin | 1 min |

---


## Data Source Priority (V3.2 re-ranked by IP-ban risk)

> **Principle: anything available from mootdx or Tencent (quotes / K-line / live price / market cap / financials) must use them first (never IP-banned). Eastmoney is only for its exclusive data, all routed through the throttled `em_get()`.**

| Priority | Source | Protocol | IP Ban Risk | Use |
|----------|--------|----------|-------------|-----|
| **1 (top)** | mootdx (TDX) | TCP 7709 | **Never banned** | K-line / order book / ticks / financials / F10 |
| **2 (top)** | Tencent Finance | HTTP | **Never banned** | Live price / PE / PB / market cap / turnover / index / ETF |
| 3 | THS Hot Stocks / Northbound | HTTP | Very low (zero auth) | Hot stocks / themes / northbound flow |
| 4 | Baidu Finance | HTTP | Very low | K-line (w/ MA5/10/20) |
| 5 | Sina Finance | HTTP | Low | Financial statements |
| 6 | cninfo | HTTP | Low | Filings |
| 7 | THS Consensus EPS | HTTP | Low (UA required) | Consensus EPS |
| 8 | iwencai | OpenAPI | Low (key required) | NL semantic search |
| **last (exclusive only)** | **Eastmoney** datacenter/push2/reportapi/search/np-weblist | HTTP | **Medium — has rate-limit risk** | Dragon-tiger / lockup / margin / block trade / shareholders / dividends / fund flow / reports / news (all via `em_get()`) |

> **Architecture:** Except mootdx (TCP binary protocol), all sources use direct HTTP API calls, zero third-party data wrapper dependencies. **Eastmoney APIs are rate-limited; all calls go through `em_get()` for serial throttling. For batch jobs, increase `EM_MIN_INTERVAL`.**
>
> **Fallback (V3.4 new):** When any primary source is banned or broken, check the "Backup Sources & Fallback Strategy" section in SKILL.md — every data category has an independent backup on a **different domain and rate-limit plane** (SSE/SZSE official / Sina / THS / HKEX), unaffected when Eastmoney bans you.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

---

## Disclaimer

This project provides data access tools only and does not constitute investment advice. Investing involves risk.

---

## License

[Apache License 2.0](./LICENSE)

**Author:** Simon Lin · X [@linsizhen](https://x.com/linsizhen) · Email: [simonlin0423@gmail.com](mailto:simonlin0423@gmail.com)
