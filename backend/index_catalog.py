"""Single index list for 复盘快照, 报价中心, and 问 AI.

Keep frontend/src/config/cockpit.ts WORLD_INDEX_DEFS in the same order.
"""
from __future__ import annotations

# (tencent symbol, label, region)
INDEX_CATALOG: tuple[tuple[str, str, str], ...] = (
    ("sh000001", "上证指数", "CN"),
    ("sz399001", "深证成指", "CN"),
    ("sz399006", "创业板指", "CN"),
    ("sh000688", "科创50", "CN"),
    ("sh000300", "沪深300", "CN"),
    ("sh000905", "中证500", "CN"),
    ("sh000852", "中证1000", "CN"),
    ("hkHSI", "恒生指数", "HK"),
    ("hkHSTECH", "恒生科技", "HK"),
    ("usDJI", "道琼斯", "US"),
    ("usIXIC", "纳斯达克", "US"),
    ("usINX", "标普500", "US"),
    ("usVIX", "恐慌指数", "US"),
    ("usSOXX", "费城半导体", "US"),
    ("whUSDCNY", "美元/人民币", "FX"),
)


def catalog_codes(*regions: str) -> list[str]:
    """All codes, or only the given regions (CN / HK / US / FX)."""
    if not regions:
        return [c for c, _n, _r in INDEX_CATALOG]
    want = set(regions)
    return [c for c, _n, r in INDEX_CATALOG if r in want]


# A-share + HK: used by index_quote (问 AI 工具 scope=indices).
A_INDEX_CODES = catalog_codes("CN", "HK")
