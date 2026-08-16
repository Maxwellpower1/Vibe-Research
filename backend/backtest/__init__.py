"""A-share daily account backtest (V1).

Signal day is not fill day. Default fill is next open. One shared cash
account. T+1, 100-share lots, commission both sides, stamp tax on sells
only. Limit bands use fill vs prior close. Equity is cash + mark-to-close.
"""

from backtest.rules import MatcherConfig, limit_pct
from backtest.service import BacktestError, run_backtest

__all__ = ["BacktestError", "MatcherConfig", "limit_pct", "run_backtest"]
