"""US daily kline (Sina JSONP)."""
import gstock


def test_us_kline_parses_sina_jsonp(monkeypatch):
    class FakeResp:
        text = 'var([{ "d":"2026-08-14","o":"1","h":"2","l":"0.5","c":"1.5","v":"9" }])'

        def raise_for_status(self):
            return None

    import requests as req_mod

    monkeypatch.setattr(req_mod, "get", lambda *a, **k: FakeResp())
    monkeypatch.setattr(gstock, "resolve_symbol", lambda q: {
        "code": "AAPL", "name": "Apple", "market": "NASDAQ",
    })
    out = gstock.us_stock_kline("AAPL", 20)
    assert out["source"] == "sina"
    assert out["bars"][0]["close"] == 1.5
    assert out["bars"][0]["date"] == "2026-08-14"
