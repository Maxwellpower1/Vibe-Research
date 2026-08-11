"""CTP futures account package (session login + read-only queries).

Public surface matches the former ``ctp_account`` module.
"""
from __future__ import annotations

from ctp.constants import (
    BEIJING,
    CACHE_DIR,
    CTP_CFG_FILE,
    CTP_FLOW_DIR,
    SETTLEMENT_CACHE_FILE,
)
from ctp.errors import CtpError
from ctp.config import config_status, load_config
from ctp.formatters import compute_market_equity
from ctp.service import (
    fetch_portfolio,
    fetch_settlement,
    fetch_settlement_range,
    get_market_equity_job,
    login,
    logout,
    schedule_market_equity,
)
from ctp.settlement import (
    build_settlement_analytics,
    parse_settlement_text,
    reparse_settlement_cache,
)
from ctp.state import add_log, clear_logs, get_logs

__all__ = [
    "BEIJING",
    "CACHE_DIR",
    "CTP_CFG_FILE",
    "CTP_FLOW_DIR",
    "SETTLEMENT_CACHE_FILE",
    "CtpError",
    "add_log",
    "clear_logs",
    "get_logs",
    "load_config",
    "config_status",
    "compute_market_equity",
    "build_settlement_analytics",
    "parse_settlement_text",
    "reparse_settlement_cache",
    "login",
    "logout",
    "fetch_portfolio",
    "fetch_settlement",
    "fetch_settlement_range",
    "get_market_equity_job",
    "schedule_market_equity",
]
