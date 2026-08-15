"""HK / US kline fallbacks (no live Yahoo)."""
import gstock


def test_hk_kline_falls_back_to_tencent(monkeypatch):
    monkeypatch.setattr(gstock, "resolve_symbol", lambda q: {
        "code": "00700", "name": "腾讯控股", "market": "HK", "secucode": "00700.HK",
    })

    def boom(*_a, **_k):
        raise RuntimeError("403")

    monkeypatch.setattr(gstock, "_yahoo_chart_bars", boom)
    monkeypatch.setattr(
        gstock,
        "_hk_kline_tencent",
        lambda code, n: (
            [{"date": "2026-08-14", "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 10}],
            "TENCENT",
        ),
    )
    out = gstock.hk_stock_kline("00700")
    assert out["source"] == "tencent"
    assert out["adjust"] == "qfq"
    assert out["bars"][0]["close"] == 1.5


def test_hk_kline_tencent_parses(monkeypatch):
    monkeypatch.setattr(gstock.astock, "_tencent_json", lambda url: {
        "data": {
            "hk00700": {
                "qfqday": [["2026-08-14", "1", "1.5", "2", "0.5", "10"]],
                "qt": {"hk00700": ["x", "腾讯控股"]},
            }
        }
    })
    bars, name = gstock._hk_kline_tencent("00700", 20)
    assert name == "腾讯控股"
    assert bars[0]["close"] == 1.5
    assert bars[0]["high"] == 2.0


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
