"""Single arb pair list for the /arb cockpit.

Keep frontend/src/config/arb.ts in the same order.
Codes are OpenVlab future-ts prodUnd (not deriv option product codes).
"""
from __future__ import annotations

# (prodUnd, label)
CALENDAR_UNDS: tuple[tuple[str, str], ...] = (
    ("IF", "沪深300"),
    ("IH", "上证50"),
    ("IM", "中证1000"),
    ("RB", "螺纹钢"),
    ("HC", "热卷"),
    ("I", "铁矿石"),
    ("J", "焦炭"),
    ("JM", "焦煤"),
    ("AU", "沪金"),
    ("AG", "沪银"),
    ("CU", "沪铜"),
    ("AL", "沪铝"),
    ("ZN", "沪锌"),
    ("SC", "原油"),
    ("FU", "燃油"),
    ("TA", "PTA"),
    ("EG", "乙二醇"),
    ("MA", "甲醇"),
    ("PP", "聚丙烯"),
    ("M", "豆粕"),
    ("Y", "豆油"),
    ("P", "棕榈油"),
    ("OI", "菜油"),
    ("RM", "菜粕"),
    ("C", "玉米"),
    ("SR", "白糖"),
    ("SA", "纯碱"),
    ("FG", "玻璃"),
)

# (a, b, label, sector)  价差 = a近月 - b近月, 1:1
CROSS_PAIRS: tuple[tuple[str, str, str, str], ...] = (
    ("RB", "HC", "螺卷", "黑色"),
    ("RB", "I", "螺矿", "黑色"),
    ("J", "JM", "焦炭焦煤", "黑色"),
    ("I", "J", "矿焦", "黑色"),
    ("Y", "P", "豆棕", "油脂"),
    ("Y", "OI", "豆菜油", "油脂"),
    ("M", "RM", "豆菜粕", "油脂"),
    ("AU", "AG", "金银", "金属"),
    ("TA", "EG", "TA-EG", "能化"),
    ("MA", "EG", "甲醇乙二醇", "能化"),
    ("SC", "FU", "原油燃油", "能化"),
    ("IF", "IH", "IF-IH", "股指"),
    ("IF", "IM", "IF-IM", "股指"),
)

# (fut_und, cash_code, cash_kind, cash_label, cash_mult)
# cash_mult: ETF 价 * 1000 才和股指期货同量纲; 指数为 1.
# sh000016 上证50 只订报价中心, 不进指数目录.
INDEX_BASIS: tuple[tuple[str, str, str, str, int], ...] = (
    ("IF", "sh000300", "index", "沪深300", 1),
    ("IF", "sh510300", "etf", "300ETF", 1000),
    ("IH", "sh000016", "index", "上证50", 1),
    ("IH", "sh510050", "etf", "50ETF", 1000),
    ("IM", "sh000852", "index", "中证1000", 1),
)


def calendar_unds() -> list[str]:
    return [u for u, _n in CALENDAR_UNDS]


def calendar_label(und: str) -> str:
    u = (und or "").strip().upper()
    for code, name in CALENDAR_UNDS:
        if code == u:
            return name
    return u


def catalog_unds() -> list[str]:
    """Unique prodUnd in calendar + cross + index order."""
    seen: list[str] = []
    for u, _n in CALENDAR_UNDS:
        if u not in seen:
            seen.append(u)
    for a, b, _l, _s in CROSS_PAIRS:
        for u in (a, b):
            if u not in seen:
                seen.append(u)
    for u, _c, _k, _n, _m in INDEX_BASIS:
        if u not in seen:
            seen.append(u)
    return seen
