"""AI 工具层 —— 把后端已有的全部客观数据能力暴露成 function-calling 工具。

设计原则：
- **只给客观数据**：每个工具返回的都是公开可查的事实（行情/财报/资金/公告/板块），
  不含任何评分、排名倾向、买卖建议或预测。结论一律由用户自己配置的模型给出。
- **裁剪后再喂**：原始接口动辄上百条（资金流 120 天、互动易 30 条），直接塞进上下文
  会把 token 烧光且淹没重点。每个工具在这里做「取最近 N 条 + 关键字段 + 汇总统计」，
  让模型拿到的是能直接推理的密度，而不是原始转储。
- **失败不抛**：任何异常都转成 {"error": ...} 回喂给模型，让它换个工具继续，不中断对话循环。

chat.py / mcp_server.py 共用本模块，新增工具只需改这里一处。
"""

from __future__ import annotations

from typing import Any

import astock
import gstock
import market
import newsradar
import ovlab

# ——— schema 简写：让 20+ 个工具定义保持一屏可读 ———

_CODE = {"code": {"type": "string", "description": "6 位 A 股代码，如 600519"}}


def _t(name: str, desc: str, props: dict | None = None, required: list[str] | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {"type": "object", "properties": props or {}, "required": required or []},
        },
    }


def _pick(rows: list[dict], keys: tuple[str, ...] | None, limit: int) -> list[dict]:
    """取前 limit 条（控 token）；keys 为 None 时保留全部字段，只截条数。"""
    head = (rows or [])[:limit]
    if keys is None:
        return [r for r in head if isinstance(r, dict)]
    return [{k: r.get(k) for k in keys} for r in head if isinstance(r, dict)]


TOOLS: list[dict] = [
    # —— 行情与估值 ——
    _t("query_quote", "查 A 股实时行情：现价/涨跌/PE/PB/市值/换手/涨跌停。可批量。",
       {"codes": {"type": "array", "items": {"type": "string"}, "description": "6 位代码列表，如 ['600519','000858']"}},
       ["codes"]),
    _t("query_valuation", "查单只个股的完整估值：行情 + 机构一致预期 EPS + 前向 PE / PEG / PE 消化年数。",
       _CODE, ["code"]),
    _t("query_valuation_percentile",
       "查个股 PE-TTM / PB 的历史估值分位：当前值 + 近五年 20/50/80 分位带 + 当前所处百分位。判断估值贵贱先用这个。",
       _CODE, ["code"]),
    _t("query_kline",
       "查个股 K 线并附区间统计（起止价、区间涨跌幅、最高/最低、振幅）。判断价格位置与趋势用。",
       {**_CODE,
        "period": {"type": "string", "enum": ["day", "week", "month"], "description": "周期，默认 day"},
        "count": {"type": "integer", "description": "取最近多少根，默认 60，最大 250"}},
       ["code"]),

    # —— 基本面 ——
    _t("query_financials",
       "查个股最新报告期财务关键指标：营收/净利及同比、ROE、毛利率、净利率、每股经营现金流、EPS。",
       _CODE, ["code"]),
    _t("query_company_info", "查公司基本概况：所属行业、总股本/流通股、上市日期等。", _CODE, ["code"]),
    _t("query_reports", "查个股近期研报列表（标题/机构/评级/日期）。", _CODE, ["code"]),
    _t("query_news", "查个股近期新闻（标题/时间/来源）。", _CODE, ["code"]),
    _t("query_cls_telegraph",
       "查财联社电报：全市场实时财经快讯（标题/正文/时间）。客观公开资讯，不构成投资建议。",
       {"limit": {"type": "integer", "description": "条数，默认 30"}}, []),
    _t("query_global_news",
       "查东财全球财经资讯 7x24（标题/摘要/时间）。客观公开资讯，不构成投资建议。",
       {"limit": {"type": "integer", "description": "条数，默认 30"}}, []),
    _t("query_iwencai",
       "用问财(iwencai)自然语言搜研报/公告/新闻（需后端配置 IWENCAI_API_KEY）。适合主题检索如「人形机器人 丝杠」。",
       {
           "query": {"type": "string", "description": "自然语言检索词"},
           "channel": {"type": "string", "enum": ["report", "announcement", "news"], "description": "通道，默认 report"},
           "size": {"type": "integer", "description": "条数，默认 15"},
       },
       ["query"]),

    # —— 资金面与筹码 ——
    _t("query_fund_flow",
       "查个股资金流向：最近若干日主力/超大单/大单/中单/小单净流入，并附近 5 日、20 日累计主力净额。",
       {**_CODE, "days": {"type": "integer", "description": "明细返回最近多少日，默认 10，最大 60"}},
       ["code"]),
    _t("query_fund_flow_minute",
       "查个股当日分钟级主力/大小单净流入（东财）。返回最新点与全天主力累计。",
       _CODE, ["code"]),
    _t("query_ths_limit_up",
       "查同花顺涨停揭秘：涨停原因题材、板型、封板成功率、几天几板。客观公开榜单，不构成推荐。",
       {"date": {"type": "string", "description": "可选 YYYYMMDD，默认今天"}}, []),
    _t("query_margin", "查个股融资融券：融资余额、融资买入/偿还、融券余额趋势（最近若干期）。", _CODE, ["code"]),
    _t("query_holders", "查个股股东户数变化（户数增减 = 筹码集中或分散的直接证据）。", _CODE, ["code"]),
    _t("query_etf_flow",
       "查全市场 ETF 资金流向排行：主力/超大/大/中/小单净流入（亿元）。客观公开榜单，不构成推荐。",
       {
           "sort_by": {"type": "string", "enum": ["net_inflow", "change_pct"], "description": "排序，默认 net_inflow"},
           "limit": {"type": "integer", "description": "条数，默认 30"},
       }, []),
    _t("query_shareholder_changes",
       "查股东/高管增减持披露：变动人、增减方向、股数、均价、职务。可查全市场或指定个股。客观披露，不构成推荐。",
       {
           "code": {"type": "string", "description": "可选 6 位代码；空=全市场最近变动"},
           "change_type": {"type": "string", "enum": ["all", "增持", "减持"], "description": "默认 all"},
           "limit": {"type": "integer", "description": "条数，默认 30"},
       }, []),
    _t("query_lpr",
       "查 LPR 贷款市场报价利率历史（1Y/5Y）。全国银行间同业拆借中心公开报价。",
       {"days": {"type": "integer", "description": "回溯天数，默认 365"}}, []),
    _t("query_cn_bond_yield",
       "查中债国债或政策性金融债收益率曲线（1Y~30Y + 10Y-2Y/30Y-10Y 利差）。客观利率，非预测。",
       {"curve_type": {"type": "string", "enum": ["treasury", "policy"], "description": "默认 treasury"}}, []),
    _t("query_block_trade", "查个股大宗交易记录：成交价、折溢价率、成交量、买卖营业部。", _CODE, ["code"]),
    _t("query_dragon_tiger", "查个股龙虎榜：近 30 日上榜记录、最近一次买卖席位 TOP5、机构专用席位净买额。", _CODE, ["code"]),
    _t("query_daily_dragon_tiger",
       "查全市场龙虎榜：当日（或最近有数据交易日）上榜股票、上榜原因、买卖净额(万元)、涨跌幅。客观公开榜单，不构成推荐。",
       {
           "date": {"type": "string", "description": "可选 YYYY-MM-DD，默认最近有数据日"},
           "top": {"type": "integer", "description": "返回条数，默认 30"},
       }, []),
    _t("query_dividend", "查个股历史分红方案：每股派息、股息率、除权除息日、分红进度。", _CODE, ["code"]),

    # —— 事件与风险 ——
    _t("query_announcements", "查个股近期公告（标题/日期/类型）。查风险与重大事项先用这个。", _CODE, ["code"]),
    _t("query_lockup", "查个股限售解禁：历史解禁记录 + 未来 90 天待解禁事件（日期/类型/股数/占比）。", _CODE, ["code"]),
    _t("query_investor_qa", "查个股投资者互动易问答（公司对投资者提问的官方回复，常含经营细节）。", _CODE, ["code"]),

    # —— 行业与板块 ——
    _t("query_concepts", "查个股所属板块与概念归属，以及当下被市场归到哪些热门概念在炒。", _CODE, ["code"]),
    _t("query_industry_comparison", "查全市场行业板块横向对比：各行业涨跌幅、成交额、领涨股。看板块强弱用。",
       {"top_n": {"type": "integer", "description": "返回前 N 个行业，默认 20"}}),
    _t("query_industry_reports", "按关键词查行业研报（非个股），了解卖方对某赛道的最新覆盖。",
       {"keywords": {"type": "array", "items": {"type": "string"}, "description": "行业关键词，如 ['光模块','算力']"},
        "days": {"type": "integer", "description": "回溯天数，默认 90"}}),

    # —— 市场层 ——
    _t("query_market",
       "查大盘与市场情绪。scope: indices=A股指数 / global=全球指数 / emotion=短线情绪(连板梯队/封板率) / turnover=全市场成交额 TOP20 / overview=大盘总览(指数+情绪+板块资金流)。",
       {"scope": {"type": "string", "enum": ["indices", "global", "emotion", "turnover", "overview"],
                  "description": "要查的范围，默认 overview"}}),
    _t("query_news_radar",
       "查资讯雷达：12 条赛道的行业资讯聚合（非个股新闻，看产业面动态用）。可传 track 只看某条赛道（如「半导体」「AI」）。",
       {"track": {"type": "string", "description": "赛道名关键词，留空看全部"},
        "per_track": {"type": "integer", "description": "每条赛道取最新几条，默认 5"}}),

    # —— 海外 ——
    _t("query_global_stock",
       "查美股 / 港股 / 韩股个股：行情 + 关键财务指标（韩股仅行情）。美股用字母代码(AAPL)，港股用数字(00700)，韩股 6 位数字加 .KS(005930.KS)。",
       {"symbol": {"type": "string", "description": "美股字母代码 / 港股代码 / 韩股 XXXXXX.KS"}},
       ["symbol"]),
    _t("query_hk_cashflow",
       "查港股现金流量表：经营/投资/筹资活动现金流净额、现金及等价物净增加、期初/期末现金，多期、附同比。仅港股，代码用数字如 00700。",
       {"symbol": {"type": "string", "description": "港股代码，如 00700"}},
       ["symbol"]),

    # —— 期权 / 期货波动率（OpenVlab, 公开数据）——
    _t("query_ovlab_market",
       "查期权/期货波动率市场概览(OpenVlab): 全部品种的现价/涨跌幅/平值隐波/隐波变化/隐波百分位/22日实波/VolAlphaT/Carry/偏度及百分位/近远月动量/主力合约/到期日/夜盘/是否境外。看波动率全景、找高/低波品种用。",
       {"limit": {"type": "integer", "description": "返回前 N 个品种，默认全部，按原始顺序"}}),
    _t("query_ovlab_detail",
       "查单个期权/期货标的的详细数据(OpenVlab dto): 含主力合约月份、希腊字母、隐波曲线、各合约报价等。prod_und 用标的代码如 510300。",
       {"prod_und": {"type": "string", "description": "标的代码 (prodUnd)，如 510300 / 510050"},
        "exps": {"type": "array", "items": {"type": "string"}, "description": "可选, 指定主力合约月份列表"}},
       ["prod_und"]),
    _t("query_ovlab_volatility_ts",
       "查波动率期限结构汇总(OpenVlab volatility-ts-all): 各标的的隐波期限结构，看波动率随到期日的形态。部分字段可能受限。"),
    _t("query_ovlab_future_ts",
       "查期货期限结构(OpenVlab future-ts): scope=all 全品种汇总 / single 单品种(prod_und 如 MA)。期货版波动率期限结构。",
       {"scope": {"type": "string", "enum": ["all", "single"], "description": "all=全品种汇总, single=单品种"},
        "prod_und": {"type": "string", "description": "scope=single 时必填, 标的代码如 MA"}}),
    _t("query_ovlab_flow_alert",
       "查期权异动榜(OpenVlab flow-alert): 近期异动合约清单, 含合约/触发规则/价格/涨跌/持仓量/窗口成交量/权利金。看市场情绪突变用。"),
    _t("query_ovlab_warehouse_history",
       "查单品种多年持仓历史(OpenVlab warehouse/history): product 如 MA。返回当前持仓 + year2013~2026 各年持仓 + ratioData + category。仓差/资金面/季节性分析用。",
       {"product": {"type": "string", "description": "品种代码, 如 MA / CU / RB"}},
       ["product"]),
    _t("query_ovlab_seasonal_history",
       "查全品种季节性持仓(OpenVlab warehouse/seasonal-history-all): 按年份分组的多品种持仓, 研究季节性规律用。years 留空取近 6 年。",
       {"years": {"type": "array", "items": {"type": "string"}, "description": "年份字符串列表, 如 ['2023','2024','2025']"},
        "product": {"type": "string", "description": "可选, 指定单品种"}}),
    _t("query_ovlab_product_exps",
       "查全品种合约月份列表(OpenVlab product-exps): 75 个品种各有哪些合约月份。查具体合约代码(K线/详情前置)用。prod_und 可选指定单品种。",
       {"prod_und": {"type": "string", "description": "可选, 指定单品种"}}),
    _t("query_ovlab_meta",
       "查OpenVlab元数据: scope=exchange 交易所信息 / sector 板块信息 / next_trading_day 下一交易日 / holidays 节假日(需 exchange)。",
       {"scope": {"type": "string", "enum": ["exchange", "sector", "next_trading_day", "holidays"],
                  "description": "要查的元数据类型"},
        "exchange": {"type": "string", "description": "scope=holidays 时必填, 交易所代码如 CZCE"}}),
    _t("query_ovlab_position",
       "查期权/期货持仓排名(OpenVlab option-position/future-position): 交易所每日公布的期货公司持仓排名榜。scope=products 品种列表 / details 持仓明细(买方/卖方/净多/净空排名+增减+净多净空第一)。kind=future 期货 / option 期权(需 direction C/P)。",
       {"scope": {"type": "string", "enum": ["products", "details"], "description": "products=品种列表, details=持仓明细"},
        "kind": {"type": "string", "enum": ["future", "option"], "description": "future=期货持仓, option=期权持仓"},
        "product": {"type": "string", "description": "scope=details 时必填, 品种如 RB/IO"},
        "code": {"type": "string", "description": "scope=details 时必填, 合约如 rb2608/IO2608"},
        "direction": {"type": "string", "enum": ["C", "P"], "description": "kind=option 时必填, C=Call P=Put"},
        "day": {"type": "string", "description": "scope=details 时必填, YYYY-MM-DD; products 返回 last_trading_day"}},
       []),
    _t("query_ovlab_chart",
       "查K线/ATM隐波历史(OpenVlab history/history-atmvol): 前端轻量图表同源数据。kind=kline K线OHLC+持仓+成交量 / atmvol ATM隐含波动率。symbol 合约代码如 SC2609, resolution 1D/1/5(日线/分时/5日), from/to Unix秒可选默认近1年。",
       {"kind": {"type": "string", "enum": ["kline", "atmvol"], "description": "kline=K线, atmvol=ATM隐波"},
        "symbol": {"type": "string", "description": "合约代码, 如 SC2609 / 510300"},
        "resolution": {"type": "string", "description": "1D 日线 / 1 分时 / 5 5日, 默认 1D"},
        "from_ts": {"type": "integer", "description": "可选, Unix 秒起点"},
        "to_ts": {"type": "integer", "description": "可选, Unix 秒终点"}},
       ["kind", "symbol"]),
    _t("query_ovlab_search",
       "搜OpenVlab合约/标的(search-symbols): keyword 模糊匹配, 返回合约元信息列表(ticker/name/exchange/type/到期日等)。找具体合约代码用。",
       {"keyword": {"type": "string", "description": "关键词, 如 SC / 沪铜 / 510300"},
        "limit": {"type": "integer", "description": "可选, 返回条数上限, 默认 30"}},
       ["keyword"]),
    _t("query_ovlab_flow_data",
       "查期权异动资金流明细分页(OpenVlab flow-data, POST): 合约/最新价/涨跌幅/持仓量/持仓变化/成交量/成交额/买卖盘占比/OTM/DTE, 可按品种筛选。不缓存。",
       {"product": {"type": "string", "description": "可选, 品种筛选如 IO"},
        "page": {"type": "integer", "description": "页码, 默认 1"},
        "page_size": {"type": "integer", "description": "每页条数, 默认 50"}},
       []),
    _t("query_ovlab_vol_surface",
       "查波动率曲面(OpenVlab volatility-surface): 按到期月分组的 T 型报价/持仓数据。product 品种如 SC。缓存 2 分钟。",
       {"product": {"type": "string", "description": "品种代码, 如 SC / IO"}},
       ["product"]),
]

TOOL_NAMES = [t["function"]["name"] for t in TOOLS]


# ——— 各工具的执行实现（裁剪逻辑集中在这里） ———

_TENCENT_KLINE = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"


def _kline_tencent(code: str, period: str, n: int) -> list[dict]:
    """腾讯前复权 K 线（备用源）。

    mootdx 走 TCP 7709，在部分网络下连不通（实测本机返回空）；东财 push2his 的 kline 路径
    也可能被拦。腾讯 HTTP 接口实测不封 IP（项目数据源分层里的首选行情源），拿它兜底。
    返回字段顺序：日期, 开, 收, 高, 低, 成交量。
    """
    import requests

    prefix = astock.get_prefix(code)
    sym = f"{prefix}{code}"
    r = requests.get(_TENCENT_KLINE, params={"param": f"{sym},{period},,,{n},qfq"},
                     headers={"User-Agent": "Mozilla/5.0"}, timeout=12)
    d = (r.json().get("data") or {}).get(sym) or {}
    raw = d.get("qfq" + period) or d.get(period) or []
    out = []
    for it in raw:
        if not isinstance(it, list) or len(it) < 6:
            continue
        def _f(x):
            try:
                return float(x)
            except (TypeError, ValueError):
                return None
        out.append({"date": it[0], "open": _f(it[1]), "close": _f(it[2]),
                    "high": _f(it[3]), "low": _f(it[4]), "volume": _f(it[5])})
    return out


def _kline(args: dict):
    period = str(args.get("period") or "day")
    if period not in ("day", "week", "month"):
        period = "day"
    cat = {"day": 4, "week": 5, "month": 6}[period]
    n = max(5, min(int(args.get("count") or 60), 250))
    code = str(args["code"])
    # 腾讯优先：HTTP、实测不封 IP、亚秒级返回；mootdx 走 TCP 7709，连不通时要等十几秒超时
    # （实测本机就是这种情况），放在后面当备份而不是主路径。
    try:
        rows = _kline_tencent(code, period, n)
    except Exception:  # noqa: BLE001 — 网络问题转备用源
        rows = []
    if not rows:
        try:
            rows = astock.kline(code, category=cat, offset=n)
        except Exception:  # noqa: BLE001
            rows = []
    if not rows:
        return {"error": "K 线数据源当前不可达（mootdx 与备用源均无返回）"}
    closes = [r.get("close") for r in rows if isinstance(r.get("close"), (int, float))]
    highs = [r.get("high") for r in rows if isinstance(r.get("high"), (int, float))]
    lows = [r.get("low") for r in rows if isinstance(r.get("low"), (int, float))]
    stat = {}
    if closes:
        first, last = closes[0], closes[-1]
        stat = {
            "bars": len(rows), "first_close": first, "last_close": last,
            "change_pct": round((last - first) / first * 100, 2) if first else None,
            "highest": max(highs) if highs else None, "lowest": min(lows) if lows else None,
        }
        if stat["highest"] and stat["lowest"] and stat["lowest"]:
            stat["amplitude_pct"] = round((stat["highest"] - stat["lowest"]) / stat["lowest"] * 100, 2)
            stat["drawdown_from_high_pct"] = round((last - stat["highest"]) / stat["highest"] * 100, 2)
    # 明细只回最近 30 根，避免长周期请求把上下文撑爆
    detail = _pick(rows[-30:], ("date", "open", "close", "high", "low", "volume"), 30)
    return {"summary": stat, "recent": detail}


_FFLOW_DELAY = "https://push2delay.eastmoney.com/api/qt/stock/fflow/daykline/get"


def _fund_flow_today(code: str) -> list[dict]:
    """当日资金流（备用源）。

    主源 push2his 在部分网络下连不通（本机实测被拒），push2delay 这条延迟行情线路仍可达，
    代价是只给当天一条、拿不到历史。宁可给「今天」也不要整块缺失。
    """
    import requests

    secid = f"{1 if code.startswith('6') else 0}.{code}"
    params = {"secid": secid, "fields1": "f1,f2,f3,f7",
              "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65",
              "lmt": "120", "klt": "101"}
    headers = {"User-Agent": astock.UA, "Referer": "https://quote.eastmoney.com/",
               "Origin": "https://quote.eastmoney.com"}
    d = requests.get(_FFLOW_DELAY, params=params, headers=headers, timeout=12).json()
    out = []
    for line in (d.get("data") or {}).get("klines") or []:
        p = line.split(",")
        if len(p) < 6:
            continue
        def _f(x):
            try:
                return float(x)
            except (TypeError, ValueError):
                return 0.0
        out.append({"date": p[0], "main_net": _f(p[1]), "small_net": _f(p[2]),
                    "mid_net": _f(p[3]), "large_net": _f(p[4]), "super_net": _f(p[5])})
    return out


def _fund_flow(args: dict):
    code = str(args["code"])
    rows = astock.stock_fund_flow_120d(code)
    if not rows:
        try:
            rows = _fund_flow_today(code)
        except Exception:  # noqa: BLE001
            rows = []
        if rows:  # 备用源只有当日，明说清楚，别让模型误以为是完整历史
            return {"unit": "元", "note": "主源不可达，以下仅为当日资金流，无历史累计",
                    "recent": rows}
    if not rows:
        return {"error": "无资金流数据"}
    days = max(1, min(int(args.get("days") or 10), 60))
    tail = rows[-days:]
    def _sum(n: int) -> float:
        return round(sum(r.get("main_net", 0) for r in rows[-n:]) / 1e8, 3)
    return {
        "unit": "元（汇总项单位：亿元）",
        "main_net_5d_yi": _sum(5), "main_net_20d_yi": _sum(20), "main_net_60d_yi": _sum(60),
        "recent": _pick(tail, ("date", "main_net", "super_net", "large_net", "mid_net", "small_net"), days),
    }


def _fund_flow_minute(args: dict):
    code = str(args["code"])
    rows = astock.eastmoney_fund_flow_minute(code)
    if not rows:
        return {"error": "无分钟资金流数据（非交易时段或源不可用）"}
    day_main = round(sum(float(r.get("main_net") or 0) for r in rows), 2)
    return {
        "code": code,
        "unit": "元",
        "day_main_net": day_main,
        "latest": rows[-1],
        "recent": _pick(
            rows[-20:],
            ("time", "main_net", "super_net", "large_net", "mid_net", "small_net"),
            20,
        ),
    }


def _concepts(args: dict):
    code = str(args["code"])
    blocks = astock.concept_blocks(code)
    try:
        hot = astock.hot_concepts(code)
    except Exception:  # noqa: BLE001 — 热门概念是加分项，挂了不该拖垮板块归属
        hot = []
    return {
        "total_blocks": blocks.get("total", 0),
        "blocks": _pick(blocks.get("boards", []), ("name", "change_pct", "lead_stock"), 30),
        "hot_concepts": _pick(hot, ("concept", "hit"), 15),
    }


def _company_info(args: dict):
    """公司概况。akshare 的东财概况接口时好时坏，挂了就用腾讯行情 + 板块归属拼一份降级版，
    保证这个工具任何时候都能给出「这家公司是干什么的、多大体量」，而不是一个报错。"""
    code = str(args["code"])
    try:
        info = astock.individual_info(code)
        if info:
            return info
    except Exception:  # noqa: BLE001 — 上游接口不稳，转降级源
        pass
    q = (astock.tencent_quote([code]) or {}).get(code) or {}
    if not q:
        return {"error": "公司概况数据源当前不可达"}
    industry = ""
    try:
        boards = (astock.concept_blocks(code).get("boards") or [])
        industry = boards[0].get("name", "") if boards else ""
    except Exception:  # noqa: BLE001 — 行业是加分项，拿不到不影响主体
        pass
    return {
        "name": q.get("name"), "code": code, "industry_or_board": industry,
        "total_mcap_yi": q.get("mcap_yi"), "float_mcap_yi": q.get("float_mcap_yi"),
        "pe_ttm": q.get("pe_ttm"), "pb": q.get("pb"),
        "note": "概况接口暂不可用，以上为行情源降级数据（市值单位：亿元）",
    }


def _investor_qa(args: dict):
    """互动易：公司回复常有整段公文，截断后再喂，否则十几条就能吃掉整个上下文。"""
    rows = astock.investor_qa(str(args["code"]))
    out = []
    for r in _pick(rows, None, 12):
        q, a = (r.get("question") or ""), (r.get("answer") or "")
        out.append({
            "ask_time": r.get("ask_time"),
            "question": q[:200],
            "answer": a[:400] if a else "（未回复）",
        })
    return out


def _market(args: dict):
    scope = str(args.get("scope") or "overview")
    if scope == "indices":
        return astock.index_quote()
    if scope == "global":
        return market.get_global_indices()
    if scope == "emotion":
        d = market.get_short_term_emotion() or {}
        return {k: d.get(k) for k in ("tiers", "limitUp", "limitDown", "brokenRate", "promoteRate", "updated") if k in d} or d
    if scope == "turnover":
        d = market.get_turnover_top() or {}
        # Field names must match astock.market_turnover_rank() (#28).
        # Old keys turnover/changePct do not exist → AI tools saw nulls.
        return {
            "stocks": _pick(
                d.get("stocks", []),
                ("name", "code", "price", "pct", "amount", "mcap", "float_cap", "industry"),
                20,
            ),
            "updated": d.get("updated"),
        }
    return market.get_overview()


def _radar(args: dict):
    """资讯雷达：数据按 12 条赛道分组，这里摊平成一张扁平清单（每条带赛道名）方便模型阅读。
    可传 track 只看某条赛道；每赛道取最新若干条，避免 12×几十条把上下文吃光。"""
    d = newsradar.get_radar(force=False) or {}
    want = str(args.get("track") or "").strip()
    per = max(1, min(int(args.get("per_track") or 5), 20))
    out, total = [], 0
    for ind in d.get("industries") or []:
        name = ind.get("name", "")
        items = ind.get("items") or []
        total += len(items)
        if want and want not in name:
            continue
        for it in items[:per]:
            out.append({"track": name, "title": it.get("title"),
                        "time": it.get("time"), "source": it.get("source")})
    return {"generated_at": d.get("generated_at"), "total_cached": total,
            "tracks": [i.get("name") for i in (d.get("industries") or [])], "items": out}


# —— OpenVlab 期权 / 期货波动率（裁剪逻辑）——
_OVLAB_MARKET_KEYS = (
    "product_alias", "prodUnd", "exchange", "sector_alias",
    "price", "ctn", "atmv_current", "atmv_1dchg", "atmv_percentile",
    "rv22", "valphaT", "carry", "skew_current", "skew_percentile",
    "exp", "expiry_date", "last_time", "has_night_trading", "is_overseas",
)


def _ovlab_market(args: dict) -> dict:
    """市场概览: 全表可能几十上百行, 这里取关键字段 + 限制条数, 避免撑爆上下文。

    同时附「隐波最高 / 最低 TOP5」「偏度最高 / 最低 TOP5」两个机械汇总,
    让模型直接拿到密度而不是原始转储。
    """
    rows = ovlab.get_market_overview() or []
    if not rows:
        return {"error": "OpenVlab 市场概览暂无数据"}
    limit = int(args.get("limit") or 0)
    if limit > 0:
        rows = rows[:limit]
    items = [{k: r.get(k) for k in _OVLAB_MARKET_KEYS} for r in rows if isinstance(r, dict)]

    def _num(v) -> float | None:
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            try:
                return float(v)
            except ValueError:
                return None
        return None

    def _top(key: str, reverse: bool) -> list[dict]:
        valid = [{"name": r.get("product_alias"), "code": r.get("prodUnd"),
                 "val": n} for r in items if (n := _num(r.get(key))) is not None]
        valid.sort(key=lambda x: x["val"], reverse=reverse)
        return [{key: it["val"], "name": it["name"], "code": it["code"]} for it in valid[:5]]

    return {
        "total": len(items),
        "items": items,
        "atmv_top5": _top("atmv_current", True),
        "atmv_bottom5": _top("atmv_current", False),
        "skew_top5": _top("skew_current", True),
        "skew_bottom5": _top("skew_current", False),
    }


def _ovlab_detail(args: dict) -> dict:
    """单品种详情: 原始 dto 可能很大, 这里只回关键字段, 大数组截前若干条。

    顶层字段保留; 对已知的大数组 (如 contracts / greeks / vol_curve) 截前 20 条,
    其余字段原样透传, 让模型能看到结构又不被淹没。
    """
    prod_und = str(args.get("prod_und", "")).strip()
    if not prod_und:
        return {"error": "prod_und 不能为空"}
    exps = a.get("exps") if isinstance(a := args.get("exps"), list) else None
    data = ovlab.get_product_detail(prod_und, exps) or {}
    if not data:
        return {"error": f"未找到 OpenVlab 标的「{prod_und}」的详情"}
    _ARRAY_TRUNCATE_KEYS = ("contracts", "greeks", "vol_curve", "vol_smile", "ts", "term_structure")
    out: dict = {}
    for k, v in data.items():
        if isinstance(v, list) and k in _ARRAY_TRUNCATE_KEYS and len(v) > 20:
            out[k] = v[:20]
            out[f"_{k}_truncated"] = len(v)
        else:
            out[k] = v
    return out


def _ovlab_future_ts(args: dict) -> dict:
    """期货期限结构: all=全品种(按品种分组的字典, 只回非空品种) / single=单品种."""
    scope = str(args.get("scope") or "all")
    if scope == "single":
        prod = str(args.get("prod_und", "")).strip()
        if not prod:
            return {"error": "scope=single 时 prod_und 必填"}
        data = ovlab.get_future_term_structure(prod)
        return data if data else {"error": f"未找到 {prod} 的期货期限结构"}
    data = ovlab.get_future_term_structures_all() or {}
    # 只保留非空品种, 避免空字典撑爆上下文
    non_empty = {k: v for k, v in data.items() if v}
    return {"total": len(data), "non_empty": len(non_empty), "products": non_empty}


def _ovlab_flow_alert(args: dict) -> dict:
    """异动榜: 数百条, 这里取关键字段 + 限制条数, 并附机械汇总(按规则计数)."""
    from collections import Counter
    rows = ovlab.get_flow_alerts() or []
    if not rows:
        return {"error": "异动榜暂无数据"}
    keys = ("time", "instrument", "contract_code", "rule_id", "side", "price",
            "ctn", "open_interest", "window_volume", "window_premium", "pct_change")
    items = [{k: r.get(k) for k in keys} for r in rows if isinstance(r, dict)]
    # 按规则计数, 看哪种异动最多
    rule_count = Counter(r.get("rule_id") for r in items if r.get("rule_id"))
    return {
        "total": len(items),
        "recent": items[:30],
        "rule_count": dict(rule_count.most_common(10)),
    }


def _ovlab_warehouse_history(args: dict) -> dict:
    """单品种持仓历史: 返回含 year20xx 多年, 这里只回当前值 + 汇总, 明细截断."""
    product = str(args.get("product", "")).strip()
    if not product:
        return {"error": "product 必填"}
    data = ovlab.get_warehouse_history(product) or {}
    if not data:
        return {"error": f"未找到 {product} 的持仓历史"}
    # 提取各年汇总(每年取最后一条或value), 避免整块转储
    years = {k: v for k, v in data.items() if k.startswith("year") and v}
    return {
        "product": product,
        "last_update_time": data.get("last_update_time"),
        "current_value": data.get("value"),
        "category": data.get("category"),
        "years_summary": years,
        "ratio_data": data.get("ratioData"),
    }


def _ovlab_seasonal(args: dict) -> dict:
    """季节性持仓: 全品种时只回品种清单 + 每品种年数, 不转储整块."""
    years = a if isinstance(a := args.get("years"), list) else None
    product = args.get("product")
    data = ovlab.get_warehouse_seasonal_history_all(years, product) or {}
    if not data:
        return {"error": "季节性持仓暂无数据"}
    # 每品种只回它有哪些年份的 key, 不回完整序列
    summary = {k: list(v.keys()) if isinstance(v, dict) else type(v).__name__
               for k, v in data.items()}
    return {"products": list(data.keys()), "years_in_data": summary}


def _ovlab_meta(args: dict) -> dict:
    """元数据统一入口."""
    scope = str(args.get("scope") or "")
    if scope == "exchange":
        return {"exchanges": ovlab.get_exchange_info()}
    if scope == "sector":
        return {"sectors": ovlab.get_sector_info()}
    if scope == "next_trading_day":
        return {"next_trading_day": ovlab.get_next_trading_day()}
    if scope == "holidays":
        ex = str(args.get("exchange", "")).strip()
        if not ex:
            return {"error": "scope=holidays 时 exchange 必填"}
        return {"exchange": ex, "holidays": ovlab.get_holidays(ex)}
    return {"error": f"未知 scope: {scope}"}


def _ovlab_position(args: dict) -> dict:
    """持仓排名统一入口 (option-position / future-position)."""
    scope = str(args.get("scope") or "products")
    kind = str(args.get("kind") or "future")
    if scope == "products":
        if kind == "option":
            return ovlab.get_option_position_products() or {"error": "期权持仓品种暂无数据"}
        return ovlab.get_future_position_products() or {"error": "期货持仓品种暂无数据"}
    if scope == "details":
        product = str(args.get("product", "")).strip()
        code = str(args.get("code", "")).strip()
        day = str(args.get("day", "")).strip()
        if not (product and code and day):
            return {"error": "scope=details 时 product/code/day 必填"}
        if kind == "option":
            direction = str(args.get("direction", "")).strip().upper()
            if direction not in ("C", "P"):
                return {"error": "kind=option 时 direction 必填 (C 或 P)"}
            return ovlab.get_option_position_details(product, code, direction, day) or {"error": "该合约期权持仓明细暂无数据"}
        return ovlab.get_future_position_details(product, code, "0", day) or {"error": "该合约期货持仓明细暂无数据"}
    return {"error": f"未知 scope: {scope}"}


def _ovlab_chart(args: dict) -> dict:
    """K线 / ATM隐波历史统一入口."""
    kind = str(args.get("kind") or "kline").lower()
    symbol = str(args.get("symbol", "")).strip()
    if not symbol:
        return {"error": "symbol 必填"}
    resolution = str(args.get("resolution") or "1D")
    from_ts = args.get("from_ts")
    to_ts = args.get("to_ts")
    if from_ts is not None:
        from_ts = int(from_ts)
    if to_ts is not None:
        to_ts = int(to_ts)
    if kind == "atmvol":
        return ovlab.get_atmvol_history(symbol, resolution, from_ts, to_ts) or {"error": "ATM隐波历史暂无数据"}
    return ovlab.get_kline_history(symbol, resolution, from_ts, to_ts) or {"error": "K线历史暂无数据"}


def _ovlab_search(args: dict) -> dict:
    """合约搜索."""
    kw = str(args.get("keyword", "")).strip()
    if not kw:
        return {"error": "keyword 必填"}
    limit = args.get("limit")
    limit = int(limit) if limit else 30
    return {"data": ovlab.search_symbols(kw, limit) or []}


def _ovlab_flow_data(args: dict) -> dict:
    """异动资金流分页."""
    product = str(args.get("product", "")).strip() or None
    page = int(args.get("page") or 1)
    page_size = int(args.get("page_size") or 50)
    body: dict[str, Any] = {"page": page, "page_size": page_size}
    if product:
        body["product"] = product
    return ovlab.get_flow_data(body=body) or {"error": "异动资金流暂无数据"}


def _ovlab_vol_surface(args: dict) -> dict:
    """波动率曲面."""
    product = str(args.get("product", "")).strip()
    if not product:
        return {"error": "product 必填"}
    return ovlab.get_volatility_surface(product) or {"error": "波动率曲面暂无数据"}


# name -> 执行函数。绝大多数是「调后端函数 + 裁剪」，复杂的抽成上面的私有函数。
_HANDLERS = {
    "query_quote": lambda a: astock.tencent_quote([str(c) for c in a.get("codes", [])]),
    "query_valuation": lambda a: astock.full_valuation(str(a["code"])),
    "query_valuation_percentile": lambda a: astock.valuation_percentile(str(a["code"])),
    "query_kline": _kline,
    "query_financials": lambda a: astock.financials(str(a["code"])),
    "query_company_info": _company_info,
    "query_reports": lambda a: _pick(astock.eastmoney_reports(str(a["code"]), max_pages=1),
                                     ("title", "publishDate", "orgSName", "emRatingName"), 15),
    "query_news": lambda a: _pick(astock.stock_news(str(a["code"]), limit=15),
                                  ("新闻标题", "发布时间", "文章来源"), 15),
    "query_cls_telegraph": lambda a: {
        "source": "财联社",
        "items": _pick(
            astock.cls_telegraph(int(a.get("limit") or 30)),
            ("time", "title", "content"),
            int(a.get("limit") or 30),
        ),
    },
    "query_global_news": lambda a: {
        "source": "东财7x24",
        "items": _pick(
            astock.eastmoney_global_news(int(a.get("limit") or 30)),
            ("time", "title", "summary"),
            int(a.get("limit") or 30),
        ),
    },
    "query_iwencai": lambda a: astock.iwencai_search(
        str(a.get("query") or ""),
        channel=str(a.get("channel") or "report"),
        size=int(a.get("size") or 15),
    ),
    "query_fund_flow": _fund_flow,
    "query_fund_flow_minute": lambda a: _fund_flow_minute(a),
    "query_ths_limit_up": lambda a: astock.ths_limit_up_pool(a.get("date") or None),
    "query_margin": lambda a: _pick(astock.margin_trading(str(a["code"])),
                                    ("date", "rzye", "rzmre", "rzche", "rqye", "rzrqye"), 15),
    "query_holders": lambda a: _pick(astock.holder_num_change(str(a["code"])), None, 10),
    "query_etf_flow": lambda a: {
        "sort_by": a.get("sort_by") or "net_inflow",
        "rows": _pick(
            astock.etf_fund_flow(
                str(a.get("sort_by") or "net_inflow"),
                int(a.get("limit") or 30),
            ),
            ("code", "name", "change_pct", "main_net_inflow", "super_large_net", "large_net"),
            int(a.get("limit") or 30),
        ),
    },
    "query_shareholder_changes": lambda a: _pick(
        astock.shareholder_changes(
            str(a.get("code") or ""),
            str(a.get("change_type") or "all"),
            int(a.get("limit") or 30),
        ),
        ("date", "code", "name", "person", "change_type", "change_shares", "avg_price", "position"),
        int(a.get("limit") or 30),
    ),
    "query_lpr": lambda a: {
        "source": "chinamoney.com.cn",
        "rows": astock.lpr_rates(int(a.get("days") or 365)),
    },
    "query_cn_bond_yield": lambda a: astock.bond_yield_curve(str(a.get("curve_type") or "treasury")),
    "query_block_trade": lambda a: _pick(astock.block_trade(str(a["code"])), None, 15),
    "query_dragon_tiger": lambda a: astock.dragon_tiger_board(str(a["code"])),
    "query_daily_dragon_tiger": lambda a: astock.daily_dragon_tiger(
        a.get("date") or None,
        top=int(a.get("top") or 30),
    ),
    "query_dividend": lambda a: _pick(astock.dividend_history(str(a["code"])), None, 12),
    "query_announcements": lambda a: _pick(astock.announcements(str(a["code"])), ("title", "date", "type"), 15),
    "query_lockup": lambda a: astock.lockup_expiry(str(a["code"])),
    "query_investor_qa": _investor_qa,
    "query_concepts": _concepts,
    "query_industry_comparison": lambda a: astock.industry_comparison(top_n=max(5, min(int(a.get("top_n") or 20), 50))),
    "query_industry_reports": lambda a: _pick(
        astock.eastmoney_industry_reports(keywords=a.get("keywords"), days=int(a.get("days") or 90), max_pages=1),
        ("title", "publishDate", "orgSName", "industryName"), 20),
    "query_market": _market,
    "query_news_radar": _radar,
    "query_global_stock": lambda a: gstock.us_hk_stock(str(a.get("symbol", ""))) or {"error": "未找到该美股/港股/韩股代码"},
    "query_hk_cashflow": lambda a: gstock.hk_cashflow(str(a.get("symbol", ""))) or {"error": "未找到该港股现金流（仅港股支持）"},

    # —— OpenVlab 期权 / 期货波动率 ——
    "query_ovlab_market": lambda a: _ovlab_market(a),
    "query_ovlab_detail": lambda a: _ovlab_detail(a),
    "query_ovlab_volatility_ts": lambda a: ovlab.get_volatility_term_structures() or {"error": "波动率期限结构暂无数据"},
    "query_ovlab_future_ts": lambda a: _ovlab_future_ts(a),
    "query_ovlab_flow_alert": lambda a: _ovlab_flow_alert(a),
    "query_ovlab_warehouse_history": lambda a: _ovlab_warehouse_history(a),
    "query_ovlab_seasonal_history": lambda a: _ovlab_seasonal(a),
    "query_ovlab_product_exps": lambda a: ovlab.get_product_exps(a.get("prod_und")) or {"error": "合约月份暂无数据"},
    "query_ovlab_meta": lambda a: _ovlab_meta(a),
    "query_ovlab_position": lambda a: _ovlab_position(a),
    "query_ovlab_chart": lambda a: _ovlab_chart(a),
    "query_ovlab_search": lambda a: _ovlab_search(a),
    "query_ovlab_flow_data": lambda a: _ovlab_flow_data(a),
    "query_ovlab_vol_surface": lambda a: _ovlab_vol_surface(a),
}


def exec_tool(name: str, args: dict):
    """执行工具，返回可序列化结果（失败返回 error 字段，不抛）。"""
    fn = _HANDLERS.get(name)
    if fn is None:
        return {"error": f"未知工具 {name}"}
    try:
        return fn(args or {})
    except astock.DependencyMissing as e:
        return {"error": str(e)}
    except KeyError as e:
        return {"error": f"{name} 缺少必填参数 {e}"}
    except Exception as e:  # noqa: BLE001 — 工具错误回喂给模型，不中断循环
        return {"error": f"{name} 执行失败：{e}"}
