"""美股 / 港股数据层 —— 移植自 global-stock-data（美港股全栈工具包）。

并入：
- 东财域内合规子集：全球指数 + 美港股行情 + 关键财务指标
- 美股日 K：Yahoo 前复权（主）+ 新浪不复权（备）

用途＝A 股「看隔夜外围脸色」+ 个股页支持美港股代码 + 「美股」页观察列表/K线。

工程要点：
- 东财调用全部复用 `astock.em_get`（直连优先、避开用户 Clash 代理挂国内站）+
  `astock.eastmoney_datacenter`（datacenter 三表/指标已封装）。
- push2 stock/get 直连偶发掉连 → **push2 优先、失败降级 push2delay**（延时行情，研究场景足够），
  latch 到可用主机整进程复用（同成交额榜的做法）。
- 美股前复权依赖 Yahoo chart；不可达时回退新浪（不复权）。

合规：只做客观数据整理，不预置标的、不推荐、不预测。
"""

from __future__ import annotations

import json
import re

import astock

_UA_H = {"User-Agent": astock.UA}
_GS_HOSTS = ("push2.eastmoney.com", "push2delay.eastmoney.com")
_gs_host = [0]  # 当前可用主机下标；首次 push2 掉连后 latch 到 push2delay

# 全球指数（东财 push2 secid）—— A 股看隔夜外围脸色的核心几个，均已实测。
_INDICES = (
    {"key": "dji", "name": "道琼斯", "secid": "100.DJIA", "region": "美股"},
    {"key": "spx", "name": "标普500", "secid": "100.SPX", "region": "美股"},
    {"key": "ndx", "name": "纳斯达克", "secid": "100.NDX", "region": "美股"},
    {"key": "hsi", "name": "恒生指数", "secid": "100.HSI", "region": "港股"},
    {"key": "hstech", "name": "恒生科技", "secid": "124.HSTECH", "region": "港股"},
)

# 搜索返回的 MktNum → (secucode 后缀, 市场名)
_MKT = {105: (".O", "NASDAQ"), 106: (".N", "NYSE"), 107: (".O", "US"), 116: (".HK", "HK"),
        177: (".KS", "KR")}  # 177=韩股（Kospi/Kosdaq，含三星/SK海力士等半导体龙头）；东财仅行情、无 F10 财务

_QUOTE_FIELDS = "f43,f44,f45,f46,f48,f57,f58,f59,f60,f116,f170"
# Resolve results rarely change; cache to avoid re-probing 105/106/107 on every watchlist refresh
_RESOLVE_CACHE: dict[str, dict | None] = {}


def _push2_stock_get(secid: str, fields: str) -> dict | None:
    """东财 push2 stock/get：push2 优先、失败降级 push2delay；latch 可用主机。空数据返回 None。"""
    params = {"secid": secid, "fields": fields}
    for i in range(_gs_host[0], len(_GS_HOSTS)):
        try:
            r = astock.em_get(f"https://{_GS_HOSTS[i]}/api/qt/stock/get",
                              params=params, headers=_UA_H, timeout=10)
            d = r.json().get("data")
        except Exception:
            continue
        if d:
            _gs_host[0] = i
            return d
    return None


def _price(d: dict, key: str):
    """f43 等价格字段：除以 10^f59 还原。'-' / None → None。"""
    v = d.get(key)
    if not isinstance(v, (int, float)):
        return None
    dec = d.get("f59")
    if not isinstance(dec, int):  # 注意：不能用 `or 2`——韩元等 f59=0 会被误判成 2，价格被多除 100 倍
        dec = 2
    return round(v / (10 ** dec), dec)


def _quote_from(d: dict) -> dict:
    chg = d.get("f170")
    return {
        "code": d.get("f57"), "name": d.get("f58"),
        "price": _price(d, "f43"), "open": _price(d, "f46"),
        "high": _price(d, "f44"), "low": _price(d, "f45"),
        "prev_close": _price(d, "f60"),
        "amount": d.get("f48") if isinstance(d.get("f48"), (int, float)) else None,
        "mcap": d.get("f116") if isinstance(d.get("f116"), (int, float)) and d.get("f116") else None,
        "change_pct": round(chg / 100, 2) if isinstance(chg, (int, float)) else None,
    }


def global_indices() -> list[dict]:
    """全球指数快照（道指 / 标普500 / 纳斯达克 / 恒生 / 恒生科技）。源无的档跳过。"""
    out = []
    for idx in _INDICES:
        d = _push2_stock_get(idx["secid"], "f43,f57,f58,f59,f60,f170")
        if not d:
            continue
        chg = d.get("f170")
        out.append({
            "key": idx["key"], "name": idx["name"], "region": idx["region"],
            "price": _price(d, "f43"),
            "change_pct": round(chg / 100, 2) if isinstance(chg, (int, float)) else None,
        })
    return out


def _parse_em_json(resp) -> dict:
    """Eastmoney sometimes wraps JSON in JSONP (jQuery...(...))."""
    text = (resp.text or "").strip()
    if not text:
        return {}
    if text[0] not in "{[":
        m = re.search(r"^[^(]*\((.*)\)\s*;?\s*$", text, re.S)
        if m:
            text = m.group(1)
    try:
        data = json.loads(text)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


class SearchUnavailable(RuntimeError):
    """证券搜索接口不可用（网络 / 风控 / 返回体变形）。

    与「查无此代码」严格区分：前者是基础设施问题、重试可能就好，后者是用户输错了。
    压成同一个 None 会让用户对着"未找到对应美股/港股/韩股代码"完全无从下手（#26）。
    """


# 主端点 + 备用端点。单一端点被风控/变更就让整块功能瘫痪，代价太大。
_SEARCH_ENDPOINTS = (
    "https://searchapi.eastmoney.com/api/suggest/get",
    "https://searchadapter.eastmoney.com/api/suggest/get",
)


def _search(q: str) -> dict | None:
    """东财搜索一次：市场过滤 + **精确代码匹配优先**，退而取第一条。

    只按 MktNum 过滤挑不出正股——东财搜 AAPL 会混入 AAPL22(票据)/AAPB(2倍做多ETF)，
    搜 BABA 混入 05593(窝轮)，且 SecurityType 分不开(正股与 ETF 同为 Type7、正股港股与窝轮同为 Type6)。
    正股的 Code 恰好等于查询词，故精确匹配 Code==q 最稳；无精确匹配(名称查询)才退回第一条。
    """
    params = {"input": q, "type": 14,
              "token": "D43BF722C8E33BDC906FB84D85E326E8", "count": 10}

    rows, last_error = None, None
    for url in _SEARCH_ENDPOINTS:
        try:
            r = astock.em_get(url, params=params, headers=_UA_H, timeout=10)
            status = getattr(r, "status_code", 200)
            if status >= 400:
                # em_get 不会 raise_for_status，HTTP 错误页照样能 .json() 成功
                raise RuntimeError(f"HTTP {status}")
            # Prefer .json(); fall back to local JSONP unwrap when body is wrapped.
            try:
                payload = r.json()
            except Exception:
                payload = _parse_em_json(r)
        except Exception as e:  # noqa: BLE001 — 网络/HTTP/JSON 解析都可能
            last_error = f"{url} → {type(e).__name__}: {str(e)[:80]}"
            continue

        # 必须校验响应结构再决定收手。少了这一步，主端点返回「合法 JSON 但没有
        # QuotationCodeTable」（错误响应 / 接口改版 / 风控页）时会被当成"查得到但
        # 没有匹配"，直接 break —— 备用端点根本轮不上（#26）。
        table = payload.get("QuotationCodeTable") if isinstance(payload, dict) else None
        data = table.get("Data") if isinstance(table, dict) else None
        if not isinstance(data, list):
            last_error = (
                f"{url} → 响应结构异常（缺少 QuotationCodeTable.Data 或类型不对）"
                f"，可能是接口改版或被风控页拦截"
            )
            continue

        rows = data   # 结构正常但为空 = 真的没匹配到
        break

    if rows is None:
        # 全部端点都请求失败 ≠ 查无此票（#26）
        raise SearchUnavailable(
            f"证券搜索接口暂时不可用（已尝试 {len(_SEARCH_ENDPOINTS)} 个端点）。"
            f"最后一个错误：{last_error}。"
            f"这与「查无此代码」是两回事——请检查网络 / 代理，或稍后重试。"
        )
    matches = []
    for s in rows:
        try:
            mkt = int(s.get("MktNum"))
        except (TypeError, ValueError):
            continue
        if mkt in _MKT:
            matches.append((mkt, s))
    if not matches:
        return None
    mkt, s = next(((m, x) for m, x in matches if str(x.get("Code", "")).upper() == q), matches[0])
    suffix, market = _MKT[mkt]
    code = s.get("Code", "")
    return {"code": code, "name": s.get("Name", ""), "secid_prefix": mkt,
            "secucode": f"{code}{suffix}", "market": market}


def _resolve_us_via_push2(code: str) -> dict | None:
    """Suggest API is often broken for US tickers; probe push2 secids instead.

    Market prefixes: 105=NASDAQ, 106=NYSE, 107=US other (ETFs etc).
    Also try BRK.B <-> BRK-B style aliases.
    """
    variants = [code]
    if "." in code:
        variants.append(code.replace(".", "-"))
    elif "-" in code:
        variants.append(code.replace("-", "."))
    seen: set[str] = set()
    for c in variants:
        if c in seen:
            continue
        seen.add(c)
        for mkt in (105, 106, 107):
            d = _push2_stock_get(f"{mkt}.{c}", "f57,f58")
            if not d or not d.get("f57"):
                continue
            raw = str(d.get("f57") or c)
            suffix, market = _MKT[mkt]
            return {
                "code": raw,
                "name": d.get("f58") or raw,
                "secid_prefix": mkt,
                "secucode": f"{raw}{suffix}",
                "market": market,
            }
    return None


def resolve_symbol(query: str) -> dict | None:
    """代码/名称 → {code, name, secid_prefix, secucode, market}。认美股/港股/韩股。
    数字型港股短代码（如 `700`）补零到 5 位再试一次（东财按 `00700` 收）。
    韩股用国际后缀 `.KS`/`.KQ`/`.KR`（如三星 `005930.KS`）——韩股代码与 A 股同为 6 位数字，
    需显式后缀区分，否则前端会按 A 股处理、后端也搜不到韩股。
    美股 ticker 在 suggest 失效时走 push2 探测回退。"""
    q = query.strip().upper()
    if not q:
        return None
    for suf in (".KS", ".KQ", ".KR"):  # 剥掉韩股后缀，按裸代码搜（东财 177=韩股）
        if q.endswith(suf):
            q = q[: -len(suf)]
            break
    if q in _RESOLVE_CACHE:
        return _RESOLVE_CACHE[q]

    # Pure US tickers: skip broken suggest API, resolve via push2 (fast path for watchlist)
    if re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,7}", q) and not q.isdigit():
        hit = _resolve_us_via_push2(q) or _search(q)
        _RESOLVE_CACHE[q] = hit
        return hit

    hit = _search(q)
    if hit is None and q.isdigit() and len(q) < 5:
        hit = _search(q.zfill(5))
    _RESOLVE_CACHE[q] = hit
    return hit


def _key_metrics(secucode: str) -> dict | None:
    """东财 GMAININDICATOR 最新一期关键财务指标（美股/港股中文字段）。"""
    market = "HK" if secucode.endswith(".HK") else "US"
    rows = astock.eastmoney_datacenter(
        f"RPT_{market}F10_FN_GMAININDICATOR",
        filter_str=f'(SECUCODE="{secucode}")',
        page_size=1, sort_columns="REPORT_DATE", sort_types="-1")
    if not rows:
        return None
    m = rows[0]
    return {
        "report_date": str(m.get("REPORT_DATE") or "")[:10],
        "revenue": m.get("OPERATE_INCOME"),
        "revenue_yoy": m.get("OPERATE_INCOME_YOY"),
        "net_profit": m.get("PARENT_HOLDER_NETPROFIT") or m.get("HOLDER_PROFIT"),
        "eps": m.get("BASIC_EPS"),
        "roe": m.get("ROE_AVG"),
        "gross_margin": m.get("GROSS_PROFIT_RATIO"),
        "net_margin": m.get("NET_PROFIT_RATIO"),
        "debt_ratio": m.get("DEBT_ASSET_RATIO"),
    }


def us_hk_stock(query: str, *, with_metrics: bool = True) -> dict:
    """个股聚合（美/港）：解析代码 → 行情 + 可选关键财务指标。查不到返回 {}。

    with_metrics=False：只行情（观察列表批量刷新用，避开东财 F10 慢请求）。
    """
    info = resolve_symbol(query)
    if not info:
        return {}
    d = _push2_stock_get(f"{info['secid_prefix']}.{info['code']}", _QUOTE_FIELDS)
    quote = _quote_from(d or {})  # 行情临时取不到也返回完整 null 形状，契合 GlobalQuote 类型
    metrics = None
    if with_metrics and info["market"] != "KR":  # 韩股东财无 F10 财务
        metrics = _key_metrics(info["secucode"])
    return {
        "code": info["code"],
        "name": info["name"] or quote.get("name") or info["code"],
        "market": info["market"],
        "quote": quote,
        "metrics": metrics,
    }


def _us_kline_yahoo_qfq(code: str, n: int) -> list[dict]:
    """Yahoo chart v8: forward-adjust OHLC by adjclose/close (前复权).

    Latest close stays aligned with market price; history scaled for splits/dividends.
    Yahoo class shares use '-' (BRK-B); normalize '.' -> '-'.
    """
    import requests
    from datetime import datetime

    ysym = code.replace(".", "-")
    # 365 trading days ~ 1.5y calendar; pull 2y then truncate
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}"
    r = requests.get(
        url,
        params={"interval": "1d", "range": "2y", "includeAdjustedClose": "true"},
        headers={"User-Agent": astock.UA},
        timeout=20,
    )
    r.raise_for_status()
    res = ((r.json().get("chart") or {}).get("result") or [None])[0]
    if not res:
        return []
    timestamps = res.get("timestamp") or []
    quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    adj_list = ((res.get("indicators") or {}).get("adjclose") or [{}])
    adjclose = (adj_list[0].get("adjclose") if adj_list else None) or []

    bars: list[dict] = []
    for i, ts in enumerate(timestamps):
        try:
            o, h, l, c = quote["open"][i], quote["high"][i], quote["low"][i], quote["close"][i]
            if o is None or h is None or l is None or c is None or c == 0:
                continue
            adj = adjclose[i] if i < len(adjclose) else None
            factor = (float(adj) / float(c)) if adj not in (None, 0) else 1.0
            bars.append({
                "date": datetime.fromtimestamp(ts).strftime("%Y-%m-%d"),
                "open": round(float(o) * factor, 4),
                "high": round(float(h) * factor, 4),
                "low": round(float(l) * factor, 4),
                "close": round(float(c) * factor, 4),
                "volume": int(quote["volume"][i] or 0),
            })
        except (TypeError, ValueError, KeyError, IndexError):
            continue
    return bars[-n:]


def _us_kline_sina(code: str, n: int) -> list[dict]:
    """Sina US daily K — unadjusted fallback when Yahoo unreachable."""
    import requests

    url = "https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var/US_MinKService.getDailyK"
    r = requests.get(
        url,
        params={"symbol": code, "num": n},
        headers={"Referer": "https://finance.sina.com.cn/", "User-Agent": astock.UA},
        timeout=15,
    )
    r.raise_for_status()
    m = re.search(r"\((\[.+\])\)", r.text, re.S)
    if not m:
        return []
    items = json.loads(m.group(1))
    bars: list[dict] = []
    for item in items:
        try:
            bars.append({
                "date": str(item.get("d") or ""),
                "open": float(item.get("o") or 0),
                "high": float(item.get("h") or 0),
                "low": float(item.get("l") or 0),
                "close": float(item.get("c") or 0),
                "volume": int(float(item.get("v") or 0)),
            })
        except (TypeError, ValueError):
            continue
    return bars[-n:]


def us_stock_kline(symbol: str, num: int = 180) -> dict:
    """美股日 K，默认前复权（Yahoo adjclose 缩放 OHLC）。

    symbol: 如 AAPL / TSLA；仅美股 ticker。
    num: 返回最近 N 根。
    返回: {code, name, market, source, adjust: qfq|none, bars: [...]}
    Yahoo 不可达时回退新浪（不复权, adjust=none）。
    """
    sym = (symbol or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,7}", sym):
        return {}
    info = resolve_symbol(sym)
    if info and info.get("market") not in ("NASDAQ", "NYSE", "US"):
        return {}
    code = (info or {}).get("code") or sym
    name = (info or {}).get("name") or code
    n = max(20, min(int(num or 180), 1000))

    bars: list[dict] = []
    source, adjust = "yahoo", "qfq"
    try:
        bars = _us_kline_yahoo_qfq(code, n)
    except Exception:
        bars = []
    if not bars:
        try:
            bars = _us_kline_sina(code, n)
            source, adjust = "sina", "none"
        except Exception:
            bars = []
    if not bars:
        return {}
    return {
        "code": code,
        "name": name,
        "market": "US",
        "source": source,
        "adjust": adjust,
        "bars": bars,
    }


def _hk_yahoo_symbol(code: str) -> str:
    """00700 -> 0700.HK (Yahoo HK convention)."""
    n = str(code).lstrip("0") or "0"
    return f"{n.zfill(4)}.HK"


def hk_stock_kline(symbol: str, num: int = 180) -> dict:
    """港股日 K（Yahoo 前复权）。symbol 如 00700 / 700。

    新浪港股 K 已失效；东财 push2his 不返回港股 K。
    Yahoo 可直连，不依赖东财 resolve（suggest 偶发挂掉时仍可用）。
    """
    raw = (symbol or "").strip().upper().removesuffix(".HK")
    info = resolve_symbol(raw) if raw else None
    if info and info.get("market") not in (None, "HK"):
        return {}
    # Prefer resolved 5-digit HK code; else accept pure digits (pad to 5)
    if info and info.get("market") == "HK":
        code = str(info["code"])
        name = info.get("name") or code
    elif raw.isdigit() and len(raw) <= 5:
        code = raw.zfill(5)
        name = code
    else:
        return {}
    n = max(20, min(int(num or 180), 1000))
    ysym = _hk_yahoo_symbol(code)
    bars: list[dict] = []
    try:
        import requests
        from datetime import datetime

        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}"
        r = requests.get(
            url,
            params={"interval": "1d", "range": "2y", "includeAdjustedClose": "true"},
            headers={"User-Agent": astock.UA},
            timeout=20,
        )
        r.raise_for_status()
        res = ((r.json().get("chart") or {}).get("result") or [None])[0]
        if not res:
            return {}
        # Prefer Yahoo shortName when Eastmoney resolve failed
        meta = res.get("meta") or {}
        if name == code and meta.get("shortName"):
            name = str(meta["shortName"])
        timestamps = res.get("timestamp") or []
        quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
        adj_list = ((res.get("indicators") or {}).get("adjclose") or [{}])
        adjclose = (adj_list[0].get("adjclose") if adj_list else None) or []
        for i, ts in enumerate(timestamps):
            try:
                o, h, l, c = quote["open"][i], quote["high"][i], quote["low"][i], quote["close"][i]
                if o is None or h is None or l is None or c is None or c == 0:
                    continue
                adj = adjclose[i] if i < len(adjclose) else None
                factor = (float(adj) / float(c)) if adj not in (None, 0) else 1.0
                bars.append({
                    "date": datetime.fromtimestamp(ts).strftime("%Y-%m-%d"),
                    "open": round(float(o) * factor, 4),
                    "high": round(float(h) * factor, 4),
                    "low": round(float(l) * factor, 4),
                    "close": round(float(c) * factor, 4),
                    "volume": int(quote["volume"][i] or 0),
                })
            except (TypeError, ValueError, KeyError, IndexError):
                continue
        bars = bars[-n:]
    except Exception:
        bars = []
    if not bars:
        return {}
    return {
        "code": code,
        "name": name,
        "market": "HK",
        "source": "yahoo",
        "adjust": "qfq",
        "bars": bars,
    }


# 港股现金流量表汇总科目：东财 RPT_HKSK_FN_CASHFLOW 的 STD_ITEM_CODE → 中文标签。
# 用稳定数字码作 key（不用东财中文 ITEM_NAME，避开其编码/措辞差异）；实测每期返回这 8 行汇总。
_HK_CF_ITEMS = {
    "003999": "经营活动现金流净额",
    "005999": "投资活动现金流净额",
    "007999": "筹资活动现金流净额",
    "006999": "汇率变动前现金净额",
    "011997": "汇率变动等其他影响",
    "010999": "现金及等价物净增加",
    "011001": "期初现金及等价物",
    "011999": "期末现金及等价物",
}
_HK_CF_ORDER = ("003999", "005999", "007999", "006999", "011997", "010999", "011001", "011999")


def hk_cashflow(query: str, periods: int = 8) -> dict:
    """港股现金流量表（东财 datacenter RPT_HKSK_FN_CASHFLOW，与已接入 GMAININDICATOR 同为东财域内源）。

    按 REPORT_DATE 分组还原每期汇总（经营 / 投资 / 筹资 / 净增加 / 期初期末），返回最近 `periods` 期。
    金额为原生币种（见 `currency`，港股多为人民币或港元），季度为 YTD 累计、附同比。
    非港股（美/韩股，其现金流走 F10/SK 或无）或查不到 → 返回 {}。
    """
    info = resolve_symbol(query)
    if not info or not info["secucode"].endswith(".HK"):
        return {}
    # ⚠️ 该端点是**按科目逐行**返回的，一期就有几十行（实测腾讯 00700 最多 52 行/期、
    # 工行 01398 38 行/期）。只按 SECUCODE 取 300 行，最新 8 期根本装不下——
    # 最旧的那期会被截断成残缺科目，而且不报错。所以在**服务端**就按需要的科目码过滤：
    # 实测同样 300 行，覆盖期数从 13 期升到 39 期，请求量反而更小。
    item_filter = "(STD_ITEM_CODE in (" + ",".join(f'"{c}"' for c in _HK_CF_ORDER) + "))"
    rows = astock.eastmoney_datacenter(
        "RPT_HKSK_FN_CASHFLOW",
        filter_str=f'(SECUCODE="{info["secucode"]}"){item_filter}',
        page_size=300, sort_columns="REPORT_DATE", sort_types="-1")
    if not rows:
        return {}
    by_period: dict[str, dict] = {}
    for r in rows:
        rd = str(r.get("REPORT_DATE") or "")[:10]
        code = str(r.get("STD_ITEM_CODE") or "")
        if not rd or code not in _HK_CF_ITEMS:
            continue
        p = by_period.setdefault(rd, {
            "report_date": rd, "report": r.get("REPORT"),
            "currency": r.get("CURRENCY"), "account_standard": r.get("ACCOUNT_STANDARD"),
            "items": {},
        })
        amt, yoy = r.get("AMOUNT"), r.get("YOY_RATIO")
        p["items"][_HK_CF_ITEMS[code]] = {
            "amount": amt if isinstance(amt, (int, float)) else None,
            "yoy": yoy if isinstance(yoy, (int, float)) else None,
        }
    if not by_period:
        return {}
    periods_out = sorted(by_period.values(), key=lambda x: x["report_date"], reverse=True)[:periods]
    return {
        "code": info["code"], "name": info["name"], "market": "HK",
        "currency": periods_out[0].get("currency"),
        "item_order": [_HK_CF_ITEMS[c] for c in _HK_CF_ORDER],
        "periods": periods_out,
    }
