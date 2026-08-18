"""Forward-return labels. Limit-day rows are voided."""

from __future__ import annotations

import numpy as np

from backtest.panel import Panel
from backtest.rules import at_limit_down, at_limit_up, limit_pct


def limit_mask(panel: Panel) -> np.ndarray:
    """True when open or close sits on the band vs prior close."""
    pre = panel.pre_close()
    out = np.zeros((panel.T, panel.S), dtype=bool)
    for j, sym in enumerate(panel.symbols):
        band = limit_pct(sym)
        for i in range(panel.T):
            prev = float(pre[i, j])
            if not (np.isfinite(prev) and prev > 0):
                continue
            o = float(panel.open[i, j])
            c = float(panel.close[i, j])
            if np.isfinite(o) and (at_limit_up(o, prev, band) or at_limit_down(o, prev, band)):
                out[i, j] = True
                continue
            if np.isfinite(c) and (at_limit_up(c, prev, band) or at_limit_down(c, prev, band)):
                out[i, j] = True
    return out


def forward_returns(panel: Panel, horizon: int = 5) -> np.ndarray:
    """adj[t+h]/adj[t]-1. Limit bars and missing future are NaN."""
    if horizon < 1:
        raise ValueError("前瞻天数至少 1")
    adj = panel.adj_close
    t, s = adj.shape
    out = np.full((t, s), np.nan)
    if t <= horizon:
        return out
    prev = adj[:-horizon]
    later = adj[horizon:]
    ok = np.isfinite(prev) & np.isfinite(later) & (prev > 0)
    out[:-horizon] = np.where(ok, later / prev - 1.0, np.nan)
    blocked = limit_mask(panel)
    out = np.where(blocked, np.nan, out)
    return out
