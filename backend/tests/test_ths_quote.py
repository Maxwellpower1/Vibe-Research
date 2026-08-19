# -*- coding: utf-8 -*-
"""ths_quote: 同花顺 fuyao 网关.

- detect_market / split_code 代码归市场
- snapshot 解析 (数字字段 ID -> 具名字典, pct 现算)
- kline 解析 + period 校验
- 缓存: 热槽命中 + 过期读上一笔
"""
import pytest

import ths_quote


@pytest.fixture(autouse=True)
def _clear_cache():
    ths_quote._CACHE.clear()
    ths_quote._SESSION = None
    yield
    ths_quote._CACHE.clear()
    ths_quote._SESSION = None


# ---------- detect_market / split_code ----------

def test_detect_market():
    assert ths_quote.detect_market("600519") == "17"   # 沪股
    assert ths_quote.detect_market("000001") == "33"   # 深股 (6位 000xxx 默认深股)
    assert ths_quote.detect_market("300750") == "33"   # 创业板
    assert ths_quote.detect_market("1A0001") == "16"   # 上证指数
    assert ths_quote.detect_market("1B0300") == "16"   # 沪深300
    assert ths_quote.detect_market("399001") == "32"   # 深证成指
    assert ths_quote.detect_market("850001") == "64"   # 同花顺商品指数
    assert ths_quote.detect_market("883957") == "48"   # 板块
    assert ths_quote.detect_market("") is None
    assert ths_quote.detect_market("XYZ") is None


def test_split_code():
    assert ths_quote.split_code("17_600519") == ("17", "600519")
    assert ths_quote.split_code("64:850001") == ("64", "850001")
    assert ths_quote.split_code("600519") == ("17", "600519")
    assert ths_quote.split_code("abc_600519") is None  # 非数字市场前缀
    assert ths_quote.split_code("") is None


# ---------- snapshot ----------

def _snap_payload():
    return {
        "quote_data": [{
            "market": "17",
            "code": "600519",
            "data_fields": ["6", "7", "8", "9", "10", "13", "19", "1771976"],
            "value": [[1293.09, 1291.0, 1302.9, 1285.17, 1297.99, 3872283, 5007014700, 0.95]],
        }],
        "fail_params": None,
    }


def test_snapshot_parse(monkeypatch):
    monkeypatch.setattr(ths_quote, "_post", lambda *a, **k: _snap_payload())
    out = ths_quote.snapshot([("17", "600519")])
    assert len(out) == 1
    row = out[0]
    assert row["code"] == "600519"
    assert row["last"] == 1297.99
    assert row["prev"] == 1293.09
    assert row["pct"] == pytest.approx(0.379, abs=0.01)  # 现算, 不取上游 199112
    assert row["amount"] == 5007014700
    assert row["lb"] == 0.95


def test_snapshot_codes_cache(monkeypatch):
    calls = []
    monkeypatch.setattr(ths_quote, "_post", lambda *a, **k: calls.append(a) or _snap_payload())
    ths_quote.snapshot_codes(["600519"])
    ths_quote.snapshot_codes(["600519"])
    assert len(calls) == 1  # 5s 热缓存命中


def test_snapshot_codes_serves_last_after_ttl(monkeypatch):
    calls = []
    monkeypatch.setattr(ths_quote, "_post", lambda *a, **k: calls.append(a) or _snap_payload())
    ths_quote.snapshot_codes(["600519"])
    ths_quote._CACHE.expire("ths_snap::17:600519")
    out = ths_quote.snapshot_codes(["600519"])
    assert out[0]["last"] == 1297.99
    assert len(calls) == 1  # 过期读上一笔, 不出网


def test_snapshot_codes_skips_unknown():
    assert ths_quote.snapshot_codes(["XYZ", "!!"]) == []


# ---------- kline ----------

def _kline_payload():
    return {
        "quote_data": [{
            "market": "64",
            "code": "850001",
            "data_fields": ["1", "7", "8", "9", "11", "13"],
            "value": [
                [1734969600000, 115.27, 115.62, 115.06, 115.61, 19853301],
                [1735056000000, 115.60, 116.01, 115.40, 115.90, 18000000],
            ],
        }],
    }


def test_kline_parse(monkeypatch):
    monkeypatch.setattr(ths_quote, "_post", lambda *a, **k: _kline_payload())
    out = ths_quote.kline("64", "850001", "day_1", 2)
    assert len(out) == 2
    assert out[0]["t"] == 1734969600000
    assert out[0]["open"] == 115.27
    assert out[0]["close"] == 115.61
    assert out[0]["volume"] == 19853301
    assert out[0]["amount"] is None  # 商品指数无额字段


def test_kline_bad_period():
    with pytest.raises(ValueError):
        ths_quote.kline("64", "850001", "hour_1", 10)


def test_kline_cached_ttl(monkeypatch):
    calls = []
    monkeypatch.setattr(ths_quote, "_post", lambda *a, **k: calls.append(a) or _kline_payload())
    ths_quote.kline_cached("64", "850001", "min_1", 300)
    ths_quote.kline_cached("64", "850001", "min_1", 300)
    assert len(calls) == 1


def test_http_reuses_session(monkeypatch):
    ths_quote._SESSION = None
    hits: list[str] = []

    class FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"status_code": 0, "data": {}}

    class FakeSess:
        def post(self, *a, **k):
            hits.append("p")
            return FakeResp()

    sess = FakeSess()

    class ReqMod:
        class Session:
            def __new__(cls):
                hits.append("new")
                return sess

    monkeypatch.setattr(ths_quote, "_requests", lambda: ReqMod)
    try:
        ths_quote._post("multi_last_snapshot", {}, "600519")
        ths_quote._post("single_kline", {}, "600519")
        assert hits.count("new") == 1
        assert hits.count("p") == 2
    finally:
        ths_quote._SESSION = None
