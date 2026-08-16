"""gstock_deep: Yahoo news RSS fallback (no live Yahoo crumb)."""
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


def test_split_modules_keep_shared_names():
    """Split leftovers used to NameError on live /api/global/* routes."""
    from gstock_deep import eastmoney as em
    from gstock_deep import edgar, earnings, finra, movers, official, options, sec, treasury

    assert official._et_today is earnings._et_today is options._et_today
    assert treasury._TREASURY_TENORS
    assert movers._MKT_FS["us_nasdaq"] == "m:105"
    assert "income" in em._STMT_REPORT
    assert em._STMT_KEYS["income"]
    assert edgar.XBRL_TAGS["净利润"] == "NetIncomeLoss"
    assert "Assets" in edgar._INSTANT_TAGS
    assert hasattr(official, "_cik_cache")
    assert hasattr(finra, "gstock")


def test_earnings_calendar_no_nameerror(monkeypatch):
    from gstock_deep import earnings

    monkeypatch.setattr(earnings, "official_get", lambda *a, **k: {
        "data": {"rows": [{"symbol": "AAPL", "name": "Apple", "time": "AMC",
                           "epsForecast": "1.1", "marketCap": "3T"}]},
    })
    out = earnings.earnings_calendar("2026-08-14")
    assert out["count"] == 1
    assert out["rows"][0]["symbol"] == "AAPL"


def test_daily_filings_no_nameerror(monkeypatch):
    from gstock_deep import sec

    line = (
        "4".ljust(12)
        + "ACME CORP".ljust(62)
        + "0001234567".ljust(12)
        + "20260815".ljust(12)
        + "edgar/data/123/x.htm"
    )
    monkeypatch.setattr(sec, "official_get", lambda *a, **k: f"header\n---\n{line}\n")
    out = sec.daily_filings(date="20260815")
    assert out["date"] == "20260815"
    assert out["filings"][0]["form"] == "4"


def test_edgar_screener_no_nameerror(monkeypatch):
    from gstock_deep import edgar

    monkeypatch.setattr(edgar, "market_frame", lambda *a, **k: {
        "tag": "NetIncomeLoss", "period": "CY2025", "unit": "USD",
        "instant": False, "count": 1,
        "data": [{"cik": 1, "entity": "A", "value": 9, "end": "2025-12-31"}],
    })
    out = edgar.edgar_screener(year=2025)
    assert out["tag"] == "NetIncomeLoss"
    assert out["rows"][0]["value"] == 9


def test_market_movers_no_nameerror(monkeypatch):
    from gstock_deep import movers

    def fake_get(url, params=None, headers=None, timeout=15):
        return FakeResp({"data": {"total": 1, "diff": [{
            "f2": 10.0, "f3": 2.5, "f5": 100, "f6": 200, "f7": 3.0,
            "f12": "AAPL", "f14": "Apple",
        }]}})

    monkeypatch.setattr(movers.astock, "em_get", fake_get)
    out = movers.market_movers("us_gainers", top=10)
    assert out["stocks"][0]["code"] == "AAPL"


def test_short_volume_symbol_no_nameerror(monkeypatch):
    from gstock_deep import finra

    monkeypatch.setattr(gstock, "resolve_symbol", lambda q: AAPL_INFO)
    monkeypatch.setattr(finra, "_recent_weekdays", lambda n: ["20260814"])
    monkeypatch.setattr(finra, "short_volume_all", lambda date=None: {
        "date": date, "market": "CNMS", "count": 1,
        "data": {"AAPL": {"short": 1, "short_exempt": 0, "total": 10, "ratio": 0.1}},
    })
    out = finra.short_volume_symbol("AAPL", days=3)
    assert out["rows"][0]["ratio"] == 0.1


def test_ticker_to_cik_uses_official_cache(monkeypatch):
    from gstock_deep import official, sec

    official._cik_cache = None
    monkeypatch.setattr(sec, "official_get", lambda *a, **k: {
        "0": {"ticker": "AAPL", "cik_str": 320193, "title": "Apple Inc."},
    })
    out = sec.ticker_to_cik("AAPL")
    assert out["cik"] == "0000320193"
    assert official._cik_cache is not None
    official._cik_cache = None


def test_financial_statements_no_nameerror(monkeypatch):
    monkeypatch.setattr(gstock, "resolve_symbol", lambda q: AAPL_INFO)
    monkeypatch.setattr(em.astock, "eastmoney_datacenter", lambda *a, **k: [{
        "REPORT_DATE": "2025-12-31", "REPORT": "年报", "CURRENCY": "USD",
        "ITEM_NAME": "净利润", "AMOUNT": 1.0, "YOY_RATIO": 0.1,
    }])
    out = em.financial_statements("AAPL", "income", 3)
    assert out["item_order"] == ["净利润"]
    assert out["periods"][0]["items"]["净利润"]["amount"] == 1.0


def test_treasury_curve_no_nameerror(monkeypatch):
    from gstock_deep import treasury

    raw = (
        "Date,1 Mo,2 Yr,10 Yr,30 Yr,3 Mo\n"
        "08/15/2026,5.00,4.00,4.20,4.50,5.10\n"
        "08/14/2026,5.10,4.10,4.30,4.60,5.20\n"
    )
    monkeypatch.setattr(treasury, "official_get", lambda *a, **k: raw)
    out = treasury.treasury_curve_overview(2026)
    assert out["date"] == "2026-08-15"
    assert out["spreads"]["ten_two"] == 0.2
