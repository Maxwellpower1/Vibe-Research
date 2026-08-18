"""OpenVlab 数据层单测（无网络、快、确定）。

mock 上游 _get / _post, 验证:
- 缓存 TTL 生效与空结果不缓存
- search_symbols 的 limit 透传
- option/future position details 的双层响应壳提取
- 响应壳 code != 0 抛错
- 空 / 非法输入安全返回
- DependencyMissing 在缺 requests 时抛出
"""
import time
from datetime import datetime

import pytest

import ovlab


@pytest.fixture(autouse=True)
def _clear_cache():
    ovlab._CACHE.clear()
    yield
    ovlab._CACHE.clear()


# ---------- _cached ----------

def test_cached_hit_avoids_upstream(monkeypatch):
    """命中缓存时不再调上游."""
    calls = []
    monkeypatch.setattr(ovlab, "_get", lambda *a, **k: calls.append(a) or [{"x": 1}])
    ovlab.get_market_overview()
    ovlab.get_market_overview()  # 第二次应走缓存
    assert len(calls) == 1


def test_cached_empty_not_cached(monkeypatch):
    """数据源故障的空结果不缓存, 下次请求直接重试."""
    calls = []
    monkeypatch.setattr(ovlab, "_get", lambda *a, **k: calls.append(a) or [])
    ovlab.get_market_overview()  # 空 list, valid 判否, 不缓存
    ovlab.get_market_overview()  # 再次应重试
    assert len(calls) == 2


def test_cached_serves_last_after_ttl_when_closed(monkeypatch):
    """休市冻结: 过期不重取, 直接喂上一笔."""
    calls = []
    monkeypatch.setattr(ovlab, "deriv_market_open", lambda: False)
    monkeypatch.setattr(ovlab, "_get", lambda *a, **k: calls.append(a) or [{"x": 1}])
    ovlab.get_market_overview()
    ovlab._CACHE.expire("ovlab_market")
    out = ovlab.get_market_overview()
    assert out == [{"x": 1}]
    assert len(calls) == 1


def test_cached_refreshes_after_ttl_when_open(monkeypatch):
    """盘中: 过期重取上游, 拿到新值."""
    calls = []
    monkeypatch.setattr(ovlab, "deriv_market_open", lambda: True)
    monkeypatch.setattr(ovlab, "_get", lambda *a, **k: calls.append(a) or [{"x": len(calls)}])
    assert ovlab.get_market_overview() == [{"x": 1}]
    ovlab._CACHE.expire("ovlab_market")
    assert ovlab.get_market_overview() == [{"x": 2}]
    assert len(calls) == 2


def test_cached_open_failure_falls_back_to_last(monkeypatch):
    """盘中上游失败: 回落上一笔, 不抛错."""
    calls = []
    monkeypatch.setattr(ovlab, "deriv_market_open", lambda: True)
    monkeypatch.setattr(ovlab, "_get", lambda *a, **k: calls.append(a) or [{"x": 1}])
    ovlab.get_market_overview()
    ovlab._CACHE.expire("ovlab_market")

    def boom(*a, **k):
        raise RuntimeError("upstream down")
    monkeypatch.setattr(ovlab, "_get", boom)
    assert ovlab.get_market_overview() == [{"x": 1}]


def test_cached_cold_key_fetches_once_when_closed(monkeypatch):
    """休市冷键 (启动后第一枪): 放行一次出网."""
    calls = []
    monkeypatch.setattr(ovlab, "deriv_market_open", lambda: False)
    monkeypatch.setattr(ovlab, "_get", lambda *a, **k: calls.append(a) or [{"x": 1}])
    assert ovlab.get_market_overview() == [{"x": 1}]
    assert len(calls) == 1


# ---------- deriv_market_open ----------

@pytest.mark.parametrize("dt,expected", [
    (datetime(2026, 8, 18, 10, 0), True),    # 周二日盘
    (datetime(2026, 8, 18, 12, 0), False),   # 午休
    (datetime(2026, 8, 18, 14, 0), True),    # 下午盘
    (datetime(2026, 8, 18, 15, 30), False),  # 盘后
    (datetime(2026, 8, 18, 21, 30), True),   # 夜盘
    (datetime(2026, 8, 19, 1, 0), True),     # 周三凌晨夜盘 (属周二)
    (datetime(2026, 8, 17, 1, 0), False),    # 周一凌晨无夜盘
    (datetime(2026, 8, 22, 1, 0), True),     # 周六凌晨 (属周五夜盘)
    (datetime(2026, 8, 22, 10, 0), False),   # 周六白天
    (datetime(2026, 8, 23, 21, 30), False),  # 周日无夜盘
])
def test_deriv_market_open_windows(dt, expected):
    assert ovlab.deriv_market_open(dt) is expected


# ---------- get_last_bar ----------

def test_last_bar_cached_60s(monkeypatch):
    """last-bar 走 60s 缓存: 两次调用只出网一次."""
    calls = []
    monkeypatch.setattr(ovlab, "_get", lambda *a, **k: calls.append(a) or {"close": 1})
    assert ovlab.get_last_bar("IM2609") == {"close": 1}
    assert ovlab.get_last_bar("IM2609") == {"close": 1}
    assert len(calls) == 1
    assert ovlab.get_last_bar("") == {}
    assert len(calls) == 1


def test_cached_custom_ttl(monkeypatch):
    """自定义 ttl 生效: 60s 缓存期内不重试."""
    calls = []
    monkeypatch.setattr(ovlab, "_get", lambda *a, **k: calls.append(a) or [{"t": "SC"}])
    ovlab.search_symbols("SC")
    ovlab.search_symbols("SC")
    assert len(calls) == 1  # 60s 内命中


# ---------- search_symbols ----------

def test_search_symbols_limit_passed(monkeypatch):
    """limit 应透传到上游 params; 上游查询参数名是 search."""
    captured = {}
    def fake_get(path, params=None, timeout=20.0):
        captured["params"] = params
        return [{"ticker": "SC2609"}]
    monkeypatch.setattr(ovlab, "_get", fake_get)
    ovlab.search_symbols("SC", limit=15)
    assert captured["params"].get("limit") == 15
    assert captured["params"].get("search") == "SC"


def test_search_symbols_unwraps_pagination_shell(monkeypatch):
    """上游返回 {data, pagination} 分页壳, 取 data 列表."""
    def fake_get(path, params=None, timeout=20.0):
        return {"data": [{"ticker": "IM2609"}], "pagination": {"total": 1}}
    monkeypatch.setattr(ovlab, "_get", fake_get)
    out = ovlab.search_symbols("IM2609")
    assert out == [{"ticker": "IM2609"}]


def test_search_symbols_no_limit_omitted(monkeypatch):
    """limit<=0 时不传 limit 参数."""
    captured = {}
    def fake_get(path, params=None, timeout=20.0):
        captured["params"] = params
        return []
    monkeypatch.setattr(ovlab, "_get", fake_get)
    ovlab.search_symbols("SC", limit=0)
    assert "limit" not in (captured["params"] or {})


# ---------- 双层响应壳提取 ----------

def test_option_position_details_unwraps_double_shell(monkeypatch):
    """option-position/details 响应为 {code:0, result:{code:200, data:{...}}}, 取 result.data."""
    inner = {"short_rank_table": [{"rank": 1, "memberName": "A"}]}
    monkeypatch.setattr(ovlab, "_get",
                        lambda *a, **k: {"code": 200, "message": "ok", "data": inner})
    r = ovlab.get_option_position_details("IO", "IO2608", "C", "2026-08-03")
    assert r == inner


def test_option_position_details_fallback_when_no_data_key(monkeypatch):
    """无 data 键时回退返回 result 本身."""
    raw = {"foo": "bar"}
    monkeypatch.setattr(ovlab, "_get", lambda *a, **k: raw)
    r = ovlab.get_option_position_details("IO", "IO2608", "C", "2026-08-03")
    assert r == raw


def test_future_position_details_unwraps_double_shell(monkeypatch):
    inner = {"long_rank_table": [{"rank": 1}], "maxNetLong": {"memberName": "B"}}
    monkeypatch.setattr(ovlab, "_get",
                        lambda *a, **k: {"code": 200, "data": inner})
    r = ovlab.get_future_position_details("RB", "rb2608", "0", "2026-08-03")
    assert r == inner


# ---------- 输入校验 ----------

def test_option_position_details_bad_direction(monkeypatch):
    """direction 非 C/P 返回空 dict, 不打上游."""
    called = []
    monkeypatch.setattr(ovlab, "_get", lambda *a, **k: called.append(1) or {})
    assert ovlab.get_option_position_details("IO", "IO2608", "X", "2026-08-03") == {}
    assert called == []


def test_option_position_details_missing_args():
    assert ovlab.get_option_position_details("", "IO2608", "C", "2026-08-03") == {}
    assert ovlab.get_option_position_details("IO", "", "C", "2026-08-03") == {}


def test_future_position_details_missing_args():
    assert ovlab.get_future_position_details("", "rb2608", "0", "2026-08-03") == {}
    assert ovlab.get_future_position_details("RB", "", "0", "") == {}


def test_product_detail_empty_und():
    assert ovlab.get_product_detail("") == {}


def test_kline_history_empty_symbol():
    assert ovlab.get_kline_history("") == {"data": []}
    assert ovlab.get_atmvol_history("   ") == {"data": []}


def test_last_bars_empty_codes(monkeypatch):
    called = []
    monkeypatch.setattr(ovlab, "_post", lambda *a, **k: called.append(1) or [])
    assert ovlab.get_last_bars([]) == []
    assert called == []


# ---------- 响应壳校验 ----------

def test_get_raises_on_nonzero_code(monkeypatch):
    """上游 code != 0 抛 RuntimeError."""
    class FakeResp:
        def raise_for_status(self): pass
        def json(self): return {"code": 1, "message": "boom"}
    monkeypatch.setattr(ovlab, "_requests",
                        lambda: type("R", (), {"get": lambda *a, **k: FakeResp()}))
    with pytest.raises(RuntimeError, match="openvlab API error"):
        ovlab._get("ctamap-all")


# ---------- DependencyMissing ----------

def test_dependency_missing_raised(monkeypatch):
    """缺 requests 时 _requests 抛 DependencyMissing."""
    import builtins
    real_import = builtins.__import__
    def fake_import(name, *a, **k):
        if name == "requests":
            raise ImportError("no requests")
        return real_import(name, *a, **k)
    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(ovlab.DependencyMissing, match="requests"):
        ovlab._requests()


# ---------- black76 / tquote ----------

def test_black76_atm_parity():
    """平值 Black-76: C == P, 数值对基准 3.9878."""
    c = ovlab.black76(100, 100, 20, 0.25, True)
    p = ovlab.black76(100, 100, 20, 0.25, False)
    assert c == pytest.approx(3.9878, abs=1e-3)
    assert p == pytest.approx(c, abs=1e-12)


def test_black76_put_call_parity_otm():
    """put-call parity (无贴现): C - P == F - K."""
    c = ovlab.black76(954.119, 1000, 26.0, 0.0198, True)
    p = ovlab.black76(954.119, 1000, 26.0, 0.0198, False)
    assert c - p == pytest.approx(954.119 - 1000, abs=1e-9)


def test_black76_invalid_inputs():
    assert ovlab.black76(0, 100, 20, 0.25, True) is None
    assert ovlab.black76(100, 100, 0, 0.25, True) is None
    assert ovlab.black76(100, 100, 20, 0, False) is None


_SURFACE = {
    "202609": {
        "exp": "202609", "expiry_date": "20260825", "days_to_expiry": "7",
        "forward_td": "954.119", "forward_yd": "954.29",
        "maturity_tday": "0.0198413", "atmvol_tday": "20.0764", "atmvol_yday": "20.8889",
        "rho_tday": "1.13", "move_up": "0.0227", "move_dn": "-0.0227",
        "sum_oi_call": "23725", "sum_oi_put": "20361", "last_time": "2026-08-18 15:00:22",
        "theovol_tday": "[[952.0, 19.9525], [960.0, 20.6874]]",
        "delta_tday_call": "[[952.0, 0.536859], [960.0, 0.422002]]",
        "delta_tday_put": "[[952.0, -0.462662], [960.0, -0.577519]]",
        "mktvol_tday_call_bid": "[[952.0, 20.2277], [960.0, 20.6346]]",
        "mktvol_tday_call_ask": "[[952.0, 20.7524], [960.0, 20.9009]]",
        "mktvol_tday_put_bid": '[[952.0, 19.3252], [960.0, ""]]',
        "mktvol_tday_put_ask": '[[952.0, 20.1124], [960.0, ""]]',
        "strike_poi_c": '{"952.0": 2377, "960.0": 894}',
        "strike_poi_p": '{"952.0": 600, "960.0": 262}',
        "strike_oid_c": '{"952.0": 163, "960.0": 122}',
        "strike_oid_p": '{"952.0": 269, "960.0": 166}',
    },
}


def test_build_tquote_parses_str_fields(monkeypatch):
    """surface 的 str 字段 (JSON 字符串/标量) 全部解析成数值, 理论价非空."""
    monkeypatch.setattr(ovlab, "get_volatility_surface", lambda p: _SURFACE)
    out = ovlab._build_tquote("AU")
    assert out["product"] == "AU"
    exp = out["expiries"][0]
    assert exp["exp"] == "202609" and exp["dte"] == 7.0
    assert exp["forward"] == pytest.approx(954.119)
    assert exp["atm"] == 952.0  # 距 forward 最近
    assert len(exp["strikes"]) == 2
    s0 = exp["strikes"][0]
    assert s0["strike"] == 952.0
    assert s0["call"]["delta"] == pytest.approx(0.536859)
    assert s0["call"]["oi"] == 2377.0
    assert s0["call"]["oiChg"] == 163.0
    assert s0["call"]["price"] is not None and s0["call"]["price"] > 0
    assert s0["put"]["ivBid"] == pytest.approx(19.3252)
    # 空串 IV 归 None
    assert exp["strikes"][1]["put"]["ivBid"] is None
    # parity: 同一 theoIv 下 C - P == F - K
    c, p = s0["call"]["price"], s0["put"]["price"]
    assert c - p == pytest.approx(954.119 - 952.0, abs=1e-6)


def test_get_tquote_empty_product():
    assert ovlab.get_tquote("") == {}
    assert ovlab.get_tquote("   ") == {}


def test_sfloat_rejects_nan_inf():
    """surface 里 "nan"/"inf" 字符串必须归 None, 否则响应 JSON 序列化 500."""
    assert ovlab._sfloat("nan") is None
    assert ovlab._sfloat("NaN") is None
    assert ovlab._sfloat("inf") is None
    assert ovlab._sfloat("-inf") is None
    assert ovlab._sfloat(float("nan")) is None
    assert ovlab._sfloat("12.5") == 12.5
    assert ovlab._sfloat("") is None


def test_build_tquote_nan_fields(monkeypatch):
    """含 nan 字符串的 surface 不产生 NaN 输出 (EG 实盘踩过)."""
    import json as _json
    blk = dict(_SURFACE["202609"])
    blk["delta_tday_call"] = '[[952.0, "nan"], [960.0, 0.422002]]'
    blk["atmvol_tday"] = "nan"
    monkeypatch.setattr(ovlab, "get_volatility_surface", lambda p: {"202609": blk})
    out = ovlab._build_tquote("AU")
    exp = out["expiries"][0]
    assert exp["atmIv"] is None
    assert exp["strikes"][0]["call"]["delta"] is None
    assert exp["strikes"][1]["call"]["delta"] is not None
    _json.dumps(out, allow_nan=False)  # 不抛即过


def test_get_tquote_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(ovlab, "deriv_market_open", lambda: True)
    monkeypatch.setattr(ovlab, "get_volatility_surface",
                        lambda p: calls.append(1) or _SURFACE)
    r1 = ovlab.get_tquote("AU")
    r2 = ovlab.get_tquote("AU")
    assert r1 == r2 and len(calls) == 1


# ---------- option_code / und_code / option-daily ----------

def test_option_code_formats():
    """期权代码: {prod}{exp[2:]}{C/P}{strike:g}, 整数行权价去小数, ETF 同样规则."""
    assert ovlab.option_code("AU", "202609", "C", 952.0) == "AU2609C952"
    assert ovlab.option_code("SC", "202610", "P", 570.0) == "SC2610P570"
    assert ovlab.option_code("MA", "202610", "C", 2800.0) == "MA2610C2800"
    assert ovlab.option_code("510300", "202608", "C", 4.7) == "5103002608C4.7"
    assert ovlab.option_code("IF", "202608", "P", 4700.0) == "IF2608P4700"


def test_und_code():
    """IV 历史标的码: 期货期权 {prod}{ym}, ETF 用基金代码本身."""
    assert ovlab.und_code("AU", "202609") == "AU2609"
    assert ovlab.und_code("510300", "202608") == "510300"


def test_tquote_contains_codes(monkeypatch):
    """tquote 每档带 callCode/putCode, 每个到期月带 und."""
    monkeypatch.setattr(ovlab, "get_volatility_surface", lambda p: _SURFACE)
    out = ovlab._build_tquote("AU")
    exp = out["expiries"][0]
    assert exp["und"] == "AU2609"
    s0 = exp["strikes"][0]
    assert s0["callCode"] == "AU2609C952"
    assert s0["putCode"] == "AU2609P952"


def test_trading_day_night_session():
    """交易日分组: 夜盘归次交易日, 凌晨段归前一晚的次交易日, 周末顺延."""
    assert ovlab._trading_day("2026-08-18 10:30:00") == "2026-08-18"  # 周二日盘
    assert ovlab._trading_day("2026-08-17 21:05:00") == "2026-08-18"  # 周一夜盘 -> 周二
    assert ovlab._trading_day("2026-08-18 01:30:00") == "2026-08-18"  # 周二凌晨 (周一夜盘尾巴) -> 周二
    assert ovlab._trading_day("2026-08-14 21:05:00") == "2026-08-17"  # 周五夜盘 -> 周一
    assert ovlab._trading_day("2026-08-15 01:30:00") == "2026-08-17"  # 周六凌晨 (周五夜盘尾巴) -> 周一
    assert ovlab._trading_day("2026-08-15 22:00:00") == "2026-08-17"  # 周六晚(异常数据) -> 周一


_MIN_BARS = [
    # 夜盘 (归 8-18): open 11.0, high 12.0, low 10.5
    ["2026-08-17 21:00:00", 11.5, "0%", 100, 11.0, 11.5, 11.0, 0],
    ["2026-08-17 22:00:00", 11.8, "0%", 200, 11.5, 12.0, 10.5, 0],
    # 日盘 (8-18): close 12.2
    ["2026-08-18 09:30:00", 12.0, "0%", 300, 11.8, 12.1, 11.7, 0],
    ["2026-08-18 15:00:00", 12.2, "0%", 150, 12.0, 12.2, 11.9, 0],
    # 次日
    ["2026-08-19 09:30:00", 12.5, "0%", 80, 12.3, 12.6, 12.2, 0],
]


def test_build_option_daily_aggregates(monkeypatch):
    """分钟 -> 日K: 夜盘并入次日, OHLCV 聚合正确, IV 日线带上."""
    monkeypatch.setattr(ovlab, "get_kline_history",
                        lambda *a, **k: {"data": _MIN_BARS})
    monkeypatch.setattr(ovlab, "get_atmvol_history",
                        lambda *a, **k: {"data": [["2026-08-18", 20.03]]})
    out = ovlab._build_option_daily("AU2609C952", "AU2609")
    assert out["code"] == "AU2609C952"
    bars = out["bars"]
    assert [b["t"] for b in bars] == ["2026-08-18", "2026-08-19"]
    d1 = bars[0]
    assert d1["open"] == pytest.approx(11.0)   # 夜盘第一根 open
    assert d1["high"] == pytest.approx(12.2)
    assert d1["low"] == pytest.approx(10.5)
    assert d1["close"] == pytest.approx(12.2)  # 日盘最后一根 close
    assert d1["vol"] == pytest.approx(750.0)   # 100+200+300+150
    assert out["iv"] == [["2026-08-18", 20.03]]


def test_build_option_daily_no_data(monkeypatch):
    monkeypatch.setattr(ovlab, "get_kline_history", lambda *a, **k: {"data": []})
    assert ovlab._build_option_daily("XX", "") == {}


def test_get_option_daily_empty_code():
    assert ovlab.get_option_daily("") == {}
    assert ovlab.get_option_daily("   ") == {}


# ---------- term-structure ----------

_TS_SURFACE = {
    "202612": {"exp": "202612", "forward_td": "16100.0", "forward_yd": "16150.0",
               "days_to_expiry": "119"},
    "202609": {"exp": "202609", "forward_td": "15950.0", "forward_yd": "16112.0",
               "days_to_expiry": "28"},
    "202610": {"exp": "202610", "forward_td": "nan", "forward_yd": "16000.0",
               "days_to_expiry": "58"},  # fwd nan -> 跳过
}


def test_term_structure_curve_sorted_and_clean(monkeypatch):
    """曲线按 dte 升序, nan forward 的月份被跳过."""
    monkeypatch.setattr(ovlab, "get_volatility_surface", lambda p: _TS_SURFACE)
    out = ovlab.get_term_structure(["AG"])
    curve = out["curves"]["AG"]
    assert [p["exp"] for p in curve] == ["202609", "202612"]
    assert curve[0]["fwd"] == 15950.0 and curve[0]["fwdYd"] == 16112.0
    assert curve[0]["dte"] == 28.0


def test_term_structure_multi_and_empty(monkeypatch):
    """多品种并发; 无 surface 的品种不进结果; 空入参归 {}."""
    monkeypatch.setattr(
        ovlab, "get_volatility_surface",
        lambda p: _TS_SURFACE if p == "AG" else {},
    )
    out = ovlab.get_term_structure(["AG", "XX", "ag"])  # 去重后 AG/XX
    assert list(out["curves"].keys()) == ["AG"]
    assert ovlab.get_term_structure([]) == {}
    assert ovlab.get_term_structure(["  "]) == {}


def test_term_structure_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(ovlab, "deriv_market_open", lambda: True)
    monkeypatch.setattr(ovlab, "get_volatility_surface",
                        lambda p: calls.append(p) or _TS_SURFACE)
    r1 = ovlab.get_term_structure(["AG", "CU"])
    r2 = ovlab.get_term_structure(["CU", "AG"])  # 排序后同钥匙
    assert r1 == r2 and len(calls) == 2
