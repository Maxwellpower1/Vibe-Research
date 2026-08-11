"""CTP paths, timeouts, and CTP enum label maps."""
from __future__ import annotations

import os
import re
import threading
from datetime import timezone, timedelta

BEIJING = timezone(timedelta(hours=8))
CACHE_DIR = os.environ.get("VR_DATA_DIR") or os.path.join(
    os.path.expanduser("~"), ".vibe-research"
)
CTP_CFG_FILE = os.path.join(CACHE_DIR, "ctp.json")
# CTP writes DialogRsp.con / Private.con / ... under this directory (not project root)
CTP_FLOW_DIR = os.path.join(CACHE_DIR, "ctp_flow")
# Local settlement bills (parsed equity + raw text), keyed by broker:user
SETTLEMENT_CACHE_FILE = os.path.join(CACHE_DIR, "ctp_settlements.json")

_QRY_GAP = 1.05
_DEFAULT_TIMEOUT = 45.0
_LOG_MAX = 300
# Calendar-day cap for range pull (CTP rate-limits ~1 qry/s)
_MAX_RANGE_DAYS = 120
_SETTLEMENT_CACHE_LOCK = threading.Lock()

_DIR_MAP = {"1": "净", "2": "多", "3": "空"}
_HEDGE_MAP = {"1": "投机", "2": "套利", "3": "套保", "4": "做市商"}
_POS_DATE_MAP = {"1": "今仓", "2": "昨仓"}
# Order / trade (buy-sell direction, different from position long/short)
_BS_MAP = {"0": "买", "1": "卖"}
# CTP ProductClass: 1 Futures, 2 Options, 6 SpotOption (char / str)
_OPTION_PRODUCT_CLASSES = {"2", "6"}
# Common CN option InstrumentID shapes: IO2509-C-4000 / m2509-C-3000 / SR509C5500
_OPTION_ID_RE = re.compile(r"(?:-[CP]-|[CP]\d{3,}|购|沽)", re.IGNORECASE)
_OFFSET_MAP = {
    "0": "开仓",
    "1": "平仓",
    "2": "强平",
    "3": "平今",
    "4": "平昨",
    "5": "强减",
    "6": "本地强平",
}
_ORDER_STATUS_MAP = {
    "0": "全部成交",
    "1": "部分成交队列中",
    "2": "部分成交已撤",
    "3": "未成交队列中",
    "4": "未成交已撤",
    "5": "撤单",
    "a": "未知",
    "b": "尚未触发",
    "c": "已触发",
}
_PRICE_TYPE_MAP = {
    "1": "任意价",
    "2": "限价",
    "3": "最优价",
    "4": "最新价",
    "5": "最新价浮动上浮1",
    "6": "最新价浮动上浮2",
    "7": "最新价浮动上浮3",
    "8": "卖一价",
    "9": "卖一价浮动上浮1",
    "A": "卖一价浮动上浮2",
    "B": "卖一价浮动上浮3",
    "C": "买一价",
    "D": "买一价浮动上浮1",
    "E": "买一价浮动上浮2",
    "F": "买一价浮动上浮3",
    "G": "五档价",
}
_TIME_COND_MAP = {
    "1": "IOC",
    "2": "GFS",
    "3": "GFD",
    "4": "GTD",
    "5": "GTC",
    "6": "GFA",
}
_VOL_COND_MAP = {"1": "任何数量", "2": "最小数量", "3": "全部数量"}
_SUBMIT_STATUS_MAP = {
    "0": "已经提交",
    "1": "撤单已经提交",
    "2": "修改已经提交",
    "3": "已经接受",
    "4": "报单已经被拒绝",
    "5": "撤单已经被拒绝",
    "6": "改单已经被拒绝",
}
_TRADE_TYPE_MAP = {
    "0": "普通成交",
    "1": "期权执行",
    "2": "OTC成交",
    "3": "期转现衍生成交",
    "4": "组合衍生成交",
}
_PRICE_SOURCE_MAP = {
    "0": "前成交价",
    "1": "买成交价",
    "2": "卖成交价",
    "3": "场外成交价",
}
_TRADE_SOURCE_MAP = {"0": "来自交易所普通回报", "1": "来自查询"}

