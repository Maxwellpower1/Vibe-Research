"""Load a daily panel, build signals, run the matcher."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone

import astock
import trading_calendar as tc
from backtest.archive import new_run_id, write_run
from backtest.matcher import run_match
from backtest.oos import (
    OosError,
    oos_fresh,
    resolve_split,
    run_walk_forward,
    segment_stats,
    tune_ma,
)
from backtest.panel import Panel, build_panel, norm_date
from backtest.rules import FILL_MODES, FILL_OPEN_T1, MatcherConfig
from backtest.signals import STRATEGIES, build_signals
from backtest.store import ensure_bars, fetch_daily_bars

BENCH_SYMBOL = "sh000300"

MAX_CODES = 20
LOOKBACKS = {"1y": 365, "2y": 730, "3y": 1095}

DISCLAIMER = (
    "研究模拟, 不是实盘, 不荐股、不预测。"
    "信号日不等于成交日; 默认次日开盘。"
    "净值只来自现金加市值, 不用持有期去乘年化。"
    "ST 5% 涨跌停从代码看不出来, 按板块默认带宽。"
    "原始价和复权因子分开; 只写已收盘 bar。"
    "自选不是按日成分, 有幸存者偏差。"
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


def _attach_benchmark(out: dict, start: str, end: str, capital: float, fetch_fn, use_cache: bool) -> None:
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
        "name": pack.get("name") or "沪深300",
        "curve": curve,
        "total_return": bench_ret,
    }
    if bench_ret is not None:
        out["stats"]["benchmark_return"] = bench_ret
        out["stats"]["excess_return"] = float(out["stats"].get("total_return") or 0) - bench_ret
    if pack.get("error"):
        out.setdefault("warnings", []).append(pack["error"])


def resolve_codes(raw: list[str] | str) -> list[str]:
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
    if len(symbols) > MAX_CODES:
        raise BacktestError(f"一次最多 {MAX_CODES} 只")
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
) -> tuple[Panel, list[str], dict[str, str]]:
    warnings: list[str] = []
    name_map = dict(names or {})
    fetch = fetch_fn or fetch_daily_bars
    if bars_by_symbol is None:
        fetched: dict[str, dict] = {}
        workers = min(4, len(symbols))
        if workers <= 1:
            for sym in symbols:
                fetched[sym] = _load_one(sym, start, end, fetch, use_cache)
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
        bars_by_symbol = {}
        for sym in symbols:
            pack = fetched.get(sym) or {}
            rows = pack.get("bars") or []
            if pack.get("name"):
                name_map[sym] = str(pack["name"])
            if not rows:
                warnings.append(pack.get("error") or f"{sym} 这段没有日 K")
                continue
            avail = pack.get("available") or []
            if len(avail) == 2 and (avail[0] > start or avail[1] < end):
                warnings.append(f"{sym} 日 K 只覆盖到 {avail[0]} ~ {avail[1]}")
            bars_by_symbol[sym] = rows
    panel = build_panel(bars_by_symbol, name_map)
    if panel.T < 2 or panel.S < 1:
        raise BacktestError("日 K 不够: 至少 2 个交易日、1 只标的有数据")
    return panel, warnings, name_map


def run_backtest(
    body: dict,
    *,
    bars_by_symbol: dict[str, list[dict]] | None = None,
    fetch_fn=None,
    use_cache: bool = True,
) -> dict:
    symbols = resolve_codes(body.get("codes") or [])
    start, end = lookback_range(body.get("lookback"), body.get("start"), body.get("end"))
    strategy = str(body.get("strategy") or "hold").strip().lower()
    if strategy not in STRATEGIES:
        raise BacktestError(f"strategy 仅支持 {list(STRATEGIES)}")
    short_win = int(body.get("short_win") or 5)
    long_win = int(body.get("long_win") or 20)
    events = body.get("events") if isinstance(body.get("events"), list) else []
    tune = bool(body.get("tune_ma"))
    walk = bool(body.get("walk_forward"))
    oos_frac = body.get("oos_frac")
    oos_date = body.get("oos_date")
    want_oos = (not walk) and (oos_frac not in (None, "", 0, 0.0, "0") or bool(oos_date))
    cfg = _cfg_from_body(body)
    panel, warnings, _names = load_panel(
        symbols,
        start,
        end,
        bars_by_symbol=bars_by_symbol,
        fetch_fn=fetch_fn,
        use_cache=use_cache if bars_by_symbol is None else False,
    )
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
    except OosError as e:
        raise BacktestError(str(e)) from e
    try:
        entries, exits, sig_notes = build_signals(
            panel,
            strategy,
            short_win=short_win,
            long_win=long_win,
            events=events,
        )
    except ValueError as e:
        raise BacktestError(str(e)) from e
    warnings.extend(sig_notes)
    out = run_match(panel, entries, exits, cfg)
    out["universe"] = {
        "symbols": panel.symbols,
        "names": panel.names,
        "start": panel.dates[0],
        "end": panel.dates[-1],
        "bars": panel.T,
        "requested_start": start,
        "requested_end": end,
    }
    out["strategy"] = {
        "name": strategy,
        "short_win": short_win,
        "long_win": long_win,
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
    warnings.append("自选/手填标的按整段都在池里, 不是按日成分, 有幸存者偏差")
    if bars_by_symbol is None:
        _attach_benchmark(
            out,
            panel.dates[0],
            panel.dates[-1],
            cfg.initial_capital,
            fetch_fn,
            use_cache,
        )
    out["universe"]["closed_end"] = tc.last_closed_session().isoformat()
    out["data_hash"] = panel.data_hash()
    out["warnings"] = warnings
    out["disclaimer"] = DISCLAIMER
    run_id = new_run_id()
    write_run(
        run_id,
        config={
            "codes": symbols,
            "start": start,
            "end": end,
            "strategy": strategy,
            "short_win": short_win,
            "long_win": long_win,
            "events": events,
            "matcher": asdict(cfg),
            "oos_frac": oos_frac,
            "oos_date": oos_date,
            "tune_ma": tune,
            "walk_forward": walk,
        },
        trades=out.get("trades") or [],
        equity={
            "equity_curve": out.get("equity_curve") or [],
            "drawdown_curve": out.get("drawdown_curve") or [],
            "benchmark": out.get("benchmark"),
        },
        meta={
            "id": run_id,
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
        ],
        "fills": list(FILL_MODES),
        "lookbacks": list(LOOKBACKS),
        "defaults": asdict(MatcherConfig()),
        "limits": {"max_codes": MAX_CODES, "max_bars": 1000},
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
        ],
    }
