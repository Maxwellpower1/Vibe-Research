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


def test_cached_serves_last_after_ttl(monkeypatch):
    calls = []
    monkeypatch.setattr(ovlab, "_get", lambda *a, **k: calls.append(a) or [{"x": 1}])
    ovlab.get_market_overview()
    ovlab._CACHE.expire("ovlab_market")
    out = ovlab.get_market_overview()
    assert out == [{"x": 1}]
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
    """limit 应透传到上游 params."""
    captured = {}
    def fake_get(path, params=None, timeout=20.0):
        captured["params"] = params
        return [{"ticker": "SC2609"}]
    monkeypatch.setattr(ovlab, "_get", fake_get)
    ovlab.search_symbols("SC", limit=15)
    assert captured["params"].get("limit") == 15
    assert captured["params"].get("keyword") == "SC"


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
