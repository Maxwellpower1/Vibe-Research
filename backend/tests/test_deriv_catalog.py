"""deriv_catalog is the only domestic deriv list for 期权驾驶舱."""
from pathlib import Path

from deriv_catalog import DERIV_CATALOG, GROUPS, catalog_products


def test_catalog_shape_and_groups():
    products = catalog_products()
    assert len(products) == len(set(products))
    assert len(DERIV_CATALOG) == 21
    assert set(GROUPS) == {"index", "etf", "commodity"}
    assert catalog_products("index") == ["IO", "HO", "MO"]
    assert catalog_products("etf") == ["50ETF", "300ETF", "500ETF", "915ETF", "000ETF"]
    assert "HC_O" not in products  # not in live ctamap-all frame


def test_frontend_defs_match_catalog():
    root = Path(__file__).resolve().parents[2]
    text = (root / "frontend" / "src" / "config" / "deriv.ts").read_text(encoding="utf-8")
    import re

    fe = re.findall(r'product:\s*"([^"]+)"', text)
    assert fe == catalog_products()
