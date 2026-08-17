"""Factor research on the daily panel. Rank IC, quintiles, long-short.

Computed from adj_close on the existing market store. Not TickFlow enriched.
Not an account matcher: no T+1, lots, or shared cash.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from backtest.panel import Panel

FACTOR_MAX = 600
MIN_CROSS = 15
REBALANCES = ("daily", "weekly", "monthly")
DISCLAIMER = (
    "因子研究, 不是账户撮合, 没有 T+1 / 整手 / 共享现金。"
    "Rank IC 是当日因子排序与下期收益排序的相关。"
    "静态池有幸存者偏差。少于 30 只时 IC 很噪。"
    "从本机日 K 现场算, 不是 TickFlow enriched, 也不是整库 Alpha Zoo。"
    "换手率要流通股本, 库存没有, 所以没加。"
)

# TickFlow factor page minus turnover_rate (needs float shares).
# Plus 3 WorldQuant 101 formulas that only need OHLCV.
FACTORS: dict[str, dict] = {
    "momentum_5": {"id": "momentum_5", "label": "5日动量", "win": 5, "kind": "mom", "group": "动量"},
    "momentum_10": {"id": "momentum_10", "label": "10日动量", "win": 10, "kind": "mom", "group": "动量"},
    "momentum_20": {"id": "momentum_20", "label": "20日动量", "win": 20, "kind": "mom", "group": "动量"},
    "momentum_30": {"id": "momentum_30", "label": "30日动量", "win": 30, "kind": "mom", "group": "动量"},
    "momentum_60": {"id": "momentum_60", "label": "60日动量", "win": 60, "kind": "mom", "group": "动量"},
    "change_1": {"id": "change_1", "label": "日涨跌幅", "win": 1, "kind": "mom", "group": "动量"},
    "rsi_6": {"id": "rsi_6", "label": "RSI(6)", "win": 6, "kind": "rsi", "group": "超买超卖"},
    "rsi_14": {"id": "rsi_14", "label": "RSI(14)", "win": 14, "kind": "rsi", "group": "超买超卖"},
    "rsi_24": {"id": "rsi_24", "label": "RSI(24)", "win": 24, "kind": "rsi", "group": "超买超卖"},
    "vol_20": {"id": "vol_20", "label": "20日波动", "win": 20, "kind": "vol", "group": "波动"},
    "atr_14": {"id": "atr_14", "label": "ATR(14)", "win": 14, "kind": "atr", "group": "波动"},
    "amplitude": {"id": "amplitude", "label": "日振幅", "win": 1, "kind": "amplitude", "group": "波动"},
    "vol_ratio_5": {"id": "vol_ratio_5", "label": "量比(5日)", "win": 5, "kind": "vol_ratio", "group": "量价"},
    "macd_hist": {"id": "macd_hist", "label": "MACD柱", "win": 35, "kind": "macd", "group": "趋势"},
    "kdj_k": {"id": "kdj_k", "label": "KDJ-K", "win": 9, "kind": "kdj", "group": "趋势"},
    "zoo_alpha006": {"id": "zoo_alpha006", "label": "WQ #6 开盘量价相关", "win": 10, "kind": "zoo006", "group": "WorldQuant"},
    "zoo_alpha012": {"id": "zoo_alpha012", "label": "WQ #12 量价同向", "win": 2, "kind": "zoo012", "group": "WorldQuant"},
    "zoo_alpha101": {"id": "zoo_alpha101", "label": "WQ #101 日内实体", "win": 1, "kind": "zoo101", "group": "WorldQuant"},
    "roe": {"id": "roe", "label": "ROE(公告日PIT)", "win": 1, "kind": "pit", "field": "roe", "group": "财务PIT"},
    "np": {"id": "np", "label": "净利润(公告日PIT)", "win": 1, "kind": "pit", "field": "np", "group": "财务PIT"},
    "revenue": {"id": "revenue", "label": "营收(公告日PIT)", "win": 1, "kind": "pit", "field": "revenue", "group": "财务PIT"},
}


def factor_catalog() -> list[dict]:
    return [
        {
            "id": spec["id"],
            "label": spec["label"],
            "win": spec["win"],
            "kind": spec["kind"],
            "group": spec["group"],
            **({"field": spec["field"]} if spec.get("field") else {}),
        }
        for spec in FACTORS.values()
    ]


def _rank(x: np.ndarray) -> np.ndarray:
    order = np.argsort(x, kind="mergesort")
    ranks = np.empty(x.size, dtype=float)
    ranks[order] = np.arange(x.size, dtype=float)
    return ranks


def _pearson(a: np.ndarray, b: np.ndarray) -> float:
    a = a - float(a.mean())
    b = b - float(b.mean())
    den = float(np.sqrt(np.sum(a * a) * np.sum(b * b)))
    if den < 1e-12:
        return float("nan")
    return float(np.sum(a * b) / den)


def spearman(x: np.ndarray, y: np.ndarray) -> float:
    if x.size < 3:
        return float("nan")
    return _pearson(_rank(x), _rank(y))


def rebalance_indices(dates: list[str], mode: str) -> list[int]:
    if mode not in REBALANCES:
        raise ValueError(f"rebalance 仅支持 {list(REBALANCES)}")
    if mode == "daily":
        return list(range(len(dates)))
    if mode == "weekly":
        return [i for i, day in enumerate(dates) if date.fromisoformat(day).weekday() == 0]
    out: list[int] = []
    prev = ""
    for i, day in enumerate(dates):
        ym = day[:7]
        if ym != prev:
            out.append(i)
            prev = ym
    return out


def _adj_ohlc(panel: Panel) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Scale raw OHLC by adj_close/close so indicators match adj_close."""
    close = panel.close
    adj = panel.adj_close
    scale = np.divide(
        adj,
        close,
        out=np.full_like(close, np.nan),
        where=(close > 0) & np.isfinite(close) & np.isfinite(adj),
    )
    return panel.open * scale, panel.high * scale, panel.low * scale, adj


def _daily_ret(adj: np.ndarray) -> np.ndarray:
    t, s = adj.shape
    out = np.full((t, s), np.nan)
    if t > 1:
        prev = adj[:-1]
        now = adj[1:]
        ok = np.isfinite(prev) & np.isfinite(now) & (prev > 0)
        out[1:] = np.where(ok, now / prev - 1.0, np.nan)
    return out


def _ema(x: np.ndarray, alpha: float) -> np.ndarray:
    t, s = x.shape
    out = np.full((t, s), np.nan)
    started = np.zeros(s, dtype=bool)
    prev = np.zeros(s)
    for i in range(t):
        row = x[i]
        fin = np.isfinite(row)
        take = fin & ~started
        prev = np.where(take, row, prev)
        started |= take
        upd = started & fin
        prev = np.where(upd, alpha * row + (1.0 - alpha) * prev, prev)
        out[i] = np.where(started, prev, np.nan)
    return out


def _rolling_std(x: np.ndarray, win: int) -> np.ndarray:
    t, s = x.shape
    out = np.full((t, s), np.nan)
    for i in range(win - 1, t):
        block = x[i - win + 1 : i + 1]
        finite = np.isfinite(block)
        counts = finite.sum(axis=0)
        filled = np.where(finite, block, 0.0)
        mean = np.divide(filled.sum(axis=0), counts, out=np.zeros(s), where=counts > 1)
        var = np.divide(
            ((filled - mean) ** 2 * finite).sum(axis=0),
            counts - 1,
            out=np.zeros(s),
            where=counts > 1,
        )
        out[i] = np.where(counts > 1, np.sqrt(np.maximum(var, 0.0)), np.nan)
    return out


def _rolling_corr(a: np.ndarray, b: np.ndarray, win: int) -> np.ndarray:
    t, s = a.shape
    out = np.full((t, s), np.nan)
    for i in range(win - 1, t):
        aa = a[i - win + 1 : i + 1]
        bb = b[i - win + 1 : i + 1]
        ok = np.isfinite(aa) & np.isfinite(bb)
        n = ok.sum(axis=0)
        aa_z = np.where(ok, aa, 0.0)
        bb_z = np.where(ok, bb, 0.0)
        am = np.divide(aa_z.sum(axis=0), n, out=np.zeros(s), where=n > 2)
        bm = np.divide(bb_z.sum(axis=0), n, out=np.zeros(s), where=n > 2)
        ac = np.where(ok, aa - am, 0.0)
        bc = np.where(ok, bb - bm, 0.0)
        num = (ac * bc).sum(axis=0)
        den = np.sqrt((ac * ac).sum(axis=0) * (bc * bc).sum(axis=0))
        out[i] = np.where((n > 2) & (den > 1e-12), num / den, np.nan)
    return out


def _rolling_minmax(x: np.ndarray, win: int, op) -> np.ndarray:
    t, s = x.shape
    out = np.full((t, s), np.nan)
    for i in range(win - 1, t):
        out[i] = op(x[i - win + 1 : i + 1], axis=0)
    return out


def factor_matrix(panel: Panel, factor_id: str) -> np.ndarray:
    spec = FACTORS.get(factor_id)
    if not spec:
        raise ValueError(f"factor 仅支持 {list(FACTORS)}")
    adj = panel.adj_close
    t, s = adj.shape
    out = np.full((t, s), np.nan)
    win = int(spec["win"])
    kind = spec["kind"]
    if kind == "mom":
        if t <= win:
            return out
        prev = adj[:-win]
        now = adj[win:]
        ok = np.isfinite(prev) & np.isfinite(now) & (prev > 0)
        out[win:] = np.where(ok, now / prev - 1.0, np.nan)
        return out
    if kind == "vol":
        return _rolling_std(_daily_ret(adj), win)
    if kind == "rsi":
        delta = np.full((t, s), np.nan)
        if t > 1:
            delta[1:] = adj[1:] - adj[:-1]
        gain = np.where(np.isfinite(delta) & (delta > 0), delta, np.where(np.isfinite(delta), 0.0, np.nan))
        loss = np.where(np.isfinite(delta) & (delta < 0), -delta, np.where(np.isfinite(delta), 0.0, np.nan))
        avg_gain = _ema(gain, 1.0 / win)
        avg_loss = _ema(loss, 1.0 / win)
        denom = np.where(np.isfinite(avg_loss) & (avg_loss < 1e-12), 1e-12, avg_loss)
        rs = np.divide(avg_gain, denom, out=np.full((t, s), np.nan), where=np.isfinite(avg_gain) & np.isfinite(denom))
        return 100.0 - 100.0 / (1.0 + rs)
    open_, high, low, close = _adj_ohlc(panel)
    if kind == "atr":
        prev = np.full((t, s), np.nan)
        if t > 1:
            prev[1:] = close[:-1]
        tr = np.maximum(high - low, np.maximum(np.abs(high - prev), np.abs(low - prev)))
        return _ema(tr, 1.0 / 14.0)
    if kind == "amplitude":
        if t > 1:
            prev = panel.close[:-1]
            now_h = panel.high[1:]
            now_l = panel.low[1:]
            ok = np.isfinite(prev) & np.isfinite(now_h) & np.isfinite(now_l) & (prev > 0)
            out[1:] = np.where(ok, (now_h - now_l) / prev, np.nan)
        return out
    if kind == "vol_ratio":
        vol = panel.volume
        for i in range(win, t):
            block = vol[i - win : i]
            finite = np.isfinite(block) & (block > 0)
            counts = finite.sum(axis=0)
            filled = np.where(finite, block, 0.0)
            mean = np.divide(filled.sum(axis=0), counts, out=np.zeros(s), where=counts == win)
            today = vol[i]
            ok = (counts == win) & (mean > 0) & np.isfinite(today)
            out[i] = np.where(ok, today / mean, np.nan)
        return out
    if kind == "macd":
        dif = _ema(adj, 2.0 / 13.0) - _ema(adj, 2.0 / 27.0)
        dea = _ema(dif, 2.0 / 10.0)
        return (dif - dea) * 2.0
    if kind == "kdj":
        ln = _rolling_minmax(low, 9, np.nanmin)
        hn = _rolling_minmax(high, 9, np.nanmax)
        width = hn - ln
        rsv = np.divide(100.0 * (close - ln), width, out=np.full((t, s), np.nan), where=np.abs(width) > 1e-12)
        return _ema(rsv, 1.0 / 3.0)
    if kind == "zoo006":
        return -1.0 * _rolling_corr(open_, panel.volume, 10)
    if kind == "zoo012":
        if t > 1:
            d_vol = panel.volume[1:] - panel.volume[:-1]
            d_px = close[1:] - close[:-1]
            out[1:] = np.sign(d_vol) * (-1.0 * d_px)
        return out
    if kind == "zoo101":
        return np.divide(close - open_, high - low + 0.001)
    if kind == "pit":
        return fundamental_matrix(panel, str(spec.get("field") or factor_id))
    raise ValueError(f"未知 kind {kind}")


def fundamental_matrix(panel: Panel, field: str) -> np.ndarray:
    """Value known on each bar. announce_date <= date. No report-date leak."""
    from backtest.market import query_fundamentals

    t, s = panel.T, panel.S
    out = np.full((t, s), np.nan)
    for j, sym in enumerate(panel.symbols):
        rows = [
            r for r in query_fundamentals(sym, field)
            if r.get("announce_date") and r.get("value") is not None
        ]
        if not rows:
            continue
        k = 0
        val = float("nan")
        n = len(rows)
        for i, day in enumerate(panel.dates):
            while k < n and str(rows[k].get("announce_date") or "") <= day:
                try:
                    val = float(rows[k]["value"])
                except (TypeError, ValueError):
                    val = float("nan")
                k += 1
            out[i, j] = val
    return out


def _group_ids(values: np.ndarray, n_groups: int) -> np.ndarray:
    order = np.argsort(values, kind="mergesort")
    n = values.size
    groups = np.empty(n, dtype=int)
    for rank, idx in enumerate(order):
        groups[idx] = min(n_groups, int(rank * n_groups / n) + 1)
    return groups


def _nav_stats(values: list[float], periods_per_year: float) -> dict:
    if len(values) < 2:
        return {"total_return": 0.0, "sharpe": 0.0, "max_drawdown": 0.0, "win_rate": 0.0}
    total = values[-1] / values[0] - 1.0 if values[0] else 0.0
    rets = [values[i] / values[i - 1] - 1.0 for i in range(1, len(values)) if values[i - 1] > 0]
    arr = np.asarray(rets, dtype=float)
    if arr.size > 1 and float(arr.std(ddof=1)) > 1e-12:
        sharpe = float(arr.mean() / arr.std(ddof=1) * np.sqrt(periods_per_year))
    else:
        sharpe = 0.0
    peak = values[0]
    max_dd = 0.0
    for v in values:
        peak = max(peak, v)
        if peak > 0:
            max_dd = min(max_dd, v / peak - 1.0)
    win_rate = float(np.mean(arr > 0)) if arr.size else 0.0
    return {
        "total_return": round(total, 4),
        "sharpe": round(sharpe, 2),
        "max_drawdown": round(max_dd, 4),
        "win_rate": round(win_rate, 4),
    }


def _bucket_return(rets: np.ndarray, scores: np.ndarray, groups: np.ndarray, g: int, weight: str) -> float | None:
    hit = groups == g
    r = rets[hit]
    if not r.size:
        return None
    if weight != "factor_weight":
        return float(r.mean())
    w = np.abs(scores[hit])
    w = np.where(np.isfinite(w), w, 0.0)
    if float(w.sum()) <= 0:
        return float(r.mean())
    return float(np.sum(r * w) / w.sum())


def evaluate(
    panel: Panel,
    factor_id: str = "momentum_20",
    *,
    rebalance: str = "monthly",
    n_groups: int = 5,
    start: str | None = None,
    direction: str = "high",
    weight: str = "equal",
    ls_fee: float = 0.0,
    member_mask: np.ndarray | None = None,
) -> dict:
    if n_groups < 2 or n_groups > 10:
        raise ValueError("分层数要在 2 到 10")
    if direction not in ("high", "low"):
        raise ValueError("direction 仅支持 high / low")
    if weight not in ("equal", "factor_weight"):
        raise ValueError("weight 仅支持 equal / factor_weight")
    if ls_fee < 0:
        raise ValueError("ls_fee 必须 >= 0")
    fac = factor_matrix(panel, factor_id)
    if direction == "low":
        fac = -fac
    idxs = [i for i in rebalance_indices(panel.dates, rebalance) if (not start or panel.dates[i] >= start)]
    pairs = [(idxs[k], idxs[k + 1]) for k in range(len(idxs) - 1)]
    ic_series: list[dict] = []
    group_rets: list[dict] = []
    skipped = 0
    for i, nxt in pairs:
        scores = fac[i]
        prev = panel.adj_close[i]
        later = panel.adj_close[nxt]
        ok = np.isfinite(scores) & np.isfinite(prev) & np.isfinite(later) & (prev > 0)
        if member_mask is not None:
            ok = ok & member_mask[i]
        if int(ok.sum()) < MIN_CROSS:
            skipped += 1
            continue
        fwd = later / prev - 1.0
        ic = spearman(scores[ok], fwd[ok])
        if np.isfinite(ic):
            ic_series.append({"date": panel.dates[i], "ic": round(float(ic), 4)})
        groups = _group_ids(scores[ok], n_groups)
        rets = fwd[ok]
        sc = scores[ok]
        row: dict = {"date": panel.dates[i]}
        for g in range(1, n_groups + 1):
            row[f"Q{g}"] = _bucket_return(rets, sc, groups, g, weight)
        group_rets.append(row)

    ics = [p["ic"] for p in ic_series]
    ic_mean = float(np.mean(ics)) if ics else None
    ic_std = float(np.std(ics, ddof=1)) if len(ics) > 1 else None
    ir = (ic_mean / ic_std) if (ic_mean is not None and ic_std and abs(ic_std) > 1e-8) else None
    ic_win = (sum(1 for v in ics if v > 0) / len(ics)) if ics else None
    ppy = {"daily": 252.0, "weekly": 52.0, "monthly": 12.0}[rebalance]

    navs = {f"Q{g}": 1.0 for g in range(1, n_groups + 1)}
    ls = 1.0
    group_nav: list[dict] = []
    ls_nav: list[dict] = []
    for row in group_rets:
        entry = {"date": row["date"]}
        q1 = row.get("Q1")
        qn = row.get(f"Q{n_groups}")
        for g in range(1, n_groups + 1):
            key = f"Q{g}"
            ret = row.get(key)
            if ret is not None:
                navs[key] *= 1.0 + float(ret)
            entry[key] = round(navs[key], 4)
        if q1 is not None and qn is not None:
            ls *= 1.0 + (float(qn) - float(q1)) / 2.0 - 2.0 * ls_fee
        ls_nav.append({"date": row["date"], "value": round(ls, 4)})
        group_nav.append(entry)

    group_stats = []
    for g in range(1, n_groups + 1):
        key = f"Q{g}"
        series = [1.0] + [float(p[key]) for p in group_nav]
        st = _nav_stats(series, ppy)
        st.update({"group": g, "label": key})
        group_stats.append(st)
    ls_stats = _nav_stats([1.0] + [float(p["value"]) for p in ls_nav], ppy)
    ls_stats.update({"top_group": f"Q{n_groups}", "bottom_group": "Q1"})

    warnings = [
        "因子研究不是账户撮合, 没有 T+1 / 整手 / 共享现金",
        "从本机日 K 现场算, 不是 TickFlow enriched, 也不是整库 Alpha Zoo",
    ]
    if member_mask is not None:
        warnings.append("因子截面已按日成分掩码")
    else:
        warnings.append("静态池按整段都在, 不是按日成分, 有幸存者偏差")
    if panel.S < 30:
        warnings.append(f"只有 {panel.S} 只, Rank IC 很噪, 建议 30 只以上或改用库存已覆盖")
    if skipped:
        warnings.append(f"{skipped} 个调仓日截面不足 {MIN_CROSS} 只, 已跳过")
    if not ic_series:
        warnings.append("没有算出 IC: 日 K 不够或调仓点太少")

    return {
        "factor": FACTORS[factor_id],
        "rebalance": rebalance,
        "direction": direction,
        "weight": weight,
        "ls_fee": ls_fee,
        "n_groups": n_groups,
        "n_symbols": panel.S,
        "n_dates": panel.T,
        "n_periods": len(group_rets),
        "ic_mean": None if ic_mean is None else round(ic_mean, 4),
        "ic_std": None if ic_std is None else round(ic_std, 4),
        "ir": None if ir is None else round(ir, 4),
        "ic_win_rate": None if ic_win is None else round(ic_win, 4),
        "ic_series": ic_series,
        "group_stats": group_stats,
        "group_nav": group_nav,
        "long_short_nav": ls_nav,
        "long_short_stats": ls_stats,
        "warnings": warnings,
        "disclaimer": DISCLAIMER,
    }


def store_pool(limit: int = FACTOR_MAX) -> list[str]:
    import astock
    import universe
    from backtest.market import market_root

    root = market_root() / "bars"
    out: list[str] = []
    for code in universe.read_codes(fresh_only=False):
        sym = astock.resolve_symbol(code)
        if not sym:
            continue
        if (root / f"symbol={sym}").is_dir():
            out.append(sym)
        if len(out) >= limit:
            break
    return out


def run_factor(body: dict, *, bars_by_symbol: dict[str, list[dict]] | None = None, fetch_fn=None) -> dict:
    from backtest.service import BacktestError, lookback_range, resolve_codes

    factor_id = str(body.get("factor") or "momentum_20").strip()
    if factor_id not in FACTORS:
        raise BacktestError(f"factor 仅支持 {list(FACTORS)}")
    rebalance = str(body.get("rebalance") or "monthly").strip()
    if rebalance not in REBALANCES:
        raise BacktestError(f"rebalance 仅支持 {list(REBALANCES)}")
    n_groups = int(body.get("n_groups") or 5)
    direction = str(body.get("direction") or "high").strip().lower()
    if direction not in ("high", "low"):
        raise BacktestError("direction 仅支持 high / low")
    weight = str(body.get("weight") or "equal").strip().lower()
    if weight not in ("equal", "factor_weight"):
        raise BacktestError("weight 仅支持 equal / factor_weight")
    ls_fee = float(body.get("ls_fee") or 0)
    if ls_fee < 0:
        raise BacktestError("ls_fee 必须 >= 0")
    pool = str(body.get("pool") or "codes").strip().lower()
    start, end = lookback_range(body.get("lookback"), body.get("start"), body.get("end"))
    win = int(FACTORS[factor_id]["win"])
    load_start = (date.fromisoformat(start) - timedelta(days=max(int(win * 3 + 20), 90))).isoformat()

    if pool == "store":
        symbols = store_pool(int(body.get("limit") or FACTOR_MAX))
        if not symbols:
            raise BacktestError("库存还没有已覆盖的标的, 先去数据页补齐近 2 年")
    else:
        symbols = resolve_codes(body.get("codes") or [], limit=FACTOR_MAX)
        if len(symbols) < 2:
            raise BacktestError("因子至少需要 2 只")

    from backtest.progress import begin, finish, mark

    begin(kind="factor", step="load", total=len(symbols), note=f"{len(symbols)} 只")
    try:
        return _run_factor_body(
            body, factor_id, rebalance, n_groups, direction, weight, ls_fee, pool,
            start, end, symbols, load_start,
            bars_by_symbol=bars_by_symbol, fetch_fn=fetch_fn,
        )
    finally:
        finish()


def _run_factor_body(
    body: dict,
    factor_id: str,
    rebalance: str,
    n_groups: int,
    direction: str,
    weight: str,
    ls_fee: float,
    pool: str,
    start: str,
    end: str,
    symbols: list[str],
    load_start: str,
    *,
    bars_by_symbol: dict[str, list[dict]] | None,
    fetch_fn,
) -> dict:
    from backtest.progress import mark
    from backtest.service import load_panel

    panel, warnings, _names, src = load_panel(
        symbols,
        load_start,
        end,
        bars_by_symbol=bars_by_symbol,
        fetch_fn=fetch_fn,
        use_cache=bars_by_symbol is None,
    )
    mark(step="factor", done=len(symbols), total=len(symbols))
    if FACTORS[factor_id]["kind"] == "pit" and bars_by_symbol is None:
        from backtest.fundamentals import ensure_fundamentals

        ensure_fundamentals(panel.symbols)
    index_id = str(body.get("index") or "").strip().lower()
    member_mask = None
    if index_id:
        from backtest.market import members_covers, membership_mask

        if members_covers(index_id, start):
            member_mask = membership_mask(index_id, panel.dates, panel.symbols)
        else:
            warnings.append("没有覆盖这段的按日成分, 因子仍是静态池")
    out = evaluate(
        panel,
        factor_id,
        rebalance=rebalance,
        n_groups=n_groups,
        start=start,
        direction=direction,
        weight=weight,
        ls_fee=ls_fee,
        member_mask=member_mask,
    )
    out["warnings"] = warnings + out["warnings"]
    out["universe"] = {
        "symbols": panel.symbols,
        "start": start,
        "end": panel.dates[-1] if panel.dates else end,
        "bars": panel.T,
        "from_store": src["from_store"],
        "fetched": src["fetched"],
        "pool": pool,
        "n_requested": len(symbols),
    }
    out["config"] = {
        "factor": factor_id,
        "rebalance": rebalance,
        "n_groups": n_groups,
        "direction": direction,
        "weight": weight,
        "ls_fee": ls_fee,
        "pool": pool,
        "codes": symbols,
        "lookback": body.get("lookback"),
        "start": start,
        "end": end,
        "index": index_id or None,
    }
    persist = body.get("persist")
    if persist is None:
        persist = bars_by_symbol is None
    if persist:
        mark(step="write")
        from datetime import datetime, timezone

        from backtest.archive import new_run_id, write_factor_run

        run_id = new_run_id()
        digest = panel.data_hash()
        write_factor_run(
            run_id,
            config=out["config"],
            result={k: v for k, v in out.items() if k != "config"},
            meta={
                "id": run_id,
                "kind": "factor",
                "created": datetime.now(timezone.utc).isoformat(),
                "data_hash": digest,
                "factor": out.get("factor"),
                "factor_id": factor_id,
                "ic_mean": out.get("ic_mean"),
                "symbols": panel.symbols,
                "start": start,
                "end": panel.dates[-1] if panel.dates else end,
                "stats": out.get("long_short_stats"),
                "warnings": out.get("warnings"),
                "disclaimer": out.get("disclaimer"),
            },
        )
        out["run_id"] = run_id
        out["data_hash"] = digest
    return out


COMPARE_MAX = 6


def run_factor_compare(body: dict, *, bars_by_symbol: dict[str, list[dict]] | None = None, fetch_fn=None) -> dict:
    """Same panel, several factors. No persist. Not a 460-alpha bench."""
    from backtest.service import BacktestError, lookback_range, resolve_codes

    raw_ids = body.get("factors") or []
    if isinstance(raw_ids, str):
        raw_ids = [p.strip() for p in raw_ids.split(",") if p.strip()]
    ids = []
    for item in raw_ids:
        fid = str(item or "").strip()
        if fid and fid in FACTORS and fid not in ids:
            ids.append(fid)
        if len(ids) >= COMPARE_MAX:
            break
    if len(ids) < 2:
        raise BacktestError(f"对照至少 2 个因子, 最多 {COMPARE_MAX} 个")
    rebalance = str(body.get("rebalance") or "monthly").strip()
    if rebalance not in REBALANCES:
        raise BacktestError(f"rebalance 仅支持 {list(REBALANCES)}")
    n_groups = int(body.get("n_groups") or 5)
    direction = str(body.get("direction") or "high").strip().lower()
    weight = str(body.get("weight") or "equal").strip().lower()
    ls_fee = float(body.get("ls_fee") or 0)
    pool = str(body.get("pool") or "codes").strip().lower()
    start, end = lookback_range(body.get("lookback"), body.get("start"), body.get("end"))
    win = max(int(FACTORS[fid]["win"]) for fid in ids)
    load_start = (date.fromisoformat(start) - timedelta(days=max(int(win * 3 + 20), 90))).isoformat()
    if pool == "store":
        symbols = store_pool(int(body.get("limit") or FACTOR_MAX))
        if not symbols:
            raise BacktestError("库存还没有已覆盖的标的, 先去数据页补齐近 2 年")
    else:
        symbols = resolve_codes(body.get("codes") or [], limit=FACTOR_MAX)
        if len(symbols) < 2:
            raise BacktestError("因子至少需要 2 只")
    from backtest.progress import begin, finish

    begin(kind="factor", step="load", total=len(symbols), note=f"对照 {len(ids)} 个因子")
    try:
        return _run_factor_compare_body(
            ids, rebalance, n_groups, direction, weight, ls_fee, pool,
            start, end, symbols, load_start,
            bars_by_symbol=bars_by_symbol, fetch_fn=fetch_fn,
        )
    finally:
        finish()


def _run_factor_compare_body(
    ids: list[str],
    rebalance: str,
    n_groups: int,
    direction: str,
    weight: str,
    ls_fee: float,
    pool: str,
    start: str,
    end: str,
    symbols: list[str],
    load_start: str,
    *,
    bars_by_symbol: dict[str, list[dict]] | None,
    fetch_fn,
) -> dict:
    from backtest.progress import mark
    from backtest.service import load_panel

    panel, warnings, _names, src = load_panel(
        symbols,
        load_start,
        end,
        bars_by_symbol=bars_by_symbol,
        fetch_fn=fetch_fn,
        use_cache=bars_by_symbol is None,
    )
    rows: list[dict] = []
    series: dict[str, dict[str, float]] = {}
    mark(step="compare", done=0, total=len(ids))
    for i, fid in enumerate(ids, start=1):
        mark(step="compare", done=i, total=len(ids), current=fid)
        ev = evaluate(
            panel,
            fid,
            rebalance=rebalance,
            n_groups=n_groups,
            start=start,
            direction=direction,
            weight=weight,
            ls_fee=ls_fee,
        )
        q1 = next((g for g in ev["group_stats"] if g["label"] == "Q1"), None)
        qn = next((g for g in ev["group_stats"] if g["label"] == f"Q{n_groups}"), None)
        rows.append({
            "id": fid,
            "label": ev["factor"]["label"],
            "group": ev["factor"]["group"],
            "ic_mean": ev["ic_mean"],
            "ir": ev["ir"],
            "ic_win_rate": ev["ic_win_rate"],
            "ls_return": ev["long_short_stats"].get("total_return"),
            "q_spread": (
                None if not q1 or not qn else round(float(qn["total_return"]) - float(q1["total_return"]), 4)
            ),
        })
        series[fid] = {p["date"]: p["ic"] for p in ev["ic_series"]}
    corr: list[list[float | None]] = []
    for a in ids:
        line: list[float | None] = []
        for b in ids:
            days = sorted(set(series[a]) & set(series[b]))
            if len(days) < 3:
                line.append(None)
                continue
            xa = np.asarray([series[a][d] for d in days], dtype=float)
            xb = np.asarray([series[b][d] for d in days], dtype=float)
            val = spearman(xa, xb)
            line.append(None if not np.isfinite(val) else round(float(val), 4))
        corr.append(line)
    return {
        "factors": ids,
        "rebalance": rebalance,
        "n_groups": n_groups,
        "direction": direction,
        "weight": weight,
        "rows": rows,
        "ic_corr": corr,
        "n_symbols": panel.S,
        "warnings": warnings + [
            "对照是同一面板上的几个因子, 不是整库 Alpha Zoo",
            "IC 相关高说明两个因子几乎在讲同一件事",
        ],
        "universe": {
            "start": start,
            "end": panel.dates[-1] if panel.dates else end,
            "bars": panel.T,
            "from_store": src["from_store"],
            "fetched": src["fetched"],
            "pool": pool,
            "n_requested": len(symbols),
        },
    }
