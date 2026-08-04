"""OpenVlab 数据层 —— 期权 / 期货波动率市场数据(移植自 openvlab.cn 爬虫).

数据源: https://www.openvlab.cn/api/* (公开 REST, 无鉴权)
- /api/ctamap-all          市场页主表格, 全部品种概览
- /api/dto/{prodUnd}       单个标的详细数据, 如 510300
- /api/volatility-ts-all   波动率期限结构汇总

设计:
- 只读, 无状态, 客观呈现公开数据, 不推荐 / 不预测 / 不评分.
- 全站共享一份缓存 (TTL 默认 5 分钟), 多用户多次打开只抓一次,
  盘中 5 分钟刷新足够, 也避免对 openvlab 服务器造成压力.
- 数据源故障的空结果不缓存, 下次请求直接重试.
- requests 惰性导入: 缺失时对应函数抛 DependencyMissing, app 层转 501 + 安装提示.
"""

from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

BASE_URL = "https://www.openvlab.cn"
API_PREFIX = "/api"

DEFAULT_HEADERS = {
    "Accept": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": f"{BASE_URL}/market",
}

# 市场概览主表格字段 (api_field -> 中文表头), 与 openvlab.cn/market 页面一致
MARKET_OVERVIEW_COLUMNS: list[tuple[str, str]] = [
    ("product_alias", "品种名称"),
    ("prodUnd", "标的代码"),
    ("product", "产品代码"),
    ("exchange", "交易所"),
    ("sector_alias", "板块"),
    ("sector", "板块代码"),
    ("price", "最新价"),
    ("ctn", "涨跌幅"),
    ("atmv_current", "平值隐波"),
    ("atmv_1dchg", "隐波变化"),
    ("atmv_percentile", "隐波百分位"),
    ("rv22", "22日实波"),
    ("valphaT", "VolAlphaT"),
    ("carry", "Carry"),
    ("skew_current", "偏度"),
    ("skew_1dchg", "偏度日变化"),
    ("skew_percentile", "偏度百分位"),
    ("frontfwd_mom", "近远月动量"),
    ("exp", "主力合约"),
    ("expiry_date", "到期日"),
    ("last_time", "更新时间"),
    ("has_night_trading", "夜盘"),
    ("is_overseas", "境外品种"),
]


class DependencyMissing(RuntimeError):
    """缺少 requests 依赖时抛出, app 层转 501 + 安装提示."""


def _requests():
    try:
        import requests  # noqa: PLC0415
    except ImportError as e:
        raise DependencyMissing("openvlab 数据需要 requests: pip install requests") from e
    return requests


_CACHE: dict = {}
_TTL = 300  # 5 分钟, 全站共享


def _cached(key: str, fn, valid=bool, ttl: float | None = None):
    """TTL 缓存. 数据源故障的空结果不缓存 (valid 判否), 下次请求直接重试.
    ttl: 自定义缓存秒数, 默认用全局 _TTL.
    """
    now = time.time()
    eff_ttl = _TTL if ttl is None else ttl
    hit = _CACHE.get(key)
    if hit and now - hit[0] < eff_ttl:
        return hit[1]
    val = fn()
    if valid(val):
        _CACHE[key] = (now, val)
    return val


def _get(path: str, params: dict[str, Any] | None = None, timeout: float = 20.0) -> Any:
    """统一 GET, 校验 openvlab 的 {code, result, message} 响应壳."""
    requests = _requests()
    url = f"{BASE_URL}{API_PREFIX}/{path.lstrip('/')}"
    logger.debug("GET %s params=%s", url, params)
    resp = requests.get(url, params=params, headers=DEFAULT_HEADERS, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("code") != 0:
        raise RuntimeError(
            f"openvlab API error on {path}: code={payload.get('code')} "
            f"message={payload.get('message', 'unknown error')}"
        )
    return payload.get("result")


def _post(path: str, body: dict[str, Any] | None = None, timeout: float = 25.0) -> Any:
    """统一 POST (JSON body), 校验响应壳. 用于 warehouse/last-bars/flow-data 等."""
    requests = _requests()
    url = f"{BASE_URL}{API_PREFIX}/{path.lstrip('/')}"
    logger.debug("POST %s body=%s", url, body)
    headers = {**DEFAULT_HEADERS, "Content-Type": "application/json"}
    resp = requests.post(url, json=body or {}, headers=headers, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("code") != 0:
        raise RuntimeError(
            f"openvlab API error on {path}: code={payload.get('code')} "
            f"message={payload.get('message', 'unknown error')}"
        )
    return payload.get("result")


def get_market_overview() -> list[dict[str, Any]]:
    """市场概览: 全部品种的行情 / 隐波 / 偏度 / carry 等概览 (ctamap-all).

    返回原始 list[dict], 字段见 MARKET_OVERVIEW_COLUMNS. 含缓存 5 分钟.
    """
    return _cached(
        "ovlab_market",
        lambda: _get("ctamap-all"),
        valid=lambda v: isinstance(v, list) and len(v) > 0,
    )


def get_product_detail(prod_und: str, exps: list[str] | None = None) -> dict[str, Any]:
    """单个标的详细数据 (dto/{prodUnd}), 如 510300.

    prod_und: 标的代码 (prodUnd 字段)
    exps: 可选, 指定主力合约月份列表, 逗号拼接传给接口
    返回原始 dict. 含缓存 5 分钟 (按 prod_und + exps 分别缓存).
    """
    prod_und = (prod_und or "").strip()
    if not prod_und:
        return {}
    params = None
    if exps:
        params = {"exps": ",".join(exps)}
    cache_key = f"ovlab_detail::{prod_und}::{','.join(exps or [])}"
    return _cached(
        cache_key,
        lambda: _get(f"dto/{prod_und}", params=params),
        valid=lambda v: isinstance(v, dict) and bool(v),
    )


def get_volatility_term_structures() -> dict[str, Any]:
    """波动率期限结构汇总 (volatility-ts-all).

    部分字段可能受限, 失败返回空 dict. 含缓存 5 分钟.
    """
    return _cached(
        "ovlab_vol_ts",
        lambda: _get("volatility-ts-all"),
        valid=lambda v: isinstance(v, dict) and bool(v),
    )


# ---------------------------------------------------------------------------
# 期货期限结构
# ---------------------------------------------------------------------------

def get_future_term_structures_all() -> dict[str, Any]:
    """期货期限结构汇总 (future-ts-all), 全品种. 含缓存 5 分钟."""
    return _cached(
        "ovlab_future_ts_all",
        lambda: _get("future-ts-all"),
        valid=lambda v: isinstance(v, dict) and bool(v),
    )


def get_future_term_structure(prod_und: str) -> dict[str, Any]:
    """单个标的的期货期限结构 (future-ts/{prodUnd}). 含缓存 5 分钟."""
    prod_und = (prod_und or "").strip()
    if not prod_und:
        return {}
    return _cached(
        f"ovlab_future_ts::{prod_und}",
        lambda: _get(f"future-ts/{prod_und}"),
        valid=lambda v: isinstance(v, dict),
    )


# ---------------------------------------------------------------------------
# 异动 / 资金流
# ---------------------------------------------------------------------------

def get_flow_alerts() -> list[dict[str, Any]]:
    """异动榜 (flow-alert): 合约/规则/价格/涨跌/持仓量/窗口成交量/权利金等.

    数据量较大 (数百条), 含缓存 5 分钟.
    """
    return _cached(
        "ovlab_flow_alert",
        lambda: _get("flow-alert"),
        valid=lambda v: isinstance(v, list) and len(v) > 0,
    )


def get_flow_data(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """资金流分页数据 (flow-data, POST). body 可含分页/筛选参数. 不缓存 (POST, 参数多变)."""
    return _post("flow-data", body=body)


# ---------------------------------------------------------------------------
# 持仓 / 仓差 / 季节性
# ---------------------------------------------------------------------------

def get_warehouse_history(product: str) -> dict[str, Any]:
    """单品种多年持仓历史 (warehouse/history, POST).

    product: 品种代码如 MA. 返回 value(当前) + year2013~year2026 + ratioData + category.
    仓差 / 资金面 / 季节性分析用. 含缓存 5 分钟 (按 product).
    """
    product = (product or "").strip()
    if not product:
        return {}
    return _cached(
        f"ovlab_wh_history::{product}",
        lambda: _post("warehouse/history", body={"product": product}),
        valid=lambda v: isinstance(v, dict) and bool(v),
    )


def get_warehouse_seasonal_history_all(
    years: list[str] | None = None,
    product: str | None = None,
) -> dict[str, Any]:
    """全品种季节性持仓 (warehouse/seasonal-history-all, POST).

    years: 年份字符串列表如 ['2020','2021','2022','2023','2024','2025']
    product: 可选, 指定单品种
    返回按品种分组的多年持仓. 数据量大 (数百 KB). 含缓存 5 分钟 (按 years+product).
    """
    if not years:
        years = ["2020", "2021", "2022", "2023", "2024", "2025"]
    body: dict[str, Any] = {"years": years}
    if product:
        body["product"] = product.strip()
    cache_key = f"ovlab_wh_seasonal::{','.join(years)}::{product or ''}"
    return _cached(
        cache_key,
        lambda: _post("warehouse/seasonal-history-all", body=body),
        valid=lambda v: isinstance(v, dict) and bool(v),
    )


# ---------------------------------------------------------------------------
# K 线 / 价格波动率 (POST, 需具体合约代码)
# ---------------------------------------------------------------------------

def get_last_bars(codes: list[str]) -> list[dict[str, Any]]:
    """最新 K 线 (last-bars, POST).

    codes: 具体合约代码列表如 ['ps2609-C-40000']. 注意 prodUnd(如 510300) 通常返回空,
    需用具体合约代码 (可从 product-exps / dto 取). 不缓存 (实时行情).
    """
    if not codes:
        return []
    return _post("last-bars", body={"codes": codes}) or []


def get_current_batch(codes: list[str]) -> dict[str, Any]:
    """当前批次 (current-batch, POST). codes 为具体合约代码列表. 不缓存."""
    if not codes:
        return {}
    return _post("current-batch", body={"codes": codes}) or {}


def get_price_volatility_series(codes: str) -> list[dict[str, Any]]:
    """价格波动率序列 (price-volatility-series, POST).

    codes: 逗号分隔的合约代码字符串如 '510300,510050'. 不缓存.
    """
    codes = (codes or "").strip()
    if not codes:
        return []
    return _post("price-volatility-series", body={"codes": codes}) or []


# ---------------------------------------------------------------------------
# 元数据
# ---------------------------------------------------------------------------

def get_product_exps(prod_und: str | None = None) -> list[dict[str, Any]]:
    """全品种合约月份列表 (product-exps).

    prod_und: 可选, 指定单品种. 返回 75 个品种的合约月份. 含缓存 30 分钟 (日级静态).
    """
    cache_key = f"ovlab_product_exps::{prod_und or 'all'}"
    params = {"prodUnd": prod_und} if prod_und else None
    return _cached(
        cache_key,
        lambda: _get("product-exps", params=params),
        valid=lambda v: isinstance(v, list) and len(v) > 0,
        ttl=1800,
    )


def get_exchange_info() -> list[dict[str, Any]]:
    """交易所信息 (exchange-info). 含缓存 1 小时 (基本不变)."""
    return _cached(
        "ovlab_exchange_info",
        lambda: _get("exchange-info"),
        valid=lambda v: isinstance(v, list) and len(v) > 0,
        ttl=3600,
    )


def get_sector_info() -> list[dict[str, Any]]:
    """板块信息 (sector-info). 含缓存 1 小时."""
    return _cached(
        "ovlab_sector_info",
        lambda: _get("sector-info"),
        valid=lambda v: isinstance(v, list) and len(v) > 0,
        ttl=3600,
    )


def get_next_trading_day() -> str:
    """下一交易日 (next-trading-day). 含缓存 1 小时."""
    return _cached(
        "ovlab_next_trading_day",
        lambda: _get("next-trading-day"),
        valid=lambda v: isinstance(v, str) and bool(v),
        ttl=3600,
    )


def get_holidays(exchange: str) -> Any:
    """某交易所的节假日日历 (holidays/{exchange}). exchange 如 CZCE. 含缓存 1 小时."""
    exchange = (exchange or "").strip()
    if not exchange:
        return []
    return _cached(
        f"ovlab_holidays::{exchange}",
        lambda: _get(f"holidays/{exchange}"),
        valid=lambda v: bool(v),
        ttl=3600,
    )


def get_expired(prod_und: str) -> dict[str, Any]:
    """某标的的已过期合约 (expired/{prodUnd}). 含缓存 30 分钟."""
    prod_und = (prod_und or "").strip()
    if not prod_und:
        return {}
    return _cached(
        f"ovlab_expired::{prod_und}",
        lambda: _get(f"expired/{prod_und}"),
        valid=lambda v: isinstance(v, dict),
        ttl=1800,
    )


# ---------------------------------------------------------------------------
# 期权合约批量查询 (POST, 需完整合约字段)
# ---------------------------------------------------------------------------

def query_instruments_batch(instrument_queries: list[dict[str, Any]]) -> Any:
    """期权合约批量查询 (instrument-query-batch, POST).

    instrument_queries 每项需含: type / prodUnd / exp(到期日) / option_type(C/P) / strike(行权价).
    不缓存 (参数多变).
    """
    if not instrument_queries:
        return []
    return _post("instrument-query-batch", body={"instrument_queries": instrument_queries})


def get_instrument_series_batch(instruments: list[dict[str, Any]]) -> Any:
    """期权合约序列批量查询 (instrument-series-batch, POST).

    instruments 每项需含: type / prodUnd / exp / option_type / strike.
    不缓存.
    """
    if not instruments:
        return []
    return _post("instrument-series-batch", body={"instruments": instruments})


# ---------------------------------------------------------------------------
# 轻量行情图表 (chart/light) —— K 线 / 隐波 / 最新bar / 合约信息 / 曲面
# ---------------------------------------------------------------------------

def _history_get(path: str, symbol: str, resolution: str = "1D",
                  from_ts: int | None = None, to_ts: int | None = None) -> dict[str, Any]:
    """K 线 / 隐波历史公共拉取 (history / history-atmvol, GET).

    symbol: 合约代码如 SC2609 / 510300; resolution: 1D / 1H / 5m / 1m 等;
    from_ts / to_ts: Unix 秒, 默认近 1 年. 不缓存 (时间范围多变, 实时段会更新).
    """
    sym = (symbol or "").strip()
    if not sym:
        return {"data": []}
    now = int(time.time())
    params = {
        "symbol": sym,
        "resolution": resolution or "1D",
        "from": from_ts if from_ts is not None else now - 365 * 86400,
        "to": to_ts if to_ts is not None else now,
    }
    return _get(path, params=params)


def get_kline_history(symbol: str, resolution: str = "1D",
                      from_ts: int | None = None, to_ts: int | None = None) -> dict[str, Any]:
    """K 线历史 (history, GET).

    返回 {data:[{trade_date,open,high,low,close,...}]}. 不缓存.
    """
    return _history_get("history", symbol, resolution, from_ts, to_ts)


def get_atmvol_history(symbol: str, resolution: str = "1D",
                       from_ts: int | None = None, to_ts: int | None = None) -> dict[str, Any]:
    """ATM 隐含波动率历史 (history-atmvol, GET).

    参数同 get_kline_history. 返回 {data:[[date, atmvol], ...]}. 不缓存.
    """
    return _history_get("history-atmvol", symbol, resolution, from_ts, to_ts)


def get_last_bar(code: str) -> dict[str, Any]:
    """单个合约最新 bar (last-bar/{code}, GET). 实时 OHLC + oi + vol. 不缓存."""
    code = (code or "").strip()
    if not code:
        return {}
    return _get(f"last-bar/{code}")


def search_symbols(keyword: str = "", limit: int = 30) -> list[dict[str, Any]]:
    """标的搜索 (search-symbols, GET). keyword 模糊匹配, 返回合约元信息列表. 短缓存 60s."""
    kw = (keyword or "").strip()
    params: dict[str, Any] = {"keyword": kw} if kw else {}
    if limit and limit > 0:
        params["limit"] = limit
    return _cached(
        f"ovlab_search::{kw}::{limit}",
        lambda: _get("search-symbols", params=params) or [],
        valid=lambda v: isinstance(v, list),
        ttl=60,
    )


def get_symbol_info(code: str) -> dict[str, Any]:
    """合约元信息 (symbol/{code}, GET): 交易所/交易时段/价格精度/到期日. 缓存 30 分钟."""
    code = (code or "").strip()
    if not code:
        return {}
    return _cached(
        f"ovlab_symbol::{code}",
        lambda: _get(f"symbol/{code}"),
        valid=lambda v: isinstance(v, dict) and bool(v),
        ttl=1800,
    )


def get_volatility_surface(product: str) -> dict[str, Any]:
    """波动率曲面 (volatility-surface/{product}, GET). 按到期月分组的 T 型报价/持仓. 缓存 2 分钟."""
    p = (product or "").strip()
    if not p:
        return {}
    return _cached(
        f"ovlab_volsurface::{p}",
        lambda: _get(f"volatility-surface/{p}"),
        valid=lambda v: isinstance(v, dict) and bool(v),
        ttl=120,
    )


def get_skewmap(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """偏度图 (skewmap, POST). body 可含 selectedExpiries. 不缓存 (POST)."""
    return _post("skewmap", body=body or {})


def get_surfacemap(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """曲面图 (surfacemap, GET). params 可含 product 等. 缓存 2 分钟."""
    p = params or {}
    key = f"ovlab_surfacemap::{sorted(p.items())}"
    return _cached(
        key,
        lambda: _get("surfacemap", params=p),
        valid=lambda v: isinstance(v, dict) and bool(v),
        ttl=120,
    )


# ---------------------------------------------------------------------------
# 持仓排名 (flow/option-flow) —— 期权 / 期货 持仓品种列表 + 持仓明细排名
# ---------------------------------------------------------------------------

def get_option_position_products() -> dict[str, Any]:
    """期权持仓品种列表 (option-position/products, GET).
    返回 {last_trading_day, products:[{product, product_alias, exchange_name, codes}]}.
    缓存 1 小时 (品种元数据低频变动).
    """
    return _cached(
        "ovlab_opt_pos_products",
        lambda: _get("option-position/products"),
        valid=lambda v: isinstance(v, dict) and bool(v),
        ttl=3600,
    )


def get_option_position_details(product: str, code: str, direction: str, day: str) -> dict[str, Any]:
    """期权持仓明细 (option-position/details, GET).
    product: 品种如 SC/IO; code: 合约如 SC2609; direction: C 或 P; day: YYYY-MM-DD.
    返回持仓排名表/图表数据 (可能为空 dict, 某些合约无明细). 缓存 5 分钟.
    响应为双层壳 {code:0, result:{code:200, message, data:{...}}}, 取 result.data.
    """
    p = (product or "").strip()
    c = (code or "").strip()
    d = (direction or "").strip().upper()
    dy = (day or "").strip()
    if not (p and c and d and dy):
        return {}
    if d not in ("C", "P"):
        return {}
    params = {"product": p, "code": c, "direction": d, "day": dy}
    key = f"ovlab_opt_pos_detail::{p}::{c}::{d}::{dy}"

    def _fetch() -> dict[str, Any]:
        r = _get("option-position/details", params=params)
        if isinstance(r, dict) and isinstance(r.get("data"), dict):
            return r["data"]
        return r if isinstance(r, dict) else {}

    return _cached(
        key,
        _fetch,
        valid=lambda v: isinstance(v, dict),
    )


def get_future_position_products() -> dict[str, Any]:
    """期货持仓品种列表 (future-position/products, GET).
    返回 {last_trading_day, products:[{product, product_alias, exchange_name, codes}]}.
    缓存 1 小时.
    """
    return _cached(
        "ovlab_fut_pos_products",
        lambda: _get("future-position/products"),
        valid=lambda v: isinstance(v, dict) and bool(v),
        ttl=3600,
    )


def get_future_position_details(product: str, code: str, direction: str, day: str) -> dict[str, Any]:
    """期货持仓明细 (future-position/details, GET).
    product: 品种如 RB; code: 合约如 rb2608; direction: 任意 (后端忽略, 传 0 即可); day: YYYY-MM-DD.
    返回 {codes, futureName, instrument, tradingDay, days, short_rank_table, long_rank_table,
    net_short_rank_table, net_long_rank_table, *_rank_chart, maxNetShort, maxNetLong, status}.
    缓存 5 分钟. 响应为双层壳, 取 result.data.
    """
    p = (product or "").strip()
    c = (code or "").strip()
    d = (direction or "0").strip()
    dy = (day or "").strip()
    if not (p and c and dy):
        return {}
    params = {"product": p, "code": c, "direction": d, "day": dy}
    key = f"ovlab_fut_pos_detail::{p}::{c}::{dy}"

    def _fetch() -> dict[str, Any]:
        r = _get("future-position/details", params=params)
        if isinstance(r, dict) and isinstance(r.get("data"), dict):
            return r["data"]
        return r if isinstance(r, dict) else {}

    return _cached(
        key,
        _fetch,
        valid=lambda v: isinstance(v, dict),
    )
