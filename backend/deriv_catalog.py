"""Single domestic deriv list for 期权驾驶舱 first screen.

Keep frontend/src/config/deriv.ts DERIV_DEFS in the same order.
Codes are OpenVlab `product` values from ctamap-all (calibrated on live frame).
"""
from __future__ import annotations

# (ovlab product, prodUnd, label, group, sector)
DERIV_CATALOG: tuple[tuple[str, str, str, str, str], ...] = (
    ("IO", "IF", "沪深300", "index", "股指"),
    ("HO", "IH", "上证50", "index", "股指"),
    ("MO", "IM", "中证1000", "index", "股指"),
    ("50ETF", "510050", "50ETF", "etf", "股指"),
    ("300ETF", "510300", "300ETF", "etf", "股指"),
    ("500ETF", "510500", "500ETF", "etf", "股指"),
    ("915ETF", "159915", "创业板ETF", "etf", "股指"),
    ("000ETF", "588000", "科创50ETF", "etf", "股指"),
    ("AU_O", "AU", "沪金", "commodity", "金属"),
    ("AG_O", "AG", "沪银", "commodity", "金属"),
    ("CU_O", "CU", "沪铜", "commodity", "金属"),
    ("AL_O", "AL", "沪铝", "commodity", "金属"),
    ("RB_O", "RB", "螺纹钢", "commodity", "黑色"),
    ("I_O", "I", "铁矿石", "commodity", "黑色"),
    ("SC_O", "SC", "原油", "commodity", "能化"),
    ("MA_O", "MA", "甲醇", "commodity", "能化"),
    ("TA_O", "TA", "PTA", "commodity", "能化"),
    ("M_O", "M", "豆粕", "commodity", "油脂"),
    ("Y_O", "Y", "豆油", "commodity", "油脂"),
    ("C_O", "C", "玉米", "commodity", "农副"),
    ("SR_O", "SR", "白糖", "commodity", "农副"),
)

GROUPS = ("index", "etf", "commodity")


def catalog_products(*groups: str) -> list[str]:
    """All ovlab product codes, or only the given groups (index / etf / commodity)."""
    if not groups:
        return [p for p, _u, _n, _g, _s in DERIV_CATALOG]
    want = set(groups)
    return [p for p, _u, _n, g, _s in DERIV_CATALOG if g in want]
