"""In-sample / out-of-sample split. Params are chosen on IS only.

OOS fills use signals computed on the full window so MA has history,
but the OOS-fresh account does not trade before the cut.
Walk-forward is rolling IS/OOS with a new cash book each fold.
Never score a window with 252/horizon.
"""

from __future__ import annotations

import numpy as np

from backtest.matcher import compute_stats, run_match
from backtest.panel import Panel, norm_date
from backtest.rules import MatcherConfig
from backtest.signals import build_signals

MA_GRID = ((5, 20), (5, 30), (10, 20), (10, 30), (10, 60))
MOM_WINS = (10, 20, 60)
MIN_LEG = 20


class OosError(ValueError):
    pass


def resolve_split(dates: list[str], *, oos_frac: float | None = None, oos_date: str | None = None) -> int:
    """First OOS index. IS is dates[:idx], OOS is dates[idx:]."""
    n = len(dates)
    if n < MIN_LEG * 2:
        raise OosError(f"切窗至少需要 {MIN_LEG * 2} 根日 K")
    day = norm_date(oos_date) if oos_date else ""
    if day:
        for i, d in enumerate(dates):
            if d >= day:
                idx = i
                break
        else:
            raise OosError("样本外起点晚于这段日 K")
    else:
        frac = 0.3 if oos_frac is None else float(oos_frac)
        if not 0 < frac < 1:
            raise OosError("oos_frac 要在 (0, 1) 里")
        idx = int(round(n * (1.0 - frac)))
    idx = max(MIN_LEG, min(idx, n - MIN_LEG))
    return idx


def walk_folds(n: int, train: int = 252, test: int = 63, step: int = 63) -> list[tuple[int, int, int]]:
    """(is_start, is_end, oos_end), end exclusive. OOS starts at is_end."""
    if train < MIN_LEG or test < MIN_LEG:
        raise OosError("滚动切窗的训练/检验段太短")
    out: list[tuple[int, int, int]] = []
    start = 0
    while start + train + test <= n:
        is_end = start + train
        out.append((start, is_end, is_end + test))
        start += step
    if not out:
        raise OosError("日 K 不够做滚动切窗 (默认 1 年训 / 1 季验)")
    return out


def tune_ma(panel: Panel, cfg: MatcherConfig) -> tuple[int, int, list[dict]]:
    """Pick MA pair on this panel only. Caller must pass IS bars."""
    best: tuple[float, int, int] | None = None
    rows: list[dict] = []
    for short, long in MA_GRID:
        if panel.T < long + 5:
            continue
        entries, exits, _ = build_signals(panel, "ma_cross", short_win=short, long_win=long)
        stats = run_match(panel, entries, exits, cfg)["stats"]
        row = {
            "short_win": short,
            "long_win": long,
            "sharpe": stats["sharpe"],
            "total_return": stats["total_return"],
        }
        rows.append(row)
        score = float(stats["sharpe"])
        if best is None or score > best[0]:
            best = (score, short, long)
    if best is None:
        return 5, 20, rows
    return best[1], best[2], rows


def tune_mom(panel: Panel, cfg: MatcherConfig, rebalance: int = 20) -> tuple[int, list[dict]]:
    """Pick momentum window on this panel only. Caller must pass IS bars."""
    best: tuple[float, int] | None = None
    rows: list[dict] = []
    for win in MOM_WINS:
        if panel.T < win + 5:
            continue
        entries, exits, _ = build_signals(
            panel, "rank_mom", mom_win=win, rebalance=rebalance, top_k=cfg.max_positions
        )
        stats = run_match(panel, entries, exits, cfg)["stats"]
        row = {"mom_win": win, "sharpe": stats["sharpe"], "total_return": stats["total_return"]}
        rows.append(row)
        score = float(stats["sharpe"])
        if best is None or score > best[0]:
            best = (score, win)
    if best is None:
        return 20, rows
    return best[1], rows


def mask_before(flags: np.ndarray, idx: int) -> np.ndarray:
    out = np.array(flags, copy=True)
    if idx > 0:
        out[:idx] = False
    return out


def segment_stats(equity_curve: list[dict], trades: list[dict], split_date: str, initial: float) -> tuple[dict, dict]:
    """Continuing-account IS / OOS stats. OOS returns start from the last IS equity."""
    is_pts = [p["equity"] for p in equity_curve if p["date"] < split_date]
    oos_pts = [p["equity"] for p in equity_curve if p["date"] >= split_date]
    is_tr = [t for t in trades if str(t.get("date") or "") < split_date]
    oos_tr = [t for t in trades if str(t.get("date") or "") >= split_date]
    is_stats = compute_stats(is_pts, is_tr, initial) if len(is_pts) >= 2 else compute_stats([], [], initial)
    if is_pts and oos_pts:
        oos_series = [is_pts[-1]] + oos_pts
    else:
        oos_series = oos_pts
    oos_stats = compute_stats(oos_series, oos_tr, float(oos_series[0]) if oos_series else initial)
    return is_stats, oos_stats


def oos_flags(panel: Panel, split_idx: int, strategy: str, **sig_kw) -> tuple[np.ndarray, np.ndarray]:
    entries, exits, _ = build_signals(panel, strategy, **sig_kw)
    entries = mask_before(entries, split_idx)
    exits = mask_before(exits, split_idx)
    if strategy == "hold" and not entries.any():
        for j in range(panel.S):
            for i in range(split_idx, panel.T):
                if np.isfinite(panel.close[i, j]) and np.isfinite(panel.open[i, j]):
                    entries[i, j] = True
                    break
    return entries, exits


def oos_fresh(panel: Panel, split_idx: int, strategy: str, cfg: MatcherConfig, **sig_kw) -> dict:
    """New cash book that only trades on OOS. Signals still see IS history."""
    entries, exits = oos_flags(panel, split_idx, strategy, **sig_kw)
    return run_match(panel, entries, exits, cfg)


def run_walk_forward(
    panel: Panel,
    strategy: str,
    cfg: MatcherConfig,
    *,
    tune: bool,
    short_win: int,
    long_win: int,
    events: list[dict] | None = None,
    mom_win: int = 20,
    rebalance: int = 20,
    train: int = 252,
    test: int = 63,
    step: int = 63,
) -> dict:
    folds_idx = walk_folds(panel.T, train, test, step)
    folds: list[dict] = []
    stitched = [cfg.initial_capital]
    for is_start, is_end, oos_end in folds_idx:
        window = panel.slice(is_start, oos_end)
        rel = is_end - is_start
        s, l = short_win, long_win
        mw = mom_win
        grid: list[dict] = []
        if tune and strategy == "ma_cross":
            s, l, grid = tune_ma(window.slice(0, rel), cfg)
        if tune and strategy == "rank_mom":
            mw, grid = tune_mom(window.slice(0, rel), cfg, rebalance)
        entries, exits = oos_flags(
            window,
            rel,
            strategy,
            short_win=s,
            long_win=l,
            events=events or [],
            mom_win=mw,
            rebalance=rebalance,
            top_k=cfg.max_positions,
        )
        out = run_match(window, entries, exits, cfg)
        ret = float(out["stats"]["total_return"])
        stitched.append(round(stitched[-1] * (1.0 + ret), 2))
        folds.append({
            "is_start": window.dates[0],
            "is_end": window.dates[rel - 1],
            "oos_start": window.dates[rel],
            "oos_end": window.dates[-1],
            "short_win": s,
            "long_win": l,
            "mom_win": mw,
            "tune_grid": grid,
            "stats": out["stats"],
        })
    sharpes = [float(f["stats"]["sharpe"]) for f in folds]
    rets = [float(f["stats"]["total_return"]) for f in folds]
    return {
        "folds": folds,
        "train_bars": train,
        "test_bars": test,
        "step_bars": step,
        "stitched_equity": [
            {"date": f"fold-{i}", "equity": v} for i, v in enumerate(stitched)
        ],
        "summary": {
            "folds": len(folds),
            "mean_sharpe": float(np.mean(sharpes)) if sharpes else 0.0,
            "mean_return": float(np.mean(rets)) if rets else 0.0,
            "compound_return": float(stitched[-1] / stitched[0] - 1.0) if stitched[0] else 0.0,
        },
    }
