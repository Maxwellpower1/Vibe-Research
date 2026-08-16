"""V1 signal builders: hold / ma_cross / dates.

Signals sit on the bar they are known. The matcher shifts them for open_t+1.
"""

from __future__ import annotations

import numpy as np

from backtest.panel import Panel, norm_date


STRATEGIES = ("hold", "ma_cross", "dates")


def _empty(panel: Panel) -> tuple[np.ndarray, np.ndarray]:
    z = np.zeros((panel.T, panel.S), dtype=bool)
    return z.copy(), z.copy()


def rolling_mean(close: np.ndarray, win: int) -> np.ndarray:
    """1-d rolling mean; NaN until the window is fully finite."""
    t = close.shape[0]
    out = np.full(t, np.nan)
    if win < 1 or t < win:
        return out
    for i in range(win - 1, t):
        w = close[i - win + 1 : i + 1]
        if np.isfinite(w).all():
            out[i] = float(w.mean())
    return out


def signal_hold(panel: Panel) -> tuple[np.ndarray, np.ndarray]:
    """Buy the first tradable bar of each name; hold to the end."""
    entries, exits = _empty(panel)
    for j in range(panel.S):
        for i in range(panel.T):
            if np.isfinite(panel.close[i, j]) and np.isfinite(panel.open[i, j]):
                entries[i, j] = True
                break
    return entries, exits


def signal_ma_cross(panel: Panel, short_win: int = 5, long_win: int = 20) -> tuple[np.ndarray, np.ndarray]:
    if short_win < 1 or long_win < 2 or short_win >= long_win:
        raise ValueError("均线窗口需满足 1 <= 短 < 长")
    entries, exits = _empty(panel)
    for j in range(panel.S):
        ma_s = rolling_mean(panel.adj_close[:, j], short_win)
        ma_l = rolling_mean(panel.adj_close[:, j], long_win)
        for i in range(1, panel.T):
            a0, b0 = ma_s[i - 1], ma_l[i - 1]
            a1, b1 = ma_s[i], ma_l[i]
            if not all(np.isfinite(x) for x in (a0, b0, a1, b1)):
                continue
            if a0 <= b0 and a1 > b1:
                entries[i, j] = True
            elif a0 >= b0 and a1 < b1:
                exits[i, j] = True
    return entries, exits


def signal_dates(panel: Panel, events: list[dict]) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Exact date match. Unknown codes / non-bar dates become warnings."""
    entries, exits = _empty(panel)
    warnings: list[str] = []
    by_date = {d: i for i, d in enumerate(panel.dates)}
    by_sym = {s: j for j, s in enumerate(panel.symbols)}
    by_digits = {s[-6:]: j for j, s in enumerate(panel.symbols) if len(s) >= 6}
    for ev in events or []:
        if not isinstance(ev, dict):
            continue
        raw_code = str(ev.get("code") or ev.get("symbol") or "").strip()
        side = str(ev.get("side") or ev.get("action") or "").strip().lower()
        day = norm_date(ev.get("date") or ev.get("day"))
        j = by_sym.get(raw_code)
        if j is None:
            j = by_digits.get(raw_code[-6:] if len(raw_code) >= 6 else raw_code)
        if j is None:
            warnings.append(f"事件代码不在本次标的里: {raw_code or '?'}")
            continue
        if side not in ("buy", "sell", "entry", "exit"):
            warnings.append(f"事件方向只能是 buy/sell: {raw_code} {side}")
            continue
        i = by_date.get(day)
        if i is None:
            warnings.append(f"事件日期不是这段日 K 里的交易日: {raw_code} {day or '?'}")
            continue
        if side in ("buy", "entry"):
            entries[i, j] = True
        else:
            exits[i, j] = True
    return entries, exits, warnings


def build_signals(
    panel: Panel,
    strategy: str,
    *,
    short_win: int = 5,
    long_win: int = 20,
    events: list[dict] | None = None,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    name = (strategy or "hold").strip().lower()
    if name not in STRATEGIES:
        raise ValueError(f"strategy 仅支持 {STRATEGIES}")
    notes: list[str] = []
    if name == "hold":
        entries, exits = signal_hold(panel)
    elif name == "ma_cross":
        entries, exits = signal_ma_cross(panel, short_win, long_win)
        if panel.T < long_win:
            notes.append(f"日 K 只有 {panel.T} 根, 长均线 {long_win} 可能不够")
    else:
        entries, exits, notes = signal_dates(panel, events or [])
        if not events:
            notes.append("dates 策略没有买卖日, 不会开仓")
    return entries, exits, notes
