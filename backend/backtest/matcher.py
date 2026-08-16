"""Shared-cash daily matcher.

Pre-shifts signals when fill is open_t+1 so the loop always means
"try to fill today". Equity is cash + close mark. Never annualize by
holding-period / horizon.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from backtest.panel import Panel
from backtest.rules import (
    FILL_OPEN_T1,
    MatcherConfig,
    at_limit_down,
    at_limit_up,
    commission_yuan,
    limit_pct,
    slip_price,
)


@dataclass
class _Pos:
    j: int
    shares: int
    entry_idx: int
    entry_date: str
    signal_date: str
    entry_px: float
    cash_spent: float


@dataclass
class _Book:
    rejects: dict[str, int] = field(default_factory=lambda: {
        "limit_up": 0,
        "limit_down": 0,
        "t1": 0,
        "no_cash": 0,
        "no_lot": 0,
        "no_slot": 0,
        "no_price": 0,
        "no_next_bar": 0,
        "already_held": 0,
        "end_forced": 0,
    })
    trades: list[dict] = field(default_factory=list)
    pending_exits: set[int] = field(default_factory=set)


def _finite(x: float) -> bool:
    return bool(np.isfinite(x) and x > 0)


def _mark(panel: Panel, positions: dict[int, _Pos], t: int) -> float:
    mtm = 0.0
    for j, pos in positions.items():
        px = float(panel.close[t, j])
        if not _finite(px):
            px = pos.entry_px
        mtm += pos.shares * px
    return mtm


def _signal_date(dates: list[str], fill_idx: int, shifted: bool) -> str:
    if shifted and fill_idx > 0:
        return dates[fill_idx - 1]
    return dates[fill_idx]


def _shift_flags(flags: np.ndarray, shifted: bool, rejects: dict[str, int]) -> np.ndarray:
    out = np.zeros_like(flags)
    if not shifted:
        return flags
    if flags.shape[0] > 1:
        out[1:] = flags[:-1]
    leftover = int(np.count_nonzero(flags[-1])) if flags.size else 0
    if leftover:
        rejects["no_next_bar"] += leftover
    return out


def compute_stats(equity: list[float], trades: list[dict], initial: float) -> dict:
    """Sharpe / CAGR from daily equity. Not 252 / holding-period."""
    arr = np.asarray(equity, dtype=float)
    if arr.size < 2 or not _finite(float(arr[0])):
        return {
            "initial_capital": initial,
            "final_equity": float(arr[-1]) if arr.size else initial,
            "total_return": 0.0,
            "cagr": 0.0,
            "sharpe": 0.0,
            "vol": 0.0,
            "max_drawdown": 0.0,
            "calmar": 0.0,
            "days": max(arr.size - 1, 0),
            "trades": 0,
            "round_trips": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
        }
    rets = np.diff(arr) / np.where(arr[:-1] == 0, np.nan, arr[:-1])
    rets = rets[np.isfinite(rets)]
    n = arr.size - 1
    total = float(arr[-1] / arr[0] - 1.0)
    years = n / 252.0
    cagr = float((arr[-1] / arr[0]) ** (1.0 / years) - 1.0) if years > 0 and arr[0] > 0 else 0.0
    if rets.size > 1:
        sd = float(np.std(rets, ddof=1))
        vol = sd * float(np.sqrt(252.0))
        sharpe = float(np.mean(rets) / sd * np.sqrt(252.0)) if sd > 1e-12 else 0.0
    else:
        vol = 0.0
        sharpe = 0.0
    peak = np.maximum.accumulate(arr)
    dd = arr / np.where(peak == 0, np.nan, peak) - 1.0
    max_dd = float(np.nanmin(dd)) if dd.size else 0.0
    calmar = float(cagr / abs(max_dd)) if max_dd < 0 else 0.0
    sells = [t for t in trades if t.get("side") == "sell"]
    wins = [t for t in sells if float(t.get("pnl") or 0) > 0]
    losses = [t for t in sells if float(t.get("pnl") or 0) < 0]
    gp = sum(float(t.get("pnl") or 0) for t in wins)
    gl = abs(sum(float(t.get("pnl") or 0) for t in losses))
    return {
        "initial_capital": initial,
        "final_equity": float(arr[-1]),
        "total_return": total,
        "cagr": cagr,
        "sharpe": sharpe,
        "vol": vol,
        "max_drawdown": max_dd,
        "calmar": calmar,
        "days": n,
        "trades": len(trades),
        "round_trips": len(sells),
        "win_rate": (len(wins) / len(sells)) if sells else 0.0,
        "profit_factor": (gp / gl) if gl > 1e-9 else (None if gp > 0 else 0.0),
    }


def run_match(
    panel: Panel,
    entries: np.ndarray,
    exits: np.ndarray,
    cfg: MatcherConfig,
) -> dict:
    if panel.T < 2 or panel.S < 1:
        raise ValueError("日 K 不够: 至少 2 个交易日、1 只标的")
    book = _Book()
    shifted = cfg.fill == FILL_OPEN_T1
    fill_entry = _shift_flags(np.asarray(entries, dtype=bool), shifted, book.rejects)
    fill_exit = _shift_flags(np.asarray(exits, dtype=bool), shifted, book.rejects)
    raw_px = panel.open if shifted else panel.close
    pre = panel.pre_close()
    cash = float(cfg.initial_capital)
    positions: dict[int, _Pos] = {}
    curve: list[dict] = []
    dd_curve: list[dict] = []
    peak = cash

    def _sell(t: int, j: int, *, reason: str, px: float) -> None:
        nonlocal cash
        pos = positions.get(j)
        if pos is None:
            return
        fill = slip_price(px, "sell", cfg)
        notional = pos.shares * fill
        comm = commission_yuan(notional, cfg)
        stamp = notional * cfg.stamp_tax_pct
        proceeds = notional - comm - stamp
        cash += proceeds
        book.trades.append({
            "symbol": panel.symbols[j],
            "name": panel.names.get(panel.symbols[j], ""),
            "side": "sell",
            "date": panel.dates[t],
            "signal_date": (
                _signal_date(panel.dates, t, shifted) if reason == "signal" else panel.dates[t]
            ),
            "price": round(fill, 4),
            "shares": pos.shares,
            "notional": round(notional, 2),
            "commission": round(comm, 2),
            "stamp_tax": round(stamp, 2),
            "cash_delta": round(proceeds, 2),
            "pnl": round(proceeds - pos.cash_spent, 2),
            "hold_days": t - pos.entry_idx,
            "reason": reason,
        })
        del positions[j]

    for t in range(panel.T):
        day = panel.dates[t]
        last = t == panel.T - 1

        def _try_exit(j: int) -> None:
            pos = positions.get(j)
            if pos is None:
                return
            px = float(raw_px[t, j])
            if t - pos.entry_idx < cfg.t_plus:
                book.pending_exits.add(j)
                book.rejects["t1"] += 1
                return
            if not _finite(px):
                book.pending_exits.add(j)
                book.rejects["no_price"] += 1
                return
            prev = float(pre[t, j])
            if _finite(prev) and at_limit_down(px, prev, limit_pct(panel.symbols[j])):
                book.pending_exits.add(j)
                book.rejects["limit_down"] += 1
                return
            _sell(t, j, reason="signal", px=px)

        to_exit = set(book.pending_exits)
        book.pending_exits = set()
        orphans: list[int] = []
        for j in range(panel.S):
            if not fill_exit[t, j]:
                continue
            if j in positions:
                to_exit.add(j)
            else:
                orphans.append(j)
        for j in sorted(to_exit):
            _try_exit(j)

        candidates: list[int] = []
        for j in range(panel.S):
            if not fill_entry[t, j]:
                continue
            if j in positions:
                book.rejects["already_held"] += 1
                continue
            candidates.append(j)
        slots = cfg.max_positions - len(positions)
        if slots <= 0:
            book.rejects["no_slot"] += len(candidates)
            candidates = []
        elif len(candidates) > slots:
            book.rejects["no_slot"] += len(candidates) - slots
            candidates = candidates[:slots]
        if candidates:
            mtm = _mark(panel, positions, t - 1 if t else t)
            budget = (cash + mtm) * cfg.exposure / cfg.max_positions
            for j in candidates:
                px = float(raw_px[t, j])
                if not _finite(px):
                    book.rejects["no_price"] += 1
                    continue
                prev = float(pre[t, j])
                if _finite(prev) and at_limit_up(px, prev, limit_pct(panel.symbols[j])):
                    book.rejects["limit_up"] += 1
                    continue
                fill = slip_price(px, "buy", cfg)
                if fill <= 0:
                    book.rejects["no_price"] += 1
                    continue
                shares = cfg.lot_size * int(budget // (fill * cfg.lot_size))
                while shares >= cfg.lot_size:
                    notional = shares * fill
                    comm = commission_yuan(notional, cfg)
                    if cash + 1e-9 >= notional + comm:
                        break
                    shares -= cfg.lot_size
                if shares < cfg.lot_size:
                    book.rejects["no_lot" if budget < fill * cfg.lot_size else "no_cash"] += 1
                    continue
                notional = shares * fill
                comm = commission_yuan(notional, cfg)
                spent = notional + comm
                cash -= spent
                sig = _signal_date(panel.dates, t, shifted)
                positions[j] = _Pos(
                    j=j,
                    shares=shares,
                    entry_idx=t,
                    entry_date=day,
                    signal_date=sig,
                    entry_px=fill,
                    cash_spent=spent,
                )
                book.trades.append({
                    "symbol": panel.symbols[j],
                    "name": panel.names.get(panel.symbols[j], ""),
                    "side": "buy",
                    "date": day,
                    "signal_date": sig,
                    "price": round(fill, 4),
                    "shares": shares,
                    "notional": round(notional, 2),
                    "commission": round(comm, 2),
                    "stamp_tax": 0.0,
                    "cash_delta": round(-spent, 2),
                    "pnl": None,
                    "hold_days": 0,
                    "reason": "signal",
                })

        for j in orphans:
            if j in positions:
                _try_exit(j)

        if last and positions:
            for j in list(positions):
                px = float(panel.close[t, j])
                if not _finite(px):
                    px = positions[j].entry_px
                book.rejects["end_forced"] += 1
                _sell(t, j, reason="end", px=px)

        mtm = _mark(panel, positions, t)
        equity = cash + mtm
        peak = max(peak, equity)
        dd = equity / peak - 1.0 if peak > 0 else 0.0
        curve.append({
            "date": day,
            "equity": round(equity, 2),
            "cash": round(cash, 2),
            "market_value": round(mtm, 2),
        })
        dd_curve.append({"date": day, "drawdown": round(dd, 6)})

    stats = compute_stats([p["equity"] for p in curve], book.trades, cfg.initial_capital)
    return {
        "equity_curve": curve,
        "drawdown_curve": dd_curve,
        "trades": book.trades,
        "stats": stats,
        "execution": {
            "fills": sum(1 for t in book.trades if t.get("reason") != "end"),
            "open_positions": len(positions),
            "rejects": dict(book.rejects),
        },
        "config": {
            "fill": cfg.fill,
            "commission_pct": cfg.commission_pct,
            "commission_min": cfg.commission_min,
            "stamp_tax_pct": cfg.stamp_tax_pct,
            "slippage_bps": cfg.slippage_bps,
            "initial_capital": cfg.initial_capital,
            "max_positions": cfg.max_positions,
            "lot_size": cfg.lot_size,
            "t_plus": cfg.t_plus,
        },
    }
