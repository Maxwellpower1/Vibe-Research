import pytest

import astock


def test_parse_iwencai_select_rows():
    rows = astock.parse_iwencai_select({
        "datas": [
            {"股票代码": "600519.SH", "股票简称": "贵州茅台"},
            {"code": "000001", "name": "平安银行"},
            {"股票代码": "xx", "股票简称": "无"},
            {"股票代码": "600519.SH", "股票简称": "重复"},
        ],
        "code_count": 2,
    })
    assert [r["code"] for r in rows] == ["600519", "000001"]
    assert rows[0]["name"] == "贵州茅台"


def test_parse_iwencai_select_empty():
    assert astock.parse_iwencai_select({}) == []
    assert astock.parse_iwencai_select({"data": "x"}) == []


def test_iwencai_select_requires_key(monkeypatch):
    monkeypatch.delenv("IWENCAI_API_KEY", raising=False)
    with pytest.raises(astock.DependencyMissing):
        astock.iwencai_select("算力")
