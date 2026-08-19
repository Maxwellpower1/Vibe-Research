"""arb_catalog is the only pair list for /arb. Not deriv_catalog / index_catalog."""
from pathlib import Path

from arb_catalog import (
    CALENDAR_UNDS,
    CROSS_PAIRS,
    INDEX_BASIS,
    calendar_unds,
    catalog_unds,
)
from index_catalog import INDEX_CATALOG


def test_catalog_unique_and_covers_pairs():
    unds = calendar_unds()
    assert len(unds) == len(set(unds))
    assert catalog_unds() == unds
    for a, b, _l, _s in CROSS_PAIRS:
        assert a in unds and b in unds
    for u, _c, _k, _n, _m in INDEX_BASIS:
        assert u in unds
    ids = [f"{a}-{b}" for a, b, _l, _s in CROSS_PAIRS]
    assert len(ids) == len(set(ids))
    cash = [c for _u, c, _k, _n, _m in INDEX_BASIS]
    assert len(cash) == len(set(cash))
    assert ("IF", "sh000300", "index", "沪深300", 1) in INDEX_BASIS
    assert ("IH", "sh000016", "index", "上证50", 1) in INDEX_BASIS


def test_sse50_not_in_index_catalog():
    """sh000016 只订报价中心, 不进指数目录."""
    codes = [c for c, _n, _r in INDEX_CATALOG]
    assert "sh000016" not in codes
    assert "sh000300" in codes
    assert "sh000852" in codes


def test_frontend_defs_match_catalog():
    root = Path(__file__).resolve().parents[2]
    text = (root / "frontend" / "src" / "config" / "arb.ts").read_text(encoding="utf-8")
    import re

    fe_cal = re.findall(r'und:\s*"([A-Z]+)"', text.split("export const CROSS_PAIRS")[0])
    assert fe_cal == [u for u, _n in CALENDAR_UNDS]
    fe_cross = re.findall(r'a:\s*"([A-Z]+)",\s*b:\s*"([A-Z]+)"', text)
    assert fe_cross == [(a, b) for a, b, _l, _s in CROSS_PAIRS]
    fe_idx = re.findall(r'cashCode:\s*"([^"]+)"', text)
    assert fe_idx == [c for _u, c, _k, _n, _m in INDEX_BASIS]
