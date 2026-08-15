"""gstock_deep: fund-flow UA + Yahoo news RSS fallback (no live Yahoo crumb)."""
from __future__ import annotations

import pytest

import gstock
from gstock_deep import eastmoney as em
from gstock_deep import yahoo as y


@pytest.fixture(autouse=True)
def _reset_yahoo_latch():
    y._clear_yahoo_down()
    yield
    y._clear_yahoo_down()


class FakeResp:
    def __init__(self, payload=None, text="", status=200, content=b""):
        self._payload = payload
        self.text = text
        self.status_code = status
        self.content = content or text.encode("utf-8")

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def test_eastmoney_fund_flow_has_ua():
    """NameError on _UA used to swallow the whole AAPL fund-flow into 404."""
    assert getattr(em, "_UA", None), "eastmoney.fund_flow_daily needs _UA from common"


def test_fund_flow_daily_parses_klines(monkeypatch):
    monkeypatch.setattr(gstock, "resolve_symbol", lambda q: {
        "code": "AAPL", "name": "苹果", "secid_prefix": 105,
        "secucode": "AAPL.O", "market": "NASDAQ",
    })

    def fake_get(url, params=None, headers=None, timeout=15):
        assert headers and "User-Agent" in headers
        return FakeResp({
            "data": {
                "klines": [
                    "2026-08-14,-1.0,2.0,3.0,4.0,5.0,-0.1",
                ],
            },
        })

    monkeypatch.setattr(em.astock, "em_get", fake_get)
    out = em.fund_flow_daily("AAPL", 30)
    assert out["code"] == "AAPL"
    assert len(out["rows"]) == 1
    assert out["rows"][0]["main_net"] == -1.0


def test_stock_news_falls_back_to_rss_when_crumb_403(monkeypatch):
    monkeypatch.setattr(y, "_resolve_yahoo", lambda q: (
        {"code": "AAPL", "name": "苹果", "market": "NASDAQ"},
        "AAPL",
    ))

    def boom():
        raise RuntimeError("403 crumb")

    monkeypatch.setattr(y, "_get_yahoo_session", boom)

    rss = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title>Apple headline</title>
  <link>https://example.com/a</link>
  <pubDate>Fri, 14 Aug 2026 19:17:14 +0000</pubDate>
  <source>Reuters</source>
</item>
</channel></rss>"""

    def fake_get(url, params=None, headers=None, timeout=12):
        assert "feeds.finance.yahoo.com" in url
        return FakeResp(text=rss, content=rss.encode("utf-8"))

    monkeypatch.setattr(y.requests, "get", fake_get)
    out = y.stock_news("AAPL", 8)
    assert out["source"] == "Yahoo Finance RSS"
    assert out["items"][0]["title"] == "Apple headline"
    assert out["items"][0]["publish_ts"]


AAPL_INFO = {
    "code": "AAPL", "name": "苹果", "market": "NASDAQ",
    "secid_prefix": 105, "secucode": "AAPL.O",
}


def _yahoo_down(monkeypatch):
    monkeypatch.setattr(y, "_resolve_yahoo", lambda q: (AAPL_INFO, "AAPL"))
    monkeypatch.setattr(y, "_yahoo_quote_summary", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("403")))
    monkeypatch.setattr(y, "_yahoo_v7_quote_row", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("401")))


def test_key_statistics_falls_back_to_v7_quote(monkeypatch):
    monkeypatch.setattr(y, "_resolve_yahoo", lambda q: (AAPL_INFO, "AAPL"))
    monkeypatch.setattr(y, "_yahoo_quote_summary", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("403")))
    monkeypatch.setattr(y, "_yahoo_v7_quote_row", lambda *_a, **_k: {
        "regularMarketPrice": 220.5,
        "trailingPE": 32.1,
        "forwardPE": 28.4,
        "priceToBook": 45.0,
        "marketCap": 3.3e12,
    })
    out = y.key_statistics("AAPL")
    assert out["source"] == "yahoo_quote"
    assert out["trailing_pe"] == 32.1
    assert out["forward_pe"] == 28.4
    assert out["current_price"] == 220.5


def test_key_statistics_falls_back_to_eastmoney_pe_not_revenue(monkeypatch):
    _yahoo_down(monkeypatch)
    monkeypatch.setattr(y, "_em_push2_val", lambda info: {
        "f9": 29.5, "f23": 12.2, "f43": 220.0, "f115": 31.0, "f116": 3.2e12,
    })
    monkeypatch.setattr(y, "_em_gmain_row", lambda info: {
        "OPERATE_INCOME": 394_328_000_000,
        "PARENT_HOLDER_NETPROFIT": 93_736_000_000,
        "BASIC_EPS": 6.5,
        "ROE_AVG": 18.5,
        "GROSS_PROFIT_RATIO": 46.2,
        "NET_PROFIT_RATIO": 24.1,
        "OPERATE_INCOME_YOY": 6.0,
    })
    out = y.key_statistics("AAPL")
    assert out["source"] == "eastmoney"
    assert out["trailing_pe"] == 31.0
    assert out["forward_pe"] == 29.5
    assert out["price_to_book"] == 12.2
    assert abs(out["return_on_equity"] - 0.185) < 1e-9
    assert abs(out["gross_margin"] - 0.462) < 1e-9
    assert out["trailing_pe"] != out.get("total_revenue")
    assert out["trailing_pe"] != 394_328_000_000


def test_em_valuation_computes_pe_from_price_over_eps(monkeypatch):
    _yahoo_down(monkeypatch)
    monkeypatch.setattr(y, "_em_push2_val", lambda info: {"f43": 100.0})
    monkeypatch.setattr(y, "_em_gmain_row", lambda info: {"BASIC_EPS": 5.0, "BPS": 20.0})
    out = y.key_statistics("AAPL")
    assert out["source"] == "eastmoney"
    assert out["trailing_pe"] == 20.0
    assert out["price_to_book"] == 5.0


def test_em_valuation_does_not_use_revenue_as_pe(monkeypatch):
    _yahoo_down(monkeypatch)
    monkeypatch.setattr(y, "_em_push2_val", lambda info: {"f43": 100.0})
    monkeypatch.setattr(y, "_em_gmain_row", lambda info: {
        "OPERATE_INCOME": 9_999_999,
        "PARENT_HOLDER_NETPROFIT": 1_000_000,
        "ROE_AVG": 10.0,
    })
    out = y.key_statistics("AAPL")
    assert out["trailing_pe"] is None
    assert out["forward_pe"] is None
    assert abs(out["return_on_equity"] - 0.10) < 1e-9


def test_fundamentals_one_quotesummary_when_yahoo_up(monkeypatch):
    monkeypatch.setattr(gstock, "resolve_symbol", lambda q: AAPL_INFO)
    calls: list[list[str]] = []

    def fake_qs(sym, modules):
        calls.append(list(modules))
        return {
            "financialData": {"currentPrice": {"raw": 220}},
            "summaryDetail": {"trailingPE": {"raw": 32.0}},
            "earningsTrend": {"trend": [{"period": "0q"}]},
            "majorHoldersBreakdown": {"insidersPercentHeld": {"raw": 0.01}},
        }

    monkeypatch.setattr(y, "_yahoo_quote_summary", fake_qs)
    out = y.stock_fundamentals("AAPL")
    assert len(calls) == 1
    assert "financialData" in calls[0]
    assert "earningsTrend" in calls[0]
    assert out["source"] == "yahoo"
    assert out["valuation"]["trailing_pe"] == 32.0
    assert out["analyst"]["eps_trend"][0]["period"] == "0q"
    assert out["holders"]["overview"]["insiders_pct"] == 0.01


def test_fundamentals_skips_analyst_when_yahoo_modules_down(monkeypatch):
    monkeypatch.setattr(gstock, "resolve_symbol", lambda q: AAPL_INFO)
    monkeypatch.setattr(y, "_yahoo_quote_summary", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("403")))
    monkeypatch.setattr(y, "_yahoo_v7_quote_row", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("401")))
    monkeypatch.setattr(y, "_em_push2_val", lambda info: {"f115": 31.0, "f43": 220.0})
    monkeypatch.setattr(y, "_em_gmain_row", lambda info: {})
    called = []
    monkeypatch.setattr(y, "analyst_estimates", lambda q: called.append("ana") or {})
    monkeypatch.setattr(y, "institutional_holders", lambda q: called.append("hold") or {})
    out = y.stock_fundamentals("AAPL")
    assert out["source"] == "eastmoney"
    assert out["valuation"]["trailing_pe"] == 31.0
    assert out["analyst"] is None
    assert called == []


def test_latched_skips_yahoo_and_uses_eastmoney(monkeypatch):
    y._mark_yahoo_down()
    monkeypatch.setattr(y, "_resolve_yahoo", lambda q: (AAPL_INFO, "AAPL"))
    qs_calls = []
    monkeypatch.setattr(y, "_yahoo_quote_summary", lambda *_a, **_k: qs_calls.append("qs") or {})
    monkeypatch.setattr(y, "_yahoo_v7_quote_row", lambda *_a, **_k: qs_calls.append("v7") or {})
    monkeypatch.setattr(y, "_em_push2_val", lambda info: {"f115": 30.0, "f43": 1.0})
    monkeypatch.setattr(y, "_em_gmain_row", lambda info: {})
    out = y.key_statistics("AAPL")
    assert qs_calls == []
    assert out["source"] == "eastmoney"
    assert out["trailing_pe"] == 30.0
