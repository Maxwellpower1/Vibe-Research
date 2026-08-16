"""Date x symbol daily panel. pandas is not used here."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np


def norm_date(raw: object) -> str:
    s = str(raw or "").strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    digits = "".join(c for c in s if c.isdigit())
    if len(digits) >= 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    return ""


def _f(v: object) -> float:
    try:
        x = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return float("nan")
    return x if np.isfinite(x) else float("nan")


@dataclass
class Panel:
    dates: list[str]
    symbols: list[str]
    names: dict[str, str]
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray
    adj_close: np.ndarray

    @property
    def T(self) -> int:
        return len(self.dates)

    @property
    def S(self) -> int:
        return len(self.symbols)

    def index(self, symbol: str) -> int:
        return self.symbols.index(symbol)

    def pre_close(self) -> np.ndarray:
        out = np.full_like(self.close, np.nan, dtype=float)
        if self.T > 1:
            out[1:] = self.close[:-1]
        return out

    def slice(self, start: int, end: int) -> "Panel":
        """[start, end) bars. Used for sample-in tuning; do not leak later bars."""
        if start < 0 or end > self.T or start >= end:
            raise ValueError("panel slice 超出范围")
        return Panel(
            dates=self.dates[start:end],
            symbols=self.symbols,
            names=self.names,
            open=self.open[start:end],
            high=self.high[start:end],
            low=self.low[start:end],
            close=self.close[start:end],
            volume=self.volume[start:end],
            adj_close=self.adj_close[start:end],
        )

    def data_hash(self) -> str:
        h = hashlib.sha256()
        h.update(",".join(self.symbols).encode())
        h.update(",".join(self.dates).encode())
        for arr in (self.open, self.close, self.adj_close):
            h.update(np.ascontiguousarray(arr, dtype=np.float64).tobytes())
        return h.hexdigest()[:16]


def build_panel(bars_by_symbol: dict[str, list[dict]], names: dict[str, str] | None = None) -> Panel:
    """Union of dates; missing bars stay NaN. bars need datetime/open/high/low/close."""
    names = names or {}
    per: dict[str, dict[str, dict]] = {}
    dates: set[str] = set()
    for sym, rows in bars_by_symbol.items():
        bucket: dict[str, dict] = {}
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            d = norm_date(row.get("datetime") or row.get("date"))
            if not d:
                continue
            o, h, l, c = _f(row.get("open")), _f(row.get("high")), _f(row.get("low")), _f(row.get("close"))
            if not np.isfinite(c):
                continue
            adj = _f(row.get("adj_close"))
            bucket[d] = {
                "open": o if np.isfinite(o) else c,
                "high": h if np.isfinite(h) else c,
                "low": l if np.isfinite(l) else c,
                "close": c,
                "adj_close": adj if np.isfinite(adj) else c,
                "volume": _f(row.get("volume")),
            }
            dates.add(d)
        per[sym] = bucket

    symbols = [s for s in bars_by_symbol if per.get(s)]
    ordered = sorted(dates)
    t, s = len(ordered), len(symbols)
    open_ = np.full((t, s), np.nan)
    high = np.full((t, s), np.nan)
    low = np.full((t, s), np.nan)
    close = np.full((t, s), np.nan)
    adj_close = np.full((t, s), np.nan)
    volume = np.full((t, s), np.nan)
    for j, sym in enumerate(symbols):
        bucket = per[sym]
        for i, d in enumerate(ordered):
            bar = bucket.get(d)
            if not bar:
                continue
            open_[i, j] = bar["open"]
            high[i, j] = bar["high"]
            low[i, j] = bar["low"]
            close[i, j] = bar["close"]
            adj_close[i, j] = bar["adj_close"]
            volume[i, j] = bar["volume"]
    return Panel(
        dates=ordered,
        symbols=symbols,
        names={sym: names.get(sym) or names.get(sym[-6:], "") or "" for sym in symbols},
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=volume,
        adj_close=adj_close,
    )
