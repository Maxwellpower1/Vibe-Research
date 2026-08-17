"""市场总览数据层 —— 市场情绪 + 板块资金流（板块/大盘级公开数据，不涉个股推荐）。

省流量：全站共享一份缓存（TTL 默认 5 分钟），多个用户/多次打开只抓一次；
盘中 5 分钟刷新足够，非交易时段数据本就不变。数据源全免费、无 key。
"""

from __future__ import annotations

from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

import astock

BEIJING = timezone(timedelta(hours=8))
_TTL = 300


def _num(v) -> int:
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return 0


def _sentiment() -> dict:
    """市场情绪：涨跌家数/涨停跌停/活跃度 + 大盘宽度、题材投机（客观数据机械分档）。"""
    try:
        # akshare 惰性导入（同 astock 模式）：未装时降级返回空，不挡整个服务启动
        df = astock._akshare().stock_market_activity_legu()
        d = {row["item"]: row["value"] for _, row in df.iterrows()}
    except Exception:
        return {}
    up, down, flat = _num(d.get("上涨")), _num(d.get("下跌")), _num(d.get("平盘"))
    zt, zt_real = _num(d.get("涨停")), _num(d.get("真实涨停"))
    dt, dt_real = _num(d.get("跌停")), _num(d.get("真实跌停"))
    r = up / max(down, 1)
    if up < 600:
        breadth = "冰点"
    elif r < 0.7:
        breadth = "偏弱"
    elif r < 1.2:
        breadth = "中性"
    elif r < 2.5:
        breadth = "偏强"
    else:
        breadth = "普涨"
    speculation = "亢奋" if zt_real >= 100 else "活跃" if zt_real >= 60 else "普通" if zt_real >= 30 else "冰点"
    return {
        "up": up, "down": down, "flat": flat,
        "zt": zt, "zt_real": zt_real, "dt": dt, "dt_real": dt_real,
        "active": str(d.get("活跃度", "")),
        "breadth": breadth, "speculation": speculation,
        "date": str(d.get("统计日期", "")),
    }


def _sectors() -> list[dict]:
    """行业资金流（按净额降序）。不含领涨股等个股字段。"""
    try:
        f = astock._akshare().stock_fund_flow_industry(symbol="即时")
        f = f.sort_values("净额", ascending=False)
    except Exception:
        return []
    out = []
    for _, row in f.iterrows():
        out.append({
            "name": str(row["行业"]),
            "pct": round(float(row.get("行业-涨跌幅", 0) or 0), 2),
            "net": round(float(row.get("净额", 0) or 0), 2),
            "inflow": round(float(row.get("流入资金", 0) or 0), 2),
            "outflow": round(float(row.get("流出资金", 0) or 0), 2),
            "firms": _num(row.get("公司家数")),
        })
    return out


def _overview_payload() -> dict:
    return {
        "sentiment": _sentiment(),
        "sectors": _sectors(),
        "updated": datetime.now(BEIJING).strftime("%Y-%m-%d %H:%M"),
    }


def _overview_ok(v) -> bool:
    return bool(isinstance(v, dict) and (v.get("sentiment") or v.get("sectors")))


def get_overview() -> dict:
    """市场情绪 + 板块资金. 与预热同一把 _DC_CACHE 钥匙."""
    from api_common import _read

    return _read("overview", "live", _TTL, _overview_payload, valid=_overview_ok)


def put_overview() -> dict:
    """Warmup force-write. Same key get_overview reads."""
    from api_common import put_fetch

    return put_fetch("overview", "live", _TTL, _overview_payload, valid=_overview_ok)


def _emotion() -> dict:
    """短线情绪（聚合口径，**零个股名**）：连板梯队 / 最高连板 / 炸板率 / 封板率 / 晋级率 / 涨跌停家数。

    数据源＝东财涨停板四池（push2ex）。只把池子聚合成计数与比率，
    **不输出任何个股 code/name**——守产品「零标的」红线（个股清单是甩名单，不做）。
    """
    # 定位最近交易日：从今天往前回溯，第一日有涨停池即取（非交易日/盘前返空则继续回溯）。
    today = datetime.now(BEIJING).date()
    resolved, zt = "", []
    for back in range(8):
        d = (today - timedelta(days=back)).strftime("%Y%m%d")
        zt = astock.em_zt_topic_pool("getTopicZTPool", d, "fbt:asc")
        if zt:
            resolved = d
            break
    if not resolved:
        return {}

    extra: dict[str, list] = {"zb": [], "dt": [], "yzt": []}

    def _fill(kind: str, endpoint: str, sort: str) -> None:
        extra[kind] = astock.em_zt_topic_pool(endpoint, resolved, sort)

    with ThreadPoolExecutor(max_workers=3) as pool:
        futs = [
            pool.submit(_fill, "zb", "getTopicZBPool", "fbt:asc"),
            pool.submit(_fill, "dt", "getTopicDTPool", "fund:asc"),
            pool.submit(_fill, "yzt", "getYesterdayZTPool", "zs:desc"),
        ]
        for fut in as_completed(futs):
            fut.result()
    zb, dt, yzt = extra["zb"], extra["dt"], extra["yzt"]

    boards = [_num(p.get("lbc")) or 1 for p in zt]      # 每只连板数（缺省按 1 板）
    lianban = [b for b in boards if b >= 2]             # 2 板及以上（连板）
    # 连板梯队：1/2/3/4/5+ 各多少家（5 代表 5 板及以上），只保留有家数的档
    tiers = Counter(min(b, 5) for b in boards)
    ladder = [{"boards": b, "count": tiers[b], "plus": b >= 5} for b in sorted(tiers)]

    def _zt_row(p: dict) -> dict:
        return {
            "code": str(p.get("c", "")), "name": p.get("n", ""),
            "boards": _num(p.get("lbc")) or 1,
            "price": round((astock._numf(p.get("p")) or 0) / 1000, 2),
            "pct": round(astock._numf(p.get("zdp")) or 0, 2),
            "amount": astock._numf(p.get("amount")),
            "float_cap": astock._numf(p.get("ltsz")),
            "industry": p.get("hybk", ""),
        }

    def _dt_row(p: dict) -> dict:
        return {
            "code": str(p.get("c", "")), "name": p.get("n", ""),
            "boards": _num(p.get("days")) or 1,
            "price": round((astock._numf(p.get("p")) or 0) / 1000, 2),
            "pct": round(astock._numf(p.get("zdp")) or 0, 2),
            "amount": astock._numf(p.get("amount")),
            "float_cap": astock._numf(p.get("ltsz")),
            "industry": p.get("hybk", ""),
        }

    # All limit-up names for the cockpit ladder (incl. 1-board). 2+ kept as lianban_stocks.
    zt_stocks = sorted((_zt_row(p) for p in zt), key=lambda x: (-x["boards"], -(x["amount"] or 0)))
    lianban_stocks = [s for s in zt_stocks if s["boards"] >= 2]
    dt_days = [_num(p.get("days")) or 1 for p in dt]
    dt_tiers = Counter(min(b, 5) for b in dt_days)
    dt_ladder = [{"boards": b, "count": dt_tiers[b], "plus": b >= 5} for b in sorted(dt_tiers)]
    dt_stocks = sorted((_dt_row(p) for p in dt), key=lambda x: (-x["boards"], -(x["amount"] or 0)))

    zt_count, zb_count, yzt_count = len(zt), len(zb), len(yzt)
    attempts = zt_count + zb_count                       # 尝试涨停 = 封住 + 炸板
    seal_rate = round(zt_count / attempts, 3) if attempts else None      # 封板率
    break_rate = round(zb_count / attempts, 3) if attempts else None     # 炸板率
    # 晋级率＝今日 2 板+（＝昨涨停今又停）÷ 昨日涨停家数
    promotion_rate = round(len(lianban) / yzt_count, 3) if yzt_count else None

    out = {
        "date": f"{resolved[:4]}-{resolved[4:6]}-{resolved[6:]}",
        "zt_count": zt_count,
        "dt_count": len(dt),
        "zb_count": zb_count,
        "max_boards": max(boards) if boards else 0,
        "lianban_count": len(lianban),
        "ladder": ladder,
        "zt_stocks": zt_stocks,
        "dt_ladder": dt_ladder,
        "dt_stocks": dt_stocks,
        "lianban_stocks": lianban_stocks,
        "seal_rate": seal_rate,
        "break_rate": break_rate,
        "promotion_rate": promotion_rate,
        "yzt_count": yzt_count,
        "seals": _seal_counts(zt, dt),
    }
    return out


def _seal_counts(zt: list, dt: list) -> dict:
    """True/fake limit boards from Tencent bid1/ask1. Only zt + dt names."""
    codes: list[str] = []
    for p in list(zt) + list(dt):
        c = str((p or {}).get("c") or "")
        if c.isdigit() and len(c) == 6:
            codes.append(c)
    quotes: dict = {}
    if codes:
        try:
            quotes = astock.tencent_quote(codes)
        except Exception:
            quotes = {}
    sealed_up = fake_up = sealed_down = fake_down = unknown = 0
    for p in zt:
        flag = astock.seal_flag(quotes.get(str((p or {}).get("c") or "")), "up")
        if flag is None:
            unknown += 1
        elif flag:
            sealed_up += 1
        else:
            fake_up += 1
    for p in dt:
        flag = astock.seal_flag(quotes.get(str((p or {}).get("c") or "")), "down")
        if flag is None:
            unknown += 1
        elif flag:
            sealed_down += 1
        else:
            fake_down += 1
    return {
        "sealed_up": sealed_up,
        "fake_up": fake_up,
        "sealed_down": sealed_down,
        "fake_down": fake_down,
        "unknown": unknown,
    }


def get_short_term_emotion() -> dict:
    """短线情绪. 与预热同一把 _DC_CACHE 钥匙."""
    from api_common import _read

    return _read("emotion", "live", _TTL, _emotion)


def put_emotion() -> dict:
    """Warmup force-write. Same key get_short_term_emotion reads."""
    from api_common import put_fetch

    return put_fetch("emotion", "live", _TTL, _emotion)


def get_turnover_top() -> dict:
    """全市场成交额榜 Top20 (Sina hs_a). Cache 5 min."""
    def build():
        stocks = []
        try:
            import cockpit_live
            stocks = cockpit_live.sina_amount_rank(20)
        except Exception:
            stocks = []
        return {
            "stocks": stocks,
            "updated": datetime.now(BEIJING).strftime("%Y-%m-%d %H:%M"),
        }
    from api_common import _cached

    return _cached("turnover_top", "live", _TTL, build, valid=lambda v: bool(v.get("stocks")))


def get_global_indices() -> list[dict]:
    """全球指数快照. 与复盘清单同一条 _DC_CACHE 键 (world_indices / 20s)。"""
    from api_common import _read
    import cockpit_live

    return _read("world_indices", "live", 20, cockpit_live.world_indices)
