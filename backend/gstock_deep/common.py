"""Shared types and constants for gstock_deep."""
from __future__ import annotations

import os

import astock

_UA = astock.UA
_YAHOO_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

def _sec_contact() -> str:
    return (os.environ.get("VR_SEC_CONTACT") or "").strip()

_FORM_LABEL = {
    "4": "内部人交易", "8-K": "重大事件", "13F-HR": "机构持仓",
    "144": "限售股拟出售", "10-K": "年报", "10-Q": "季报",
    "SC 13D": "举牌(主动)", "SC 13G": "举牌(被动)", "S-1": "IPO注册",
}


class DataNotAvailable(RuntimeError):
    """Resource genuinely missing (non-trading day / not published yet)."""

