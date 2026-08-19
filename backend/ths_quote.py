"""同花顺 fuyao 行情网关 —— 股票 / 指数 / 商品指数的快照、日 K、分钟线.

数据源: https://quota-h.10jqka.com.cn/fuyao/common_hq_aggr/quote/v1/* (免鉴权)
- POST multi_last_snapshot   批量快照 (按市场分组, 一次多码)
- POST single_kline          K线 (time_period: day_1 日K, min_1/min_5 分钟)

约束 (实测 2026-08):
- Referer 必须带 stockpage 代码路径 (https://stockpage.10jqka.com.cn/{code}/), 裸域名 403.
- 市场码: 16 沪指(1A0001/1B0300) | 17 沪股 | 32 深指(399xxx) | 33 深股 | 48 板块(883/885xxx) | 64 同花顺指数(850xxx 商品等).
- 字段是数字 ID: 1=时间戳(ms) 6=昨收 7=开 8=高 9=低 10=最新(快照) 11=收(K线) 13=量 19=额 1771976=量比.
  199112 (涨跌) 语义随市场漂移 (股票是涨跌幅%, 商品指数是涨跌额), 不取; 涨跌幅一律由 最新/昨收 现算.
- 缓存同全站惯例: TTLCache serve_last, 空结果不缓存, 下次直接重试.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from cache import TTLCache, is_nonempty

logger = logging.getLogger(__name__)

GW = "https://quota-h.10jqka.com.cn/fuyao/common_hq_aggr/quote/v1"
PAGE = "https://stockpage.10jqka.com.cn"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# 快照字段: 昨收 开 高 低 最新 量 额 量比
_SNAP_FIELDS = ["6", "7", "8", "9", "10", "13", "19", "1771976"]
# K线字段: 时间 开 高 低 收 量 额
_KLINE_FIELDS = ["1", "7", "8", "9", "11", "13", "19"]

PERIODS = ("day_1", "min_1", "min_5")

_CACHE = TTLCache(maxsize=256, default_ttl=5, negative_ttl=0, name="ths_quote")


class DependencyMissing(RuntimeError):
    """缺少 requests 依赖时抛出, app 层转 501 + 安装提示."""


def _requests():
    try:
        import requests  # noqa: PLC0415
    except ImportError as e:
        raise DependencyMissing("同花顺行情需要 requests: pip install requests") from e
    return requests


_SESSION = None
_SESSION_LOCK = threading.Lock()


def _http():
    """One process-wide Session; Referer still set per request (path must include code)."""
    global _SESSION
    requests = _requests()
    if _SESSION is None:
        with _SESSION_LOCK:
            if _SESSION is None:
                _SESSION = requests.Session()
    return _SESSION


def detect_market(code: str) -> str | None:
    """按代码猜市场码. 指数用同花顺原码 (1A0001 / 399001); 6 位 000xxx 默认深股."""
    c = (code or "").strip().upper()
    if not c:
        return None
    if c.startswith(("1A", "1B")):
        return "16"
    if c.startswith("399"):
        return "32"
    if c.startswith(("883", "885", "886")):
        return "48"
    if c.startswith(("850", "851")):
        return "64"
    if c.startswith("6"):
        return "17"
    if c.startswith(("0", "3")):
        return "33"
    return None


def split_code(raw: str) -> tuple[str, str] | None:
    """'17_600519' / '64:850001' / 裸码 '600519' -> (market, code). 判不出返回 None."""
    s = (raw or "").strip()
    if not s:
        return None
    for sep in ("_", ":"):
        if sep in s:
            mkt, _, code = s.partition(sep)
            if mkt.strip().isdigit() and code.strip():
                return mkt.strip(), code.strip().upper()
            return None
    mkt = detect_market(s)
    return (mkt, s) if mkt else None


def _post(ep: str, body: dict[str, Any], code: str, timeout: float = 15.0) -> Any:
    """统一 POST, 校验 {status_code, data} 响应壳. Referer 必须带代码路径."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": _UA,
        "Referer": f"{PAGE}/{code}/",
        "Origin": PAGE,
    }
    resp = _http().post(f"{GW}/{ep}", json=body, headers=headers, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("status_code") != 0:
        raise RuntimeError(
            f"ths fuyao error on {ep}: status_code={payload.get('status_code')} "
            f"msg={payload.get('status_msg', 'unknown')}"
        )
    return payload.get("data")


def _rows(data: Any) -> list[dict[str, Any]]:
    """quote_data 列表; 每项 data_fields + value(行列表)."""
    if not isinstance(data, dict):
        return []
    q = data.get("quote_data")
    return q if isinstance(q, list) else []


def snapshot(pairs: list[tuple[str, str]]) -> list[dict[str, Any]]:
    """批量快照. pairs: [(market, code)]. 返回 [{market, code, last, prev, open, high, low, pct, volume, amount, lb}]."""
    groups: dict[str, list[str]] = {}
    for mkt, code in pairs:
        groups.setdefault(mkt, []).append(code)
    if not groups:
        return []
    body = {
        "code_list": [{"market": m, "codes": cs} for m, cs in groups.items()],
        "trade_class": "intraday",
        "data_fields": _SNAP_FIELDS,
        "lang": "zh_cn",
        "gpid": 1,
    }
    first_code = pairs[0][1]
    data = _post("multi_last_snapshot", body, first_code)
    out: list[dict[str, Any]] = []
    for item in _rows(data):
        fields = item.get("data_fields") or []
        values = (item.get("value") or [[]])[0]
        m = dict(zip(fields, values))

        def fnum(fid: str) -> float | None:
            v = m.get(fid)
            return float(v) if isinstance(v, (int, float)) else None

        last, prev = fnum("10"), fnum("6")
        pct = ((last - prev) / prev * 100) if last is not None and prev else None
        out.append({
            "market": str(item.get("market") or ""),
            "code": str(item.get("code") or ""),
            "last": last,
            "prev": prev,
            "open": fnum("7"),
            "high": fnum("8"),
            "low": fnum("9"),
            "pct": pct,
            "volume": fnum("13"),
            "amount": fnum("19"),
            "lb": fnum("1771976"),
        })
    return out


def snapshot_codes(codes: list[str]) -> list[dict[str, Any]]:
    """裸码/带市场前缀混合的批量快照, 5s 热缓存 + 上一笔. 判不出市场的码静默跳过."""
    pairs = [p for p in (split_code(c) for c in codes) if p]
    if not pairs:
        return []
    key = "ths_snap::" + ",".join(f"{m}:{c}" for m, c in sorted(pairs))
    return _CACHE.get_or_set(
        key,
        lambda: snapshot(pairs),
        ttl=5,
        valid=is_nonempty,
        negative_ttl=0,
        serve_last=True,
    )


def kline(market: str, code: str, period: str = "day_1", count: int = 400) -> list[dict[str, Any]]:
    """K线. period: day_1 日K(前复权) / min_1 / min_5. count 根数 (begin_time=-count).

    返回 [{t, open, high, low, close, volume, amount}], t 为 ms 时间戳, 按时间升序.
    """
    if period not in PERIODS:
        raise ValueError(f"period 必须是 {PERIODS} 之一")
    count = max(1, min(int(count), 2000))
    body = {
        "code_list": [{"market": market, "codes": [code]}],
        "trade_class": "intraday",
        "time_period": period,
        "trade_date": -1,
        "begin_time": -count,
        "end_time": 0,
        "adjust_type": "forward",
        "gpid": 1,
    }
    data = _post("single_kline", body, code)
    rows = _rows(data)
    if not rows:
        return []
    fields = rows[0].get("data_fields") or []
    out: list[dict[str, Any]] = []
    for v in rows[0].get("value") or []:
        m = dict(zip(fields, v))

        def knum(fid: str) -> float | None:
            x = m.get(fid)
            return float(x) if isinstance(x, (int, float)) else None

        t = m.get("1")
        out.append({
            "t": int(t) if isinstance(t, (int, float)) else None,
            "open": knum("7"),
            "high": knum("8"),
            "low": knum("9"),
            "close": knum("11"),
            "volume": knum("13"),
            "amount": knum("19"),
        })
    return out


def kline_cached(market: str, code: str, period: str = "day_1", count: int = 400) -> list[dict[str, Any]]:
    """K线带缓存: 日K 300s, 分钟 30s, serve_last."""
    ttl = 30 if period.startswith("min_") else 300
    key = f"ths_k::{market}:{code}:{period}:{count}"
    return _CACHE.get_or_set(
        key,
        lambda: kline(market, code, period, count),
        ttl=ttl,
        valid=is_nonempty,
        negative_ttl=0,
        serve_last=True,
    )
