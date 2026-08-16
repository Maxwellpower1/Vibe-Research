"""US kline fallbacks (no live Yahoo)."""
import gstock


def test_yahoo_chart_tries_query2(monkeypatch):
    calls = []

    class FakeResp:
        def __init__(self, host):
            self._host = host

        def raise_for_status(self):
            if "query1" in self._host:
                raise RuntimeError("403")

        def json(self):
            return {
                "chart": {
                    "result": [{
                        "timestamp": [1],
                        "meta": {"shortName": "Apple"},
                        "indicators": {
                            "quote": [{"open": [1], "high": [2], "low": [0.5], "close": [1.5], "volume": [9]}],
                            "adjclose": [{"adjclose": [1.5]}],
                        },
                    }]
                }
            }

    def fake_get(url, params=None, headers=None, timeout=20):
        calls.append(url)
        return FakeResp(url)

    import requests as req_mod

    monkeypatch.setattr(req_mod, "get", fake_get)
    bars, name = gstock._yahoo_chart_bars("AAPL", 20)
    assert any("query1" in u for u in calls)
    assert any("query2" in u for u in calls)
    assert bars[0]["close"] == 1.5
    assert name == "Apple"
