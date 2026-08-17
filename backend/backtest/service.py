"""Load a daily panel, build signals, run the matcher."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, replace
from datetime import date, datetime, timedelta, timezone

import astock
import trading_calendar as tc
from backtest.archive import new_run_id, write_run
from backtest.matcher import run_match, tearsheet
from backtest.oos import (
    OosError,
    oos_fresh,
    resolve_split,
    run_walk_forward,
    segment_stats,
    tune_ma,
    tune_mom,
)
from backtest.panel import Panel, build_panel, norm_date
from backtest.rules import FILL_MODES, FILL_OPEN_T1, MatcherConfig
from backtest.signals import STRATEGIES, build_signals
from backtest.store import ensure_bars, fetch_daily_bars

BENCH_SYMBOL = "sh000300"

MAX_CODES = 600
LOOKBACKS = {"1y": 365, "2y": 730, "3y": 1095}

DISCLAIMER = (
    "研究模拟, 不是实盘, 不荐股、不预测。"
    "信号日不等于成交日; 默认次日开盘。"
    "净值只来自现金加市值, 不用持有期去乘年化。"
    "ST 5% 涨跌停从代码看不出来, 按板块默认带宽。"
    "原始价和复权因子分开; 只写已收盘 bar。"
    "优先读本机近 2 年库存, 缺的再补。"
    "自选默认是静态池, 有幸存者偏差; 勾选按日成分才按 members_on 回放。"
    "沪深300 基准优先按日成分等权可交易; 没有覆盖这段的快照时退回指数价格比。"
)


class BacktestError(ValueError):
    """400-level request problem."""


def lookback_range(lookback: str | None, start: str | None, end: str | None) -> tuple[str, str]:
    closed = tc.last_closed_session().isoformat()
    end_d = min(norm_date(end) or closed, closed)
    start_d = norm_date(start)
    if not start_d:
        days = LOOKBACKS.get((lookback or "2y").strip().lower(), 730)
        start_d = (date.fromisoformat(end_d) - timedelta(days=days)).isoformat()
    if start_d > end_d:
        raise BacktestError("开始日不能晚于结束日")
    return start_d, end_d


def _set_bench_stats(out: dict, bench_ret: float | None) -> None:
    if bench_ret is None:
        return
    out["stats"]["benchmark_return"] = bench_ret
    out["stats"]["excess_return"] = float(out["stats"].get("total_return") or 0) - bench_ret


def _attach_price_benchmark(out: dict, start: str, end: str, capital: float, fetch_fn, use_cache: bool) -> None:
    try:
        pack = ensure_bars(BENCH_SYMBOL, start, end, fetch_fn=fetch_fn, use_cache=use_cache)
    except Exception as e:  # noqa: BLE001
        out.setdefault("warnings", []).append(f"沪深300 基准未取到: {e}")
        return
    rows = pack.get("bars") or []
    if not rows:
        out.setdefault("warnings", []).append(pack.get("error") or "沪深300 这段没有日 K")
        return
    by_day = {}
    for row in rows:
        day = norm_date(row.get("datetime") or row.get("date"))
        px = row.get("adj_close") if row.get("adj_close") is not None else row.get("close")
        try:
            by_day[day] = float(px)
        except (TypeError, ValueError):
            continue
    curve = []
    base = None
    for pt in out.get("equity_curve") or []:
        day = pt.get("date")
        px = by_day.get(day)
        if px is None:
            curve.append({"date": day, "equity": None})
            continue
        if base is None:
            base = px
        curve.append({"date": day, "equity": round(capital * px / base, 2) if base else None})
    valid = [p["equity"] for p in curve if p.get("equity") is not None]
    bench_ret = (valid[-1] / valid[0] - 1.0) if len(valid) >= 2 and valid[0] else None
    out["benchmark"] = {
        "symbol": BENCH_SYMBOL,
        "name": "沪深300指数价格",
        "kind": "index_price",
        "curve": curve,
        "total_return": bench_ret,
        "note": "指数价格比, 不是按成分调仓的可交易账户.",
    }
    _set_bench_stats(out, bench_ret)
    out.setdefault("warnings", []).append(
        "沪深300 基准用了指数价格比: 这段没有按日成分快照, 去数据页补齐或点指数导入并勾选按日成分"
    )
    if pack.get("error"):
        out.setdefault("warnings", []).append(pack["error"])


def _attach_tradable_benchmark(
    out: dict,
    start: str,
    end: str,
    cfg: MatcherConfig,
    fetch_fn,
    use_cache: bool,
) -> bool:
    from backtest.market import members_covers, members_union, membership_mask
    from backtest.signals import signal_members

    if not members_covers(BENCH_SYMBOL, start):
        return False
    symbols = members_union(BENCH_SYMBOL, start, end)
    if not symbols or len(symbols) > MAX_CODES:
        return False
    try:
        panel, warns, _names, _src = load_panel(
            symbols, start, end, fetch_fn=fetch_fn, use_cache=use_cache,
        )
    except Exception as e:  # noqa: BLE001
        out.setdefault("warnings", []).append(f"沪深300 可交易基准面板没建成: {e}")
        return False
    mask = membership_mask(BENCH_SYMBOL, panel.dates, panel.symbols)
    if not mask.any():
        return False
    slots = int(mask.sum(axis=1).max()) if mask.size else 0
    if slots < 1:
        return False
    entries, exits = signal_members(panel, mask)
    bench_cfg = replace(cfg, max_positions=min(MAX_CODES, slots))
    matched = run_match(panel, entries, exits, bench_cfg)
    by_day = {pt["date"]: pt.get("equity") for pt in (matched.get("equity_curve") or [])}
    curve = []
    for pt in out.get("equity_curve") or []:
        day = pt.get("date")
        curve.append({"date": day, "equity": by_day.get(day)})
    valid = [p["equity"] for p in curve if p.get("equity") is not None]
    bench_ret = (valid[-1] / valid[0] - 1.0) if len(valid) >= 2 and valid[0] else None
    missing = len(symbols) - panel.S
    note = "按日成分等权调仓, 同一套 T+1/整手/佣金/印花税. 不是官方市值加权指数."
    if missing > 0:
        note += f" 缺 {missing} 只日 K."
        out.setdefault("warnings", []).append(f"沪深300 可交易基准缺 {missing} 只日 K, 等权不是完整300")
    out["benchmark"] = {
        "symbol": BENCH_SYMBOL,
        "name": "沪深300等权可交易",
        "kind": "tradable_equal",
        "curve": curve,
        "total_return": bench_ret,
        "n_symbols": panel.S,
        "max_positions": bench_cfg.max_positions,
        "note": note,
    }
    _set_bench_stats(out, bench_ret)
    for w in warns:
        if w not in (out.get("warnings") or []):
            out.setdefault("warnings", []).append(w)
    return True


def _attach_benchmark(out: dict, start: str, end: str, cfg: MatcherConfig, fetch_fn, use_cache: bool) -> None:
    if _attach_tradable_benchmark(out, start, end, cfg, fetch_fn, use_cache):
        return
    _attach_price_benchmark(out, start, end, cfg.initial_capital, fetch_fn, use_cache)


def resolve_codes(raw: list[str] | str, *, limit: int | None = None) -> list[str]:
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.replace("，", ",").split(",")]
    else:
        parts = [str(p).strip() for p in (raw or [])]
    symbols: list[str] = []
    bad: list[str] = []
    seen: set[str] = set()
    for p in parts:
        if not p:
            continue
        sym = astock.resolve_symbol(p)
        if not sym:
            bad.append(p)
            continue
        if sym in seen:
            continue
        seen.add(sym)
        symbols.append(sym)
    if bad:
        raise BacktestError(f"无法解析的代码: {', '.join(bad[:8])}")
    if not symbols:
        raise BacktestError("至少需要 1 个 A 股代码")
    cap = MAX_CODES if limit is None else int(limit)
    if len(symbols) > cap:
        raise BacktestError(f"一次最多 {cap} 只")
    return symbols


def _cfg_from_body(body: dict) -> MatcherConfig:
    fill = str(body.get("fill") or FILL_OPEN_T1).strip()
    if fill not in FILL_MODES:
        raise BacktestError(f"fill 仅支持 {list(FILL_MODES)}")
    try:
        return MatcherConfig(
            fill=fill,
            commission_pct=float(body.get("commission_pct", 0.00025)),
            commission_min=float(body.get("commission_min", 5)),
            stamp_tax_pct=float(body.get("stamp_tax_pct", 0.0005)),
            slippage_bps=float(body.get("slippage_bps", 5)),
            initial_capital=float(body.get("initial_capital", 1_000_000)),
            max_positions=int(body.get("max_positions", 10)),
            lot_size=int(body.get("lot_size", 100)),
            t_plus=int(body.get("t_plus", 1)),
            exposure=float(body.get("exposure", 1)),
            stop_loss_pct=float(body.get("stop_loss_pct") or 0),
            max_hold_days=int(body.get("max_hold_days") or 0),
        )
    except ValueError as e:
        raise BacktestError(str(e)) from e


def _load_one(sym: str, start: str, end: str, fetch_fn, use_cache: bool) -> dict:
    return ensure_bars(sym, start, end, fetch_fn=fetch_fn, use_cache=use_cache)


def load_panel(
    symbols: list[str],
    start: str,
    end: str,
    *,
    bars_by_symbol: dict[str, list[dict]] | None = None,
    names: dict[str, str] | None = None,
    fetch_fn=None,
    use_cache: bool = True,
) -> tuple[Panel, list[str], dict[str, str], dict[str, int]]:
    warnings: list[str] = []
    name_map = dict(names or {})
    fetch = fetch_fn or fetch_daily_bars
    store_n = 0
    fetch_n = 0
    from backtest.progress import bump, mark

    mark(step="load", done=0, total=len(symbols))
    if bars_by_symbol is None:
        fetched: dict[str, dict] = {}
        workers = min(8, len(symbols))
        if workers <= 1:
            for sym in symbols:
                fetched[sym] = _load_one(sym, start, end, fetch, use_cache)
                bump(current=sym)
        else:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futs = {
                    sym: pool.submit(_load_one, sym, start, end, fetch, use_cache)
                    for sym in symbols
                }
                for sym in symbols:
                    try:
                        fetched[sym] = futs[sym].result()
                    except Exception as e:  # noqa: BLE001
                        fetched[sym] = {"symbol": sym, "bars": [], "error": str(e)}
                    bump(current=sym)
        bars_by_symbol = {}
        for sym in symbols:
            pack = fetched.get(sym) or {}
            rows = pack.get("bars") or []
            if pack.get("from_store"):
                store_n += 1
            elif rows:
                fetch_n += 1
            if pack.get("name"):
                name_map[sym] = str(pack["name"])
            if not rows:
                warnings.append(pack.get("error") or f"{sym} 这段没有日 K")
                continue
            avail = pack.get("available") or []
            if len(avail) == 2 and (avail[0] > start or avail[1] < end):
                warnings.append(f"{sym} 日 K 只覆盖到 {avail[0]} ~ {avail[1]}")
            bars_by_symbol[sym] = rows
        if fetch_n:
            warnings.append(f"{store_n} 只读库存, {fetch_n} 只现拉并写入")
        elif store_n:
            warnings.append(f"{store_n} 只全部读库存, 未打上游")
    panel = build_panel(bars_by_symbol, name_map)
    if panel.T < 2 or panel.S < 1:
        raise BacktestError("日 K 不够: 至少 2 个交易日、1 只标的有数据")
    return panel, warnings, name_map, {"from_store": store_n, "fetched": fetch_n}


def run_backtest(
    body: dict,
    *,
    bars_by_symbol: dict[str, list[dict]] | None = None,
    fetch_fn=None,
    use_cache: bool = True,
) -> dict:
    start, end = lookback_range(body.get("lookback"), body.get("start"), body.get("end"))
    index_id = str(body.get("index") or "").strip().lower()
    pit = bool(body.get("pit_members") or body.get("pit"))
    if pit and index_id:
        from backtest.market import members_covers, members_union

        if not members_covers(index_id, start):
            raise BacktestError("这段没有按日成分快照, 先点指数导入(带历史)或去数据页补齐")
        symbols = members_union(index_id, start, end)
        if not symbols:
            raise BacktestError("按日成分并集是空的")
        if len(symbols) > MAX_CODES:
            raise BacktestError(f"成分并集 {len(symbols)} 超过 {MAX_CODES}")
    else:
        symbols = resolve_codes(body.get("codes") or [])
    strategy = str(body.get("strategy") or "hold").strip().lower()
    if strategy not in STRATEGIES:
        raise BacktestError(f"strategy 仅支持 {list(STRATEGIES)}")
    short_win = int(body.get("short_win") or 5)
    long_win = int(body.get("long_win") or 20)
    mom_win = int(body.get("mom_win") or 20)
    rebalance = int(body.get("rebalance") or 20)
    events = body.get("events") if isinstance(body.get("events"), list) else []
    tune = bool(body.get("tune_ma"))
    walk = bool(body.get("walk_forward"))
    oos_frac = body.get("oos_frac")
    oos_date = body.get("oos_date")
    want_oos = (not walk) and (oos_frac not in (None, "", 0, 0.0, "0") or bool(oos_date))
    cfg = _cfg_from_body(body)
    from backtest.progress import begin, finish

    begin(kind="account", step="load", total=len(symbols), note=f"{len(symbols)} 只")
    try:
        return _run_backtest_body(
            body, symbols, start, end, strategy, short_win, long_win, mom_win,
            rebalance, events, tune, walk, oos_frac, oos_date, want_oos, cfg,
            bars_by_symbol=bars_by_symbol, fetch_fn=fetch_fn, use_cache=use_cache,
        )
    finally:
        finish()


def _run_backtest_body(
    body: dict,
    symbols: list[str],
    start: str,
    end: str,
    strategy: str,
    short_win: int,
    long_win: int,
    mom_win: int,
    rebalance: int,
    events: list,
    tune: bool,
    walk: bool,
    oos_frac,
    oos_date,
    want_oos: bool,
    cfg,
    *,
    bars_by_symbol: dict[str, list[dict]] | None,
    fetch_fn,
    use_cache: bool,
) -> dict:
    from backtest.progress import mark

    panel, warnings, _names, src = load_panel(
        symbols,
        start,
        end,
        bars_by_symbol=bars_by_symbol,
        fetch_fn=fetch_fn,
        use_cache=use_cache if bars_by_symbol is None else False,
    )
    index_id = str(body.get("index") or "").strip().lower()
    pit = bool(body.get("pit_members") or body.get("pit"))
    member_mask = None
    if pit and index_id:
        from backtest.market import membership_mask

        member_mask = membership_mask(index_id, panel.dates, panel.symbols)
        if not member_mask.any():
            raise BacktestError("按日成分掩码是空的, 快照和这段日 K 对不上")
    split_idx = None
    split_date = None
    tune_grid: list[dict] = []
    wf = None
    try:
        if walk:
            wf = run_walk_forward(
                panel,
                strategy,
                cfg,
                tune=tune,
                short_win=short_win,
                long_win=long_win,
                events=events,
                mom_win=mom_win,
                rebalance=rebalance,
                member_mask=member_mask,
            )
        elif want_oos:
            split_idx = resolve_split(
                panel.dates,
                oos_frac=None if oos_date else (float(oos_frac) if oos_frac not in (None, "") else 0.3),
                oos_date=str(oos_date) if oos_date else None,
            )
            split_date = panel.dates[split_idx]
            if tune and strategy == "ma_cross":
                short_win, long_win, tune_grid = tune_ma(panel.slice(0, split_idx), cfg)
                warnings.append(f"均线在样本内选定 {short_win}/{long_win}, 样本外冻结")
            if tune and strategy == "rank_mom":
                mom_win, tune_grid = tune_mom(panel.slice(0, split_idx), cfg, rebalance)
                warnings.append(f"动量窗口在样本内选定 {mom_win}, 样本外冻结")
    except OosError as e:
        raise BacktestError(str(e)) from e
    mark(step="signals", done=len(symbols), total=len(symbols))
    try:
        entries, exits, sig_notes = build_signals(
            panel,
            strategy,
            short_win=short_win,
            long_win=long_win,
            events=events,
            mom_win=mom_win,
            rebalance=rebalance,
            top_k=cfg.max_positions,
            member_mask=member_mask,
        )
    except ValueError as e:
        raise BacktestError(str(e)) from e
    warnings.extend(sig_notes)
    mark(step="match")
    out = run_match(panel, entries, exits, cfg)
    out["tearsheet"] = tearsheet(out.get("equity_curve") or [])
    out["universe"] = {
        "symbols": panel.symbols,
        "names": panel.names,
        "start": panel.dates[0],
        "end": panel.dates[-1],
        "bars": panel.T,
        "requested_start": start,
        "requested_end": end,
        "from_store": src["from_store"],
        "fetched": src["fetched"],
    }
    out["strategy"] = {
        "name": strategy,
        "short_win": short_win,
        "long_win": long_win,
        "mom_win": mom_win,
        "rebalance": rebalance,
        "top_k": cfg.max_positions,
        "events": len(events),
        "tuned": bool(tune_grid),
        "tune_grid": tune_grid,
    }
    if split_date and split_idx is not None:
        is_stats, oos_stats = segment_stats(
            out.get("equity_curve") or [],
            out.get("trades") or [],
            split_date,
            cfg.initial_capital,
        )
        fresh = oos_fresh(
            panel,
            split_idx,
            strategy,
            cfg,
            short_win=short_win,
            long_win=long_win,
            events=events,
            mom_win=mom_win,
            rebalance=rebalance,
            top_k=cfg.max_positions,
            member_mask=member_mask,
        )
        out["oos"] = {
            "split": split_date,
            "is_bars": split_idx,
            "oos_bars": panel.T - split_idx,
            "stats_is": is_stats,
            "stats_oos": oos_stats,
            "stats_oos_fresh": fresh["stats"],
            "note": "stats_oos 是同一账户切出来的后半段; stats_oos_fresh 是切点后新开的一笔钱, 均线仍用切点前的历史.",
        }
        out["stats"]["oos_return"] = oos_stats.get("total_return")
        out["stats"]["oos_sharpe"] = oos_stats.get("sharpe")
        out["stats"]["oos_fresh_return"] = fresh["stats"].get("total_return")
        out["stats"]["oos_fresh_sharpe"] = fresh["stats"].get("sharpe")
    if wf:
        out["walk_forward"] = wf
        out["stats"]["wf_mean_sharpe"] = wf["summary"]["mean_sharpe"]
        out["stats"]["wf_compound_return"] = wf["summary"]["compound_return"]
    if pit and index_id:
        warnings.append(f"按日成分回放 {index_id}, 入池买出池卖")
    else:
        warnings.append("自选/手填标的按整段都在池里, 不是按日成分, 有幸存者偏差")
    if bars_by_symbol is None:
        _attach_benchmark(
            out,
            panel.dates[0],
            panel.dates[-1],
            cfg,
            fetch_fn,
            use_cache,
        )
    out["universe"]["closed_end"] = tc.last_closed_session().isoformat()
    out["data_hash"] = panel.data_hash()
    out["warnings"] = warnings
    out["disclaimer"] = DISCLAIMER
    run_id = new_run_id()
    cfg_payload = {
        "codes": symbols,
        "start": start,
        "end": end,
        "strategy": strategy,
        "short_win": short_win,
        "long_win": long_win,
        "mom_win": mom_win,
        "rebalance": rebalance,
        "events": events,
        "matcher": asdict(cfg),
        "oos_frac": oos_frac,
        "oos_date": oos_date,
        "tune_ma": tune,
        "walk_forward": walk,
        "index": index_id or None,
        "pit_members": bool(pit and index_id),
    }
    out["config"] = cfg_payload
    mark(step="write")
    write_run(
        run_id,
        config=cfg_payload,
        trades=out.get("trades") or [],
        equity={
            "equity_curve": out.get("equity_curve") or [],
            "drawdown_curve": out.get("drawdown_curve") or [],
            "benchmark": out.get("benchmark"),
        },
        meta={
            "id": run_id,
            "kind": "account",
            "created": datetime.now(timezone.utc).isoformat(),
            "data_hash": out["data_hash"],
            "closed_end": out["universe"]["closed_end"],
            "strategy": out.get("strategy"),
            "symbols": panel.symbols,
            "start": panel.dates[0],
            "end": panel.dates[-1],
            "stats": out.get("stats"),
            "execution": out.get("execution"),
            "universe": out.get("universe"),
            "warnings": warnings,
            "disclaimer": DISCLAIMER,
            "oos": out.get("oos"),
            "walk_forward": out.get("walk_forward"),
        },
    )
    out["run_id"] = run_id
    out["closed_end"] = out["universe"]["closed_end"]
    return out


def meta() -> dict:
    return {
        "strategies": [
            {"id": "hold", "label": "买入持有", "hint": "第一根可买日开仓, 拿到结束"},
            {"id": "ma_cross", "label": "均线金叉死叉", "hint": "短均线上穿长均线买, 下穿卖"},
            {"id": "dates", "label": "指定买卖日", "hint": "你给出 code / side / date, 按信号日撮合"},
            {"id": "rank_mom", "label": "动量轮动", "hint": "静态池里按近 N 日收益取前 K, 每 M 日再平衡. 不是全 A 每天重选"},
        ],
        "fills": list(FILL_MODES),
        "lookbacks": list(LOOKBACKS),
        "defaults": asdict(MatcherConfig()),
        "limits": {"max_codes": MAX_CODES, "max_bars": 1000, "factor_max_codes": MAX_CODES},
        "factors": _factor_meta(),
        "index_pools": _index_pool_meta(),
        "disclaimer": DISCLAIMER,
        "notes": [
            "信号日不等于成交日, 默认次日开盘",
            "一笔共享现金; 每只预算 = 净值 / 最大持仓数",
            "T+1, 整手 100, 佣金双边, 印花税只卖",
            "涨跌停看成交价对昨收带宽, 不是只拦一字板",
            "ST 5% 从代码看不出来",
            "净值只从现金+市值来, 不用持有期 x 252/horizon",
            "原始价和复权因子分开, 只写已收盘 bar, 实验落 runs/<id>/ 写完不改",
            "成分股按日存; 财务用 (start, end) + 公告日。自选仍是静态池",
            "作业先同步写 run, 要排队再加 jobs.json, 不上 SQLite",
            "样本外: 参数只在切点前选; 另开一笔钱验后半段. 滚动切窗每折新开账户, 不再叠单点切窗",
            "优先读全 A 库存近 2 年; 缺的现拉并写入. 中证500 能一次进完. 不是无上限, 防全 A 同步打挂. 库存不齐会现拉, 会慢. 3y 会超出库存窗口",
            "动量轮动只在这次填的静态池里排, 前 K = 最大持仓. 不是按日全 A 重选",
            "止损和最长持有在撮合里执行, 仍受 T+1 / 跌停拦住",
            "因子页: Rank IC / 五档 / 多空, 可改方向 / 分层 / 权重. 对照最多 6 个因子",
            "一键导入写最新名单, 也可拉中证调整公告写入按日快照. 表单默认仍是静态池; 勾选按日成分才回放",
            "沪深300 基准: 有按日快照时跑等权可交易账户, 没有则退回指数价格比并写明",
            "财务 PIT 按公告日入库, 因子页 ROE/净利润/营收只用已公告的值",
        ],
    }


def _index_pool_meta() -> list[dict]:
    from backtest.index_pool import pool_meta

    return pool_meta()


def _factor_meta() -> list[dict]:
    from backtest.factor import factor_catalog

    return factor_catalog()
