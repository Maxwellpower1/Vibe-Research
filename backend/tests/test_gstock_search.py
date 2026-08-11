"""证券搜索：备用端点 + 「接口不可用」必须与「查无此票」区分开（#26）。

报告者在自己的网络下所有美股/港股/韩股查询都失败，而产品只回一句
「未找到对应美股/港股/韩股代码」——他只能自己逆向排查到底哪一步坏了。
根因是 `except Exception: return None` 把两种完全不同的情况压成了同一个返回值。
"""
import pytest

import gstock


class FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


AAPL_ROW = {
    "Code": "AAPL", "Name": "苹果", "MktNum": "105",
}


def test_falls_back_to_second_endpoint(monkeypatch):
    """主端点挂了要自动换备用，而不是整块功能瘫痪。"""
    tried = []

    def fake_get(url, params=None, headers=None, timeout=10):
        tried.append(url)
        if url == gstock._SEARCH_ENDPOINTS[0]:
            raise ConnectionError("primary down")
        return FakeResp({"QuotationCodeTable": {"Data": [AAPL_ROW]}})

    monkeypatch.setattr(gstock.astock, "em_get", fake_get)

    hit = gstock._search("AAPL")
    assert hit["code"] == "AAPL"
    assert len(tried) == 2, "主端点失败后应当试备用端点"


def test_all_endpoints_down_raises_instead_of_returning_none(monkeypatch):
    """🔴 全部端点失败 ≠ 查无此票。压成同一个 None 正是 #26 里用户无从下手的原因。"""
    def fake_get(url, params=None, headers=None, timeout=10):
        raise ConnectionError("blocked")

    monkeypatch.setattr(gstock.astock, "em_get", fake_get)

    with pytest.raises(gstock.SearchUnavailable) as exc:
        gstock._search("AAPL")
    message = str(exc.value)
    assert "查无此代码" in message, "报错要点破这与「查无此票」不是一回事"
    assert "ConnectionError" in message, "要带上真实的底层错误，便于排查"


def test_unknown_symbol_still_returns_none(monkeypatch):
    """接口正常但确实没这只票 → None（不是异常）。这条边界不能被上面的改动搞混。"""
    def fake_get(url, params=None, headers=None, timeout=10):
        return FakeResp({"QuotationCodeTable": {"Data": []}})

    monkeypatch.setattr(gstock.astock, "em_get", fake_get)

    assert gstock._search("ZZZZ") is None


def test_malformed_payload_is_not_treated_as_not_found(monkeypatch):
    """返回体变形（如被包成 JSONP）时 json() 会抛，同样属于「接口不可用」。"""
    def fake_get(url, params=None, headers=None, timeout=10):
        raise ValueError("Expecting value: line 1 column 1 (char 0)")

    monkeypatch.setattr(gstock.astock, "em_get", fake_get)

    with pytest.raises(gstock.SearchUnavailable):
        gstock._search("AAPL")


# ---------------------------------------------------------------------------
# codex 复审补：主端点"返回了合法 JSON 但结构不对"必须继续试备用端点
# ---------------------------------------------------------------------------


class FakeErrResp:
    """HTTP 错误但 body 仍是合法 JSON —— em_get 不做 raise_for_status，会走到 .json()。"""

    status_code = 403

    def json(self):
        return {"message": "forbidden"}


def test_missing_table_falls_through_to_backup(monkeypatch):
    """主端点返回合法 JSON 却没有 QuotationCodeTable → 必须换备用端点。

    不校验结构的话会被当成"查得到但没匹配"直接收手，备用端点轮不上，调用方拿到
    "未找到"——而这正是 #26 报告者描述的情形，那样这次修复对他完全无效。
    """
    tried = []

    def fake_get(url, params=None, headers=None, timeout=10):
        tried.append(url)
        if url == gstock._SEARCH_ENDPOINTS[0]:
            return FakeResp({"result": {"passportWeb": []}})   # 没有 QuotationCodeTable
        return FakeResp({"QuotationCodeTable": {"Data": [AAPL_ROW]}})

    monkeypatch.setattr(gstock.astock, "em_get", fake_get)

    assert gstock._search("AAPL")["code"] == "AAPL"
    assert len(tried) == 2, "结构不对时应继续试备用端点"


def test_all_endpoints_return_bad_shape_raises(monkeypatch):
    """两个端点都结构不对 → 抛 SearchUnavailable，而不是谎报"查无此票"。"""
    def fake_get(url, params=None, headers=None, timeout=10):
        return FakeResp({"result": {"passportWeb": []}})

    monkeypatch.setattr(gstock.astock, "em_get", fake_get)

    with pytest.raises(gstock.SearchUnavailable, match="QuotationCodeTable"):
        gstock._search("AAPL")


def test_http_error_with_json_body_is_not_a_match(monkeypatch):
    """em_get 不做 raise_for_status：403 的 JSON 错误页不能被当成搜索结果。"""
    def fake_get(url, params=None, headers=None, timeout=10):
        return FakeErrResp()

    monkeypatch.setattr(gstock.astock, "em_get", fake_get)

    with pytest.raises(gstock.SearchUnavailable, match="HTTP 403"):
        gstock._search("AAPL")


def test_empty_data_with_valid_shape_is_still_not_found(monkeypatch):
    """结构正常但 Data 为空 = 真的没匹配到，这条边界不能被上面的改动搞混。"""
    def fake_get(url, params=None, headers=None, timeout=10):
        return FakeResp({"QuotationCodeTable": {"Data": []}})

    monkeypatch.setattr(gstock.astock, "em_get", fake_get)

    assert gstock._search("ZZZZ") is None


@pytest.mark.parametrize("payload", [None, [], "text", {"QuotationCodeTable": []},
                                     {"QuotationCodeTable": {"Data": "oops"}}])
def test_malformed_payload_falls_through_instead_of_crashing(payload, monkeypatch):
    """响应不是预期结构时要切备用端点 / 抛 SearchUnavailable，不能抛 AttributeError。

    校验必须一路做到"能安全使用"为止：payload 可能不是对象（null / 数组），
    Data 也可能不是列表——否则"换下一个端点"这条路等于没铺（codex 第四轮指出）。
    """
    def fake_get(url, params=None, headers=None, timeout=10):
        return FakeResp(payload)

    monkeypatch.setattr(gstock.astock, "em_get", fake_get)

    with pytest.raises(gstock.SearchUnavailable):
        gstock._search("AAPL")


def test_malformed_primary_still_uses_backup(monkeypatch):
    def fake_get(url, params=None, headers=None, timeout=10):
        if url == gstock._SEARCH_ENDPOINTS[0]:
            return FakeResp(None)          # 主端点返回 null
        return FakeResp({"QuotationCodeTable": {"Data": [AAPL_ROW]}})

    monkeypatch.setattr(gstock.astock, "em_get", fake_get)
    assert gstock._search("AAPL")["code"] == "AAPL"
