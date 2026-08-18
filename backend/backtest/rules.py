"""A-share trading rules for the daily matcher.

Limit bands are by board prefix. ST 5% cannot be seen from the code;
V1 documents that gap instead of guessing names.
"""

from __future__ import annotations

from dataclasses import dataclass


FILL_OPEN_T1 = "open_t+1"
FILL_CLOSE_T = "close_t"
FILL_MODES = (FILL_OPEN_T1, FILL_CLOSE_T)

# Main board 10%, ChiNext/STAR 20%, BSE 30%. ST 5% is not in the code.
_LIMIT_20 = ("300", "301", "688")


@dataclass(frozen=True)
class MatcherConfig:
    fill: str = FILL_OPEN_T1
    commission_pct: float = 0.00025
    commission_min: float = 5.0
    stamp_tax_pct: float = 0.0005
    slippage_bps: float = 5.0
    initial_capital: float = 1_000_000.0
    max_positions: int = 10
    lot_size: int = 100
    t_plus: int = 1
    exposure: float = 1.0
    stop_loss_pct: float = 0.0
    max_hold_days: int = 0
    max_weight: float = 0.0
    industry_neutral: bool = False

    def __post_init__(self) -> None:
        if self.fill not in FILL_MODES:
            raise ValueError(f"fill 仅支持 {FILL_MODES}")
        if self.initial_capital <= 0:
            raise ValueError("initial_capital 必须 > 0")
        if self.max_positions < 1:
            raise ValueError("max_positions 必须 >= 1")
        if self.lot_size < 1:
            raise ValueError("lot_size 必须 >= 1")
        if self.t_plus < 0:
            raise ValueError("t_plus 必须 >= 0")
        if not 0 < self.exposure <= 1:
            raise ValueError("exposure 必须在 (0, 1]")
        if self.stop_loss_pct < 0:
            raise ValueError("stop_loss_pct 必须 >= 0")
        if self.max_hold_days < 0:
            raise ValueError("max_hold_days 必须 >= 0")
        if self.max_weight < 0 or self.max_weight > 1:
            raise ValueError("max_weight 必须在 [0, 1] 里, 0 表示不限制")


def digits6(code: str) -> str:
    raw = (code or "").strip().lower()
    if len(raw) >= 8 and raw[:2] in ("sh", "sz", "bj") and raw[2:].isdigit():
        return raw[2:8]
    if raw.isdigit() and len(raw) == 6:
        return raw
    return raw[-6:] if len(raw) >= 6 and raw[-6:].isdigit() else raw


def limit_pct(code: str) -> float:
    """Daily limit band from the 6-digit code. ST 5% is not detectable."""
    d = digits6(code)
    if d.startswith(_LIMIT_20):
        return 0.20
    if d.startswith(("8", "4", "92")):
        return 0.30
    return 0.10


def commission_yuan(notional: float, cfg: MatcherConfig) -> float:
    if notional <= 0:
        return 0.0
    return max(notional * cfg.commission_pct, cfg.commission_min)


def slip_price(raw: float, side: str, cfg: MatcherConfig) -> float:
    """Buy pays up, sell receives down. bps on the raw fill."""
    if raw <= 0:
        return raw
    slip = cfg.slippage_bps / 10_000.0
    if side == "buy":
        return raw * (1.0 + slip)
    return raw * (1.0 - slip)


def at_limit_up(fill: float, pre_close: float, band: float) -> bool:
    if fill <= 0 or pre_close <= 0 or band <= 0:
        return False
    return fill >= pre_close * (1.0 + band) - 1e-6


def at_limit_down(fill: float, pre_close: float, band: float) -> bool:
    if fill <= 0 or pre_close <= 0 or band <= 0:
        return False
    return fill <= pre_close * (1.0 - band) + 1e-6
