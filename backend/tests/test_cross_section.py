"""Percentiles, histogram, THS parse, seal flag (no network)."""
import json

import astock
import cross_section
import ths_ext


def test_quantile_and_histogram():
    xs = [-6, -4, -2, -0.5, 0.2, 2, 4, 8]
    p = cross_section.compute_percentiles(xs)
    assert p["n"] == 8
    assert p["up"] == 4
    assert p["down"] == 4
    assert p["flat"] == 0
    assert abs((p["p50"] or 0) - (-0.15)) < 1e-9
    assert p["p10"] is not None and p["p90"] is not None
    hist = cross_section.compute_histogram(xs)
    assert len(hist) == 8
    assert sum(h["count"] for h in hist) == 8
    assert hist[0]["label"] == "<-5%"
    assert hist[0]["count"] == 1
    assert hist[-1]["count"] == 1


def test_parse_sina_pcts_accepts_string_pct():
    m = cross_section.parse_sina_pcts([
        {"code": "600519", "changepercent": "1.25"},
        {"code": "bad", "changepercent": "9"},
        {"code": "000001", "changepercent": -2.0},
        {"code": "300750", "changepercent": "-"},
    ])
    assert m == {"600519": 1.25, "000001": -2.0}


def test_parse_sina_stock_count():
    assert cross_section.parse_sina_stock_count('"5542"') == 5542
    assert cross_section.parse_sina_stock_count(5542) == 5542
    assert cross_section.parse_sina_stock_count("[]") == 0
    assert cross_section.parse_sina_stock_count("bad") == 0


def test_sina_hs_a_all_pages_until_short(monkeypatch):
    monkeypatch.setattr(cross_section, "_sina_hs_a_count", lambda: 0)

    def fake(page, num, sort="symbol", asc=1):
        if page == 1:
            return [{"code": f"{i:06d}", "changepercent": 1} for i in range(80)]
        if page == 2:
            return [{"code": f"{i:06d}", "changepercent": 1} for i in range(80, 100)]
        raise AssertionError(f"unexpected page {page}")

    monkeypatch.setattr(cross_section, "_sina_hs_a", fake)
    rows = cross_section._sina_hs_a_all(page_size=80, max_pages=10)
    assert len(rows) == 100
    assert rows[-1]["code"] == "000099"


def test_sina_hs_a_all_uses_count(monkeypatch):
    monkeypatch.setattr(cross_section, "_sina_hs_a_count", lambda: 160)
    seen: list[int] = []

    def fake(page, num, sort="symbol", asc=1):
        seen.append(page)
        start = (page - 1) * num
        return [{"code": f"{i:06d}", "changepercent": 0.5} for i in range(start, start + num)]

    monkeypatch.setattr(cross_section, "_sina_hs_a", fake)
    rows = cross_section._sina_hs_a_all(page_size=80, max_pages=10)
    assert sorted(seen) == [1, 2]
    assert len(rows) == 160


def test_fetch_pcts_prefers_sina(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    rows = [{"code": f"{i:06d}", "changepercent": 0.1} for i in range(2000)]
    monkeypatch.setattr(cross_section, "_sina_hs_a_all", lambda *a, **k: rows)
    monkeypatch.setattr(cross_section, "_tencent_pcts", lambda codes: (_ for _ in ()).throw(AssertionError("tencent")))
    pcts, src = cross_section.fetch_market_pcts_with_source()
    assert src == "sina"
    assert len(pcts) == 2000
    assert (tmp_path / "a-share-codes.json").exists()


def test_fetch_pcts_uses_tencent_universe(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    codes = [f"{i:06d}" for i in range(2000, 4000)]
    tmp_path.joinpath("a-share-codes.json").write_text(
        json.dumps({"ts": 9e12, "codes": codes}),
        encoding="utf-8",
    )
    monkeypatch.setattr(cross_section, "_sina_hs_a_all", lambda *a, **k: [{"code": "600519", "changepercent": 1}])
    monkeypatch.setattr(cross_section, "_tencent_pcts", lambda cs: {c: 0.5 for c in cs})
    pcts, src = cross_section.fetch_market_pcts_with_source()
    assert src == "tencent"
    assert len(pcts) == 2000


def test_fetch_pcts_keeps_thin_sina_when_tencent_misses(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(cross_section, "_sina_hs_a_all", lambda *a, **k: [{"code": "600519", "changepercent": 1.2}])
    monkeypatch.setattr(cross_section, "_tencent_pcts", lambda cs: {})
    pcts, src = cross_section.fetch_market_pcts_with_source()
    assert src == "sina"
    assert pcts["600519"] == 1.2


def test_seal_flag():
    assert astock.seal_flag(None, "up") is None
    assert astock.seal_flag({"ask1_vol": 0}, "up") is True
    assert astock.seal_flag({"ask1_vol": 1200}, "up") is False
    assert astock.seal_flag({"bid1_vol": 0}, "down") is True
    assert astock.seal_flag({"bid1_vol": 80}, "down") is False


def test_parse_gtimg_bid_ask():
    vals = [""] * 53
    vals[1] = "茅台"
    vals[3] = "1400"
    vals[4] = "1390"
    vals[9] = "1399"
    vals[10] = "200"
    vals[19] = "0"
    vals[20] = "0"
    vals[31] = "10"
    vals[32] = "0.72"
    line = 'v_sh600519="' + "~".join(vals) + '"'
    parsed = astock._parse_gtimg(line)
    q = parsed["600519"]
    assert q["bid1"] == 1399
    assert q["bid1_vol"] == 200
    assert q["ask1_vol"] == 0
    assert astock.seal_flag(q, "up") is True


def test_ths_parse_concepts_and_industry():
    cons = ths_ext.parse_concepts({
        "data": [
            {"symbol": "600519.SH", "name": "贵州茅台", "concepts": ["白酒", "消费"]},
            {"symbol": "", "name": "x", "concepts": ["无"]},
        ],
    })
    assert cons["600519"]["concepts"] == ["白酒", "消费"]
    inds = ths_ext.parse_industries([
        {"symbol": "000001.SZ", "name": "平安银行", "industries": ["银行", "股份制"]},
    ])
    assert inds["000001"]["path"] == "银行-股份制"


def test_ths_profile_from_mem(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    old = dict(ths_ext._MEM)
    ths_ext._MEM.update({
        "ts": 9e12,
        "concepts": {"600519": {"code": "600519", "name": "茅台", "concepts": ["白酒"]}},
        "industries": {"600519": {"code": "600519", "name": "茅台", "industries": ["食品", "白酒"], "path": "食品-白酒"}},
    })
    try:
        p = ths_ext.profile("600519")
        assert p["industry"] == "食品-白酒"
        assert p["concepts"] == ["白酒"]
    finally:
        ths_ext._MEM.clear()
        ths_ext._MEM.update(old)
