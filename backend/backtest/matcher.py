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
class _Lot:
    shares: int
    entry_idx: int
    cash_spent: float


@dataclass
class _Pos:
    j: int
    shares: int
    entry_idx: int
    entry_date: str
    signal_date: str
    entry_px: float
    cash_spent: float
    lots: list[_Lot] = field(default_factory=list)


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
        "stop": 0,
        "max_hold": 0,
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


def _shift_weights(weights: np.ndarray, shifted: bool, rejects: dict[str, int]) -> np.ndarray:
    """Yesterday's target fills today. Same leftover rule as flags."""
    arr = np.asarray(weights, dtype=float)
    if not shifted:
        return arr
    out = np.zeros_like(arr)
    if arr.shape[0] > 1:
        out[1:] = arr[:-1]
    leftover = 0
    if arr.size:
        last = arr[-1]
        leftover = int(np.count_nonzero(np.isfinite(last) & (last > 0)))
    if leftover:
        rejects["no_next_bar"] += leftover
    return out


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


def rollup_trades(trades: list[dict]) -> list[dict]:
    """Per-symbol PnL from completed sells. Old runs can recompute this from trades."""
    acc: dict[str, dict] = {}
    for t in trades or []:
        if not isinstance(t, dict):
            continue
        sym = str(t.get("symbol") or "")
        if not sym:
            continue
        row = acc.setdefault(sym, {
            "symbol": sym,
            "name": "",
            "buys": 0,
            "sells": 0,
            "pnl": 0.0,
            "wins": 0,
            "trips": 0,
            "hold_days": 0,
        })
        if t.get("name") and not row["name"]:
            row["name"] = str(t.get("name") or "")
        side = str(t.get("side") or "")
        if side == "buy":
            row["buys"] += 1
            continue
        if side != "sell":
            continue
        row["sells"] += 1
        try:
            pnl = float(t.get("pnl") or 0)
        except (TypeError, ValueError):
            pnl = 0.0
        row["pnl"] += pnl
        row["trips"] += 1
        try:
            row["hold_days"] += int(t.get("hold_days") or 0)
        except (TypeError, ValueError):
            pass
        if pnl > 0:
            row["wins"] += 1
    out: list[dict] = []
    for row in acc.values():
        trips = int(row["trips"])
        out.append({
            "symbol": row["symbol"],
            "name": row["name"],
            "buys": int(row["buys"]),
            "sells": int(row["sells"]),
            "pnl": round(float(row["pnl"]), 2),
            "wins": int(row["wins"]),
            "trips": trips,
            "win_rate": (int(row["wins"]) / trips) if trips else 0.0,
            "avg_hold": (float(row["hold_days"]) / trips) if trips else 0.0,
        })
    out.sort(key=lambda r: (-float(r["pnl"]), str(r["symbol"])))
    return out


def tearsheet(equity_curve: list[dict]) -> dict:
    """Monthly returns and the largest closed drawdowns. From the equity curve only."""
    pts = [(str(p.get("date") or ""), float(p.get("equity") or 0)) for p in equity_curve or []]
    pts = [(d, eq) for d, eq in pts if len(d) >= 7 and eq > 0]
    monthly: list[dict] = []
    by_m: dict[str, list[tuple[str, float]]] = {}
    for day, eq in pts:
        by_m.setdefault(day[:7], []).append((day, eq))
    prev_end: float | None = None
    for ym in sorted(by_m):
        last = by_m[ym][-1][1]
        first = by_m[ym][0][1]
        base = prev_end if prev_end is not None else first
        monthly.append({"month": ym, "return": round(last / base - 1.0, 4) if base else 0.0})
        prev_end = last
    yearly: dict[str, float] = {}
    for row in monthly:
        y = row["month"][:4]
        yearly[y] = (1.0 + yearly.get(y, 0.0)) * (1.0 + float(row["return"])) - 1.0
    years = [{"year": y, "return": round(v, 4)} for y, v in yearly.items()]
    dds: list[dict] = []
    peak = None
    peak_date = ""
    trough = None
    trough_date = ""
    start = ""
    for day, eq in pts:
        if peak is None or eq >= peak:
            if start and trough is not None and peak and trough < peak:
                dds.append({
                    "start": start,
                    "trough": trough_date,
                    "end": day,
                    "depth": round(trough / peak - 1.0, 4),
                    "days": 0,
                })
            peak = eq
            peak_date = day
            start = ""
            trough = None
            continue
        if not start:
            start = peak_date
            trough = eq
            trough_date = day
        elif trough is None or eq < trough:
            trough = eq
            trough_date = day
    if start and trough is not None and peak and trough < peak:
        dds.append({
            "start": start,
            "trough": trough_date,
            "end": pts[-1][0] if pts else start,
            "depth": round(trough / peak - 1.0, 4),
            "days": 0,
        })
    by_date = {d: i for i, (d, _) in enumerate(pts)}
    for row in dds:
        a = by_date.get(row["start"], 0)
        b = by_date.get(row["end"], a)
        row["days"] = max(0, b - a)
    dds.sort(key=lambda r: float(r["depth"]))
    return {
        "monthly": monthly,
        "yearly": years,
        "drawdowns": dds[:5],
    }


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
            "sortino": 0.0,
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
        down = rets[rets < 0]
        dsd = float(np.std(down, ddof=1)) if down.size > 1 else 0.0
        sortino = float(np.mean(rets) / dsd * np.sqrt(252.0)) if dsd > 1e-12 else 0.0
    else:
        vol = 0.0
        sharpe = 0.0
        sortino = 0.0
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
        "sortino": sortino,
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
    targets: np.ndarray | None = None,
) -> dict:
    if panel.T < 2 or panel.S < 1:
        raise ValueError("日 K 不够: 至少 2 个交易日、1 只标的")
    book = _Book()
    shifted = cfg.fill == FILL_OPEN_T1
    fill_entry = _shift_flags(np.asarray(entries, dtype=bool), shifted, book.rejects)
    fill_exit = _shift_flags(np.asarray(exits, dtype=bool), shifted, book.rejects)
    fill_w: np.ndarray | None = None
    if targets is not None:
        tw = np.asarray(targets, dtype=float)
        if tw.shape != (panel.T, panel.S):
            raise ValueError("目标权重形状要和面板一致")
        fill_w = _shift_weights(tw, shifted, book.rejects)
    raw_px = panel.open if shifted else panel.close
    pre = panel.pre_close()
    cash = float(cfg.initial_capital)
    positions: dict[int, _Pos] = {}
    curve: list[dict] = []
    dd_curve: list[dict] = []
    peak = cash

    def _unlocked(pos: _Pos, t: int) -> int:
        if pos.lots:
            return sum(lt.shares for lt in pos.lots if t - lt.entry_idx >= cfg.t_plus)
        return pos.shares if t - pos.entry_idx >= cfg.t_plus else 0

    def _sell(t: int, j: int, *, reason: str, px: float, qty: int | None = None) -> int:
        nonlocal cash
        pos = positions.get(j)
        if pos is None:
            return 0
        want = pos.shares if qty is None else min(int(qty), pos.shares)
        if want <= 0:
            return 0
        ignore_t1 = reason == "end"
        sold = 0
        spent_cut = 0.0
        if pos.lots:
            kept: list[_Lot] = []
            left = want
            for lt in pos.lots:
                if left <= 0:
                    kept.append(lt)
                    continue
                if (not ignore_t1) and t - lt.entry_idx < cfg.t_plus:
                    kept.append(lt)
                    continue
                take = min(lt.shares, left)
                frac = take / lt.shares if lt.shares else 0.0
                spent_cut += lt.cash_spent * frac
                lt.shares -= take
                lt.cash_spent *= (1.0 - frac)
                left -= take
                sold += take
                if lt.shares > 0:
                    kept.append(lt)
            pos.lots = kept
        else:
            if (not ignore_t1) and t - pos.entry_idx < cfg.t_plus:
                return 0
            sold = want
            spent_cut = pos.cash_spent * (sold / pos.shares) if pos.shares else 0.0
        if sold <= 0:
            return 0
        fill = slip_price(px, "sell", cfg)
        notional = sold * fill
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
            "shares": sold,
            "notional": round(notional, 2),
            "commission": round(comm, 2),
            "stamp_tax": round(stamp, 2),
            "cash_delta": round(proceeds, 2),
            "pnl": round(proceeds - spent_cut, 2),
            "hold_days": t - pos.entry_idx,
            "reason": reason,
        })
        pos.shares -= sold
        pos.cash_spent -= spent_cut
        if pos.shares <= 0:
            del positions[j]
        elif pos.lots:
            pos.entry_idx = pos.lots[0].entry_idx
        return sold

    def _buy(t: int, j: int, shares: int, px: float, reason: str) -> bool:
        nonlocal cash
        fill = slip_price(px, "buy", cfg)
        if fill <= 0 or shares < cfg.lot_size:
            return False
        notional = shares * fill
        comm = commission_yuan(notional, cfg)
        spent = notional + comm
        if cash + 1e-9 < spent:
            return False
        cash -= spent
        sig = _signal_date(panel.dates, t, shifted)
        lot = _Lot(shares=shares, entry_idx=t, cash_spent=spent)
        if j in positions:
            pos = positions[j]
            pos.shares += shares
            pos.cash_spent += spent
            pos.lots.append(lot)
        else:
            positions[j] = _Pos(
                j=j,
                shares=shares,
                entry_idx=t,
                entry_date=panel.dates[t],
                signal_date=sig,
                entry_px=fill,
                cash_spent=spent,
                lots=[lot],
            )
        book.trades.append({
            "symbol": panel.symbols[j],
            "name": panel.names.get(panel.symbols[j], ""),
            "side": "buy",
            "date": panel.dates[t],
            "signal_date": sig,
            "price": round(fill, 4),
            "shares": shares,
            "notional": round(notional, 2),
            "commission": round(comm, 2),
            "stamp_tax": 0.0,
            "cash_delta": round(-spent, 2),
            "pnl": None,
            "hold_days": 0,
            "reason": reason,
        })
        return True

    for t in range(panel.T):
        day = panel.dates[t]
        last = t == panel.T - 1

        def _try_exit(j: int, reason: str = "signal") -> None:
            pos = positions.get(j)
            if pos is None:
                return
            px = float(raw_px[t, j])
            free = _unlocked(pos, t)
            if free < cfg.lot_size:
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
            if reason in book.rejects:
                book.rejects[reason] += 1
            qty = free if free < pos.shares else None
            _sell(t, j, reason=reason, px=px, qty=qty)
            if j in positions:
                book.pending_exits.add(j)

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

        for j, pos in list(positions.items()):
            held = t - pos.entry_idx
            if cfg.max_hold_days and held >= cfg.max_hold_days:
                _try_exit(j, "max_hold")
                continue
            if cfg.stop_loss_pct > 0:
                mark = float(raw_px[t, j])
                if _finite(mark) and pos.entry_px > 0 and mark / pos.entry_px - 1.0 <= -cfg.stop_loss_pct:
                    _try_exit(j, "stop")

        if fill_w is not None:
            row = fill_w[t]
            active = bool(np.any(np.isfinite(row) & (row > 0))) or bool(positions)
            if active:
                px_map: dict[int, float] = {}
                mtm_now = 0.0
                for j, pos in positions.items():
                    px = float(raw_px[t, j])
                    if not _finite(px):
                        px = pos.entry_px
                    px_map[j] = px
                    mtm_now += pos.shares * px
                equity = cash + mtm_now
                for j in sorted(positions):
                    tgt = float(row[j]) if np.isfinite(row[j]) else 0.0
                    tgt = max(tgt, 0.0)
                    px = px_map.get(j, float(raw_px[t, j]))
                    if not _finite(px):
                        continue
                    fill = slip_price(px, "sell", cfg)
                    desired = cfg.lot_size * int((equity * tgt) // (fill * cfg.lot_size)) if fill > 0 else 0
                    have = positions[j].shares
                    extra = have - desired
                    extra = cfg.lot_size * (extra // cfg.lot_size)
                    if extra < cfg.lot_size:
                        continue
                    prev = float(pre[t, j])
                    if _finite(prev) and at_limit_down(px, prev, limit_pct(panel.symbols[j])):
                        book.rejects["limit_down"] += 1
                        continue
                    free = _unlocked(positions[j], t)
                    qty = min(extra, cfg.lot_size * (free // cfg.lot_size))
                    if qty < cfg.lot_size:
                        book.rejects["t1"] += 1
                        continue
                    _sell(t, j, reason="rebalance", px=px, qty=qty)
                for j in range(panel.S):
                    tgt = float(row[j]) if np.isfinite(row[j]) else 0.0
                    if tgt <= 0:
                        continue
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
                    desired = cfg.lot_size * int((equity * tgt) // (fill * cfg.lot_size))
                    have = positions[j].shares if j in positions else 0
                    need = desired - have
                    need = cfg.lot_size * (need // cfg.lot_size)
                    if need < cfg.lot_size:
                        continue
                    shares = need
                    while shares >= cfg.lot_size:
                        notional = shares * fill
                        comm = commission_yuan(notional, cfg)
                        if cash + 1e-9 >= notional + comm:
                            break
                        shares -= cfg.lot_size
                    if shares < cfg.lot_size:
                        book.rejects["no_cash"] += 1
                        continue
                    _buy(t, j, shares, px, "rebalance")
        else:
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
                    _buy(t, j, shares, px, "signal")

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
        "by_symbol": rollup_trades(book.trades),
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
            "stop_loss_pct": cfg.stop_loss_pct,
            "max_hold_days": cfg.max_hold_days,
            "max_weight": cfg.max_weight,
            "industry_neutral": cfg.industry_neutral,
        },
    }
