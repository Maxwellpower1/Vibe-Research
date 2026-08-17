"""Percentiles, histogram, THS parse, universe, snapshot (no network)."""
import json
import pathlib

import astock
import cross_section
import screener_snap
import ths_ext
import universe


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


def test_parse_sina_names():
    m = cross_section.parse_sina_names([
        {"code": "600519", "name": "贵州茅台"},
        {"code": "bad", "name": "x"},
        {"code": "000001", "name": "  "},
        {"code": "000858", "name": "五粮液"},
    ])
    assert m == {"600519": "贵州茅台", "000858": "五粮液"}


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
    rows = [
        {"code": f"{i:06d}", "name": f"N{i}", "changepercent": 0.1}
        for i in range(2000)
    ]
    monkeypatch.setattr(cross_section, "_sina_hs_a_all", lambda *a, **k: rows)
    monkeypatch.setattr(cross_section, "_tencent_pcts", lambda codes: (_ for _ in ()).throw(AssertionError("tencent")))
    pcts, src = cross_section.fetch_market_pcts_with_source()
    assert src == "sina"
    assert len(pcts) == 2000
    assert (tmp_path / "a-share-codes.json").exists()
    assert universe.name_map()["000000"] == "N0"
    assert universe.rows()[0] == {"code": "000000", "name": "N0"}


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


def test_only_universe_owns_code_file():
    root = pathlib.Path(__file__).resolve().parents[1]
    hits = []
    for p in root.rglob("*.py"):
        if any(part in p.parts for part in ("tests", ".venv", "__pycache__")):
            continue
        if "a-share-codes.json" in p.read_text(encoding="utf-8"):
            hits.append(p.name)
    assert hits == ["universe.py"]


def test_universe_search_layers():
    rows = [
        {"code": "000001", "name": "平安银行"},
        {"code": "600519", "name": "贵州茅台"},
        {"code": "600839", "name": "四川长虹"},
        {"code": "601318", "name": "中国平安"},
        {"code": "000858", "name": "五粮液"},
    ]
    assert universe.search("6005", 8, rows)[0]["code"] == "600519"
    assert universe.search("茅台", 8, rows) == [{"code": "600519", "name": "贵州茅台"}]
    assert universe.search("银行", 8, rows) == [{"code": "000001", "name": "平安银行"}]
    assert universe.search("  ", 8, rows) == []
    assert universe.search("999999", 8, rows) == []
    py = universe.search("payh", 8, rows)
    if universe._ensure_pinyin():
        assert py[0] == {"code": "000001", "name": "平安银行"}
        gz = universe.search("gzmt", 8, rows)
        assert gz[0]["code"] == "600519"
    else:
        assert py == []


def test_universe_search_skips_letters_when_names_thin(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    universe.save([f"{i:06d}" for i in range(2000)])
    assert universe.search("payh", 8) == []
    assert universe.search("茅台", 8) == []
    assert universe.search("000001", 3)[0]["code"] == "000001"


def test_universe_search_reads_file_once(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    universe.save([f"{i:06d}" for i in range(2000)], names={"000001": "平安银行"})
    n = {"n": 0}
    orig = universe._read_payload

    def wrapped():
        n["n"] += 1
        return orig()

    monkeypatch.setattr(universe, "_read_payload", wrapped)
    assert universe.search("000001", 3)[0]["name"] == "平安银行"
    assert universe.search("000002", 3)[0]["code"] == "000002"
    assert n["n"] == 1


def test_universe_search_reads_stale_file(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    codes = [f"{i:06d}" for i in range(2000)]
    tmp_path.joinpath("a-share-codes.json").write_text(
        json.dumps({"ts": 1, "codes": codes, "names": {"000001": "平安银行"}}),
        encoding="utf-8",
    )
    assert universe.load() == []
    hit = universe.search("000001", 3)
    assert hit[0] == {"code": "000001", "name": "平安银行"}


def test_universe_save_load_and_ttl(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    codes = [f"{i:06d}" for i in range(2000)]
    universe.save(codes, names={"000000": "零号", "600519": "茅台"})
    assert universe.load() == codes
    assert universe.name_map()["000000"] == "零号"
    assert "600519" not in universe.name_map()
    universe.save(codes, names={"000001": "平安"})
    assert universe.name_map()["000000"] == "零号"
    assert universe.name_map()["000001"] == "平安"
    universe.save(["600519"])
    assert universe.load() == codes
    tmp_path.joinpath("a-share-codes.json").write_text(
        json.dumps({"ts": 1, "codes": codes}),
        encoding="utf-8",
    )
    assert universe.load() == []
    assert universe.name_map() == {}


def test_ths_members(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    old = dict(ths_ext._MEM)
    ths_ext._MEM.update({
        "ts": 9e12,
        "concepts": {
            "600519": {"code": "600519", "name": "茅台", "concepts": ["白酒"]},
            "000858": {"code": "000858", "name": "五粮液", "concepts": ["白酒"]},
        },
        "industries": {
            "600519": {"code": "600519", "name": "茅台", "industries": ["食品", "白酒"], "path": "食品-白酒"},
        },
    })
    try:
        assert set(ths_ext.members("concept", "白酒")) == {"600519", "000858"}
        assert ths_ext.members("industry", "食品-白酒") == ["600519"]
        assert ths_ext.members("concept", "") == []
        assert ths_ext.members("concept", "没有") == []
    finally:
        ths_ext._MEM.clear()
        ths_ext._MEM.update(old)


def test_snap_joins_boards_and_survives_miss(monkeypatch):
    quotes = {
        "600519": {
            "name": "茅台", "price": 1400, "pct": 1.2, "pe_ttm": 18, "pb": 6,
            "mcap_yi": 20000, "turnover": 0.3,
        },
        "000001": {
            "name": "平安", "price": 10, "change_pct": -0.5, "pe_ttm": 5, "pb": 0.8,
            "mcap_yi": 2000, "turnover_pct": 1.1,
        },
    }
    monkeypatch.setattr(ths_ext, "load", lambda: {
        "concepts": {"600519": {"name": "茅台", "concepts": ["白酒"]}},
        "industries": {"600519": {"path": "食品-白酒", "name": "茅台"}},
    })
    out = screener_snap.build_snapshot(codes=["600519", "000001", "300750"], quotes=quotes)
    assert out["n"] == 2
    by = {r["code"]: r for r in out["rows"]}
    assert set(by["600519"]) >= set(screener_snap.ROW_FIELDS)
    assert by["600519"]["industry"] == "食品-白酒"
    assert by["600519"]["concepts"] == ["白酒"]
    assert by["000001"]["industry"] == ""
    assert by["000001"]["concepts"] == []
    assert by["000001"]["pct"] == -0.5
    assert by["000001"]["turnover"] == 1.1


def test_snap_fills_name_from_universe(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    codes = [f"{i:06d}" for i in range(1999)] + ["600519"]
    universe.save(codes, names={"600519": "贵州茅台"})
    monkeypatch.setattr(ths_ext, "load", lambda: {"concepts": {}, "industries": {}})
    out = screener_snap.build_snapshot(
        codes=["600519"],
        quotes={"600519": {"price": 1400, "name": "", "pct": 1, "pe_ttm": 1, "pb": 1, "mcap_yi": 1, "turnover": 1}},
    )
    assert out["rows"][0]["name"] == "贵州茅台"


def test_snap_skips_bad_price():
    assert screener_snap.row_from_quote("600519", {"price": 0, "name": "x"}) is None
    assert screener_snap.row_from_quote("600519", None) is None


def test_snap_does_not_write_quote_cache(monkeypatch):
    astock._QUOTE_CACHE.clear()
    vals = ["0"] * 55
    vals[1] = "茅台"
    vals[3] = "1400"
    vals[32] = "0.72"
    vals[38] = "0.3"
    vals[39] = "18"
    vals[44] = "18000"
    vals[46] = "6.4"
    line = 'v_sh600519="' + "~".join(vals) + '";'
    monkeypatch.setattr(astock, "_fetch_gtimg", lambda _c: line)
    monkeypatch.setattr(ths_ext, "load", lambda: {"concepts": {}, "industries": {}})
    out = screener_snap.build_snapshot(codes=["600519"])
    assert out["n"] == 1
    assert out["rows"][0]["price"] == 1400
    assert out["rows"][0]["pe_ttm"] == 18
    assert len(astock._QUOTE_CACHE) == 0


def test_snap_not_on_review_jobs():
    import review_jobs
    src = pathlib.Path(review_jobs.__file__).read_text(encoding="utf-8")
    assert "screener_snap" not in src
    warm = pathlib.Path(__file__).resolve().parents[1] / "review_warmup.py"
    assert "screener_snap" not in warm.read_text(encoding="utf-8")


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
