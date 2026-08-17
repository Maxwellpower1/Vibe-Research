"""纯逻辑单测（无网络、快、确定）：市场前缀、估值计算、行情解析。"""
import math

import astock


def test_get_prefix():
    assert astock.get_prefix("600519") == "sh"
    assert astock.get_prefix("900001") == "sh"   # 9 开头也是沪
    assert astock.get_prefix("000001") == "sz"
    assert astock.get_prefix("300750") == "sz"
    assert astock.get_prefix("832000") == "bj"   # 8 开头北交所
    assert astock.get_prefix("510300") == "sh"   # 沪 ETF（issue #10：曾误判 sz → 行情为 0）
    assert astock.get_prefix("588000") == "sh"   # 科创 50 ETF
    assert astock.get_prefix("159915") == "sz"   # 深 ETF 15 开头走默认 sz


def test_resolve_symbol():
    assert astock.resolve_symbol("600519") == "sh600519"
    assert astock.resolve_symbol("000001") == "sz000001"       # bare = 平安银行
    assert astock.resolve_symbol("sh000001") == "sh000001"     # 上证须显式前缀
    assert astock.resolve_symbol("SZ399006") == "sz399006"
    assert astock.resolve_symbol("hkHSI") == "hkHSI"           # case-sensitive on wire
    assert astock.resolve_symbol("hkhstech") == "hkHSTECH"
    assert astock.resolve_symbol("usIXIC") == "usIXIC"
    assert astock.resolve_symbol("usixic") == "usIXIC"
    assert astock.resolve_symbol("usDJI") == "usDJI"
    assert astock.resolve_symbol("whUSDCNY") == "whUSDCNY"
    assert astock.resolve_symbol("whusdcny") == "whUSDCNY"
    assert astock.resolve_symbol("bad") == ""


def test_tencent_minute_url():
    assert "usMinute" in astock.tencent_minute_url("usIXIC")
    assert "usMinute" in astock.tencent_minute_url("usDJI")
    assert "/minute/query" in astock.tencent_minute_url("sh000001")
    assert "usMinute" not in astock.tencent_minute_url("hkHSI")


def test_light_kline_us_minute(monkeypatch):
    payload = {
        "data": {
            "usIXIC": {
                "data": {"data": ["0930 100 0", "0931 101 10"], "date": "20260814"},
                "qt": {"usIXIC": ["", "纳斯达克", "", "", "99"]},
            }
        }
    }
    monkeypatch.setattr(astock, "_tencent_json", lambda url: payload)
    out = astock.light_kline("usIXIC", "1", num=240)
    assert out["symbol"] == "usIXIC"
    assert out["name"] == "纳斯达克"
    assert out["prev_close"] == 99
    assert [b["close"] for b in out["bars"]] == [100.0, 101.0]


def test_light_kline_us_falls_back_to_eastmoney(monkeypatch):
    class _Resp:
        def json(self):
            return {
                "data": {
                    "preKPrice": 53700.0,
                    "klines": [
                        "2026-08-14 09:30,53700,53710,53720,53690,0",
                        "2026-08-14 09:31,53710,53720,53730,53700,0",
                    ],
                }
            }

    monkeypatch.setattr(astock, "_tencent_json", lambda url: {"data": {}})
    monkeypatch.setattr(astock, "em_get", lambda *_a, **_k: _Resp())
    out = astock.light_kline("usDJI", "1", num=240)
    assert out["symbol"] == "usDJI"
    assert out["source"] == "eastmoney 100.DJIA"
    assert [b["close"] for b in out["bars"]] == [53710.0, 53720.0]


def test_light_kline_fx_usdcnh(monkeypatch):
    class _Resp:
        def json(self):
            return {
                "data": {
                    "preKPrice": 7.17,
                    "klines": [
                        "2026-08-15 09:30,7.17,7.18,7.19,7.16,0",
                        "2026-08-15 09:31,7.18,7.19,7.20,7.17,0",
                    ],
                }
            }

    monkeypatch.setattr(astock, "em_get", lambda *_a, **_k: _Resp())
    out = astock.light_kline("whUSDCNY", "1", num=240)
    assert out["symbol"] == "whUSDCNY"
    assert out["source"] == "eastmoney USDCNH"
    assert out["prev_close"] == 7.17
    assert [b["close"] for b in out["bars"]] == [7.18, 7.19]


def test_calc_peg():
    assert astock.calc_peg(20, 0.2) == 20 / (0.2 * 100)  # =1.0
    assert astock.calc_peg(20, 0) == float("inf")        # 增速<=0 → inf
    assert astock.calc_peg(20, -0.1) == float("inf")


def test_pe_digestion():
    assert astock.pe_digestion(30, 0.2) == 0.0           # 当前<=目标PE 无需消化
    assert astock.pe_digestion(25, 0.2, target_pe=30) == 0.0
    assert astock.pe_digestion(60, 0.2) > 0              # 高于目标需消化年数
    assert astock.pe_digestion(60, 0) == float("inf")    # 零增速永远消化不掉


def _gtimg_line(**overrides) -> str:
    # 构造一条腾讯行情返回行：v_sh600519="1~名~代码~价~..."（≥53 字段）。
    parts = ["0"] * 55
    parts[1] = overrides.get("name", "贵州茅台")
    parts[3] = overrides.get("price", "1194.45")
    parts[39] = overrides.get("pe_ttm", "18.05")
    parts[44] = overrides.get("float_mcap", "15000")
    parts[45] = overrides.get("mcap", "15000")
    parts[46] = overrides.get("pb", "6.41")
    return 'v_sh600519="' + "~".join(parts) + '";'


def test_parse_gtimg():
    out = astock._parse_gtimg(_gtimg_line())
    assert "600519" in out
    q = out["600519"]
    assert q["name"] == "贵州茅台"
    assert q["price"] == 1194.45
    assert q["pe_ttm"] == 18.05
    assert q["pb"] == 6.41
    assert q["mcap_yi"] == 15000
    assert q["float_mcap_yi"] == 15000


def test_parse_gtimg_star_total_mcap():
    # STAR lockup: 44 float != 45 total. 市值(亿) must use total.
    out = astock._parse_gtimg(_gtimg_line(float_mcap="2708.58", mcap="40228.85"))
    q = out["600519"]
    assert q["mcap_yi"] == 40228.85
    assert q["float_mcap_yi"] == 2708.58


def test_parse_gtimg_bad_line_ignored():
    # 字段不足 / 无引号的行应被安全跳过，不抛异常。
    assert astock._parse_gtimg("garbage;no_quotes_here;") == {}
    assert astock._parse_gtimg("") == {}


def test_tencent_quote_short_ttl(monkeypatch):
    astock._QUOTE_CACHE.clear()
    calls: list[int] = []

    def fake_fetch(prefixed):
        calls.append(1)
        return _gtimg_line()

    monkeypatch.setattr(astock, "_fetch_gtimg", fake_fetch)
    a = astock.tencent_quote(["600519"])
    b = astock.tencent_quote(["600519", "600519"])
    assert len(calls) == 1
    assert a["600519"]["name"] == "贵州茅台"
    assert b["600519"]["price"] == 1194.45


def test_is_ashare_stock():
    assert astock.is_ashare_stock("sh600519") is True
    assert astock.is_ashare_stock("sz000001") is True
    assert astock.is_ashare_stock("sh000001") is False
    # sz 3xxxxx includes ChiNext stocks; 399001 is an index but keeps the old amount rule
    assert astock.is_ashare_stock("sz399001") is True
    assert astock.is_ashare_stock("bj430047") is True


def test_quote_cache_shared_with_cockpit(monkeypatch):
    astock._QUOTE_CACHE.clear()
    calls: list[list[str]] = []

    def fake_fetch(prefixed):
        calls.append(list(prefixed))
        return _gtimg_line()

    monkeypatch.setattr(astock, "_fetch_gtimg", fake_fetch)
    astock.tencent_quote(["600519"])
    import cockpit_live as cl
    out = cl._tencent_quotes(["sh600519"])
    assert len(calls) == 1
    assert out["sh600519"]["price"] == 1194.45
    assert out["sh600519"]["name"] == "贵州茅台"
    assert out["sh600519"]["pe_ttm"] == 18.05
    assert out["sh600519"]["pb"] == 6.41
    assert out["sh600519"]["mcap_yi"] == 15000


def test_quote_cache_index_not_aliased_to_bare(monkeypatch):
    astock._QUOTE_CACHE.clear()
    parts = ["0"] * 40
    parts[1] = "上证指数"
    parts[3] = "3089.12"
    parts[4] = "3080.00"
    parts[31] = "9.12"
    parts[32] = "0.30"
    line = 'v_sh000001="' + "~".join(parts) + '";'

    monkeypatch.setattr(astock, "_fetch_gtimg", lambda _c: line)
    astock.gtimg_quotes(["sh000001"])
    assert astock._quote_cache_get("sh000001")["name"] == "上证指数"
    assert astock._quote_cache_get("000001") is astock._QUOTE_MISS


def test_em_zt_topic_pool_caches(monkeypatch):
    astock._ZT_POOL_CACHE.clear()
    calls: list[tuple] = []

    class R:
        def json(self):
            return {"data": {"pool": [{"c": "600519"}]}}

    def fake_get(url, params=None, headers=None, timeout=10):
        calls.append((url, params.get("date") if params else None))
        return R()

    monkeypatch.setattr(astock, "em_get", fake_get)
    a = astock.em_zt_topic_pool("getTopicZTPool", "20260815", "fbt:asc")
    b = astock.em_zt_topic_pool("getTopicZTPool", "20260815", "fbt:asc")
    assert a == b == [{"c": "600519"}]
    assert len(calls) == 1

