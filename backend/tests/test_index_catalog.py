"""index_catalog is the only index list for 复盘 / 报价中心 / 问 AI."""
from pathlib import Path

import astock
import cockpit_live
from index_catalog import INDEX_CATALOG, A_INDEX_CODES, catalog_codes


def test_catalog_has_csi500_not_csi1000():
    codes = catalog_codes()
    assert "sh000905" in codes
    assert "sh000852" not in codes
    assert len(codes) == 14


def test_astock_and_cockpit_share_catalog():
    assert list(astock.A_INDICES) == A_INDEX_CODES
    assert cockpit_live.WORLD_INDICES == INDEX_CATALOG
    assert A_INDEX_CODES == catalog_codes("CN", "HK")


def test_get_global_indices_uses_review_dc_key(monkeypatch):
    from api_common import _DC_CACHE, _cached
    import market

    _DC_CACHE.clear()
    calls: list[int] = []

    def fake():
        calls.append(1)
        return [{"symbol": "sh000001", "name": "上证指数", "price": 3200, "change_pct": 0.1}]

    monkeypatch.setattr(cockpit_live, "world_indices", fake)
    _cached("world_indices", "live", 20, cockpit_live.world_indices)
    out = market.get_global_indices()
    assert out[0]["name"] == "上证指数"
    assert calls == [1]
    market.get_global_indices()
    assert calls == [1]


def test_frontend_defs_match_catalog():
    root = Path(__file__).resolve().parents[2]
    text = (root / "frontend" / "src" / "config" / "cockpit.ts").read_text(encoding="utf-8")
    fe = [m.group(1) for m in __import__("re").finditer(r'code:\s*"([^"]+)"', text)]
    # WORLD_INDEX_DEFS only; skip commodity codes after the first 14.
    fe = fe[:14]
    assert fe == catalog_codes()
