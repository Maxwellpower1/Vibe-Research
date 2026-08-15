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
    assert astock.resolve_symbol("bad") == ""


def test_tencent_minute_url():
    assert "usMinute" in astock.tencent_minute_url("usIXIC")
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
    parts[44] = overrides.get("mcap", "15000")
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

