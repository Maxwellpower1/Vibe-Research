"""gstock_deep: fund-flow UA + Yahoo news RSS fallback (no live Yahoo crumb)."""
from __future__ import annotations

import gstock
from gstock_deep import eastmoney as em
from gstock_deep import yahoo as y


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
