"""easy-tdx five-level book: parse + hub miss-fill. No live TDX."""
from __future__ import annotations

import inspect

import astock
import cockpit_live as cl
import review_jobs
import tdx_quote
from routers import ashare


def _row(**extra) -> dict:
    base = {
        "code": "000001",
        "price": 11.2,
        "pre_close": 11.0,
        "open": 11.1,
        "high": 11.3,
        "low": 11.0,
        "vol": 1000,
        "amount": 1.2e8,
        "bid1": 11.19,
        "bid_vol1": 200,
        "ask1": 11.21,
        "ask_vol1": 150,
        "server_time": "09:30:01",
        "name": "平安银行",
    }
    base.update(extra)
    return base


class _FakeMarket:
    SH = 1
    SZ = 0
    BJ = 2

    def __getitem__(self, key: str) -> int:
        return getattr(self, key)


class _FakeExMarket:
    HK_MAIN_BOARD = 31
    US_STOCK = 74
    COMEX_FUTURES = 16
    NYMEX_FUTURES = 17

    def __getitem__(self, key: str) -> int:
        return getattr(self, key)


class _FakeExClient:
    def __init__(self, rows, ticks=None):
        self.rows = rows
        self.ticks = ticks or {}
        self.pairs = None
        self.fields = None
        self.tick_calls: list[tuple] = []

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def goods_quotes(self, pairs, fields=None):
        self.pairs = pairs
        self.fields = fields
        return self.rows

    def goods_tick_chart(self, market, code, query_date=None):
        self.tick_calls.append((market, code, query_date))
        return self.ticks.get(code, [])


class _FakeClient:
    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def get_security_quotes(self, _pairs):
        return self.rows


def test_pair_only_ashare():
    assert tdx_quote._pair("000001") == ("SZ", "000001", "sz000001")
    assert tdx_quote._pair("sh600519") == ("SH", "600519", "sh600519")
    assert tdx_quote._pair("AAPL") is None
    assert tdx_quote._pair("00700") is None


def test_pair_ex_hk_us_skips_catalog():
    assert tdx_quote._pair_ex("00700") == ("HK_MAIN_BOARD", "00700", "hk00700")
    assert tdx_quote._pair_ex("hk00700") == ("HK_MAIN_BOARD", "00700", "hk00700")
    assert tdx_quote._pair_ex("AAPL") == ("US_STOCK", "AAPL", "usAAPL")
    assert tdx_quote._pair_ex("usAAPL") == ("US_STOCK", "AAPL", "usAAPL")
    assert tdx_quote._pair_ex("usIXIC") is None
    assert tdx_quote._pair_ex("hkHSI") is None
    assert tdx_quote._pair_ex("000001") is None
    assert tdx_quote.can_fill("00700")
    assert tdx_quote.can_fill("AAPL")
    assert not tdx_quote.can_fill("usIXIC")


def test_item_levels_and_suspend():
    item = tdx_quote._item(_row(trading_status=0x8020, bid2=11.18, bid_vol2=80), "sz000001")
    assert item["price"] == 11.2
    assert item["prev"] == 11.0
    assert item["bid"] == 11.19
    assert item["ask"] == 11.21
    assert item["bids"][1]["px"] == 11.18
    assert item["suspended"] is True
    assert item["source"] == "tdx"


def test_rows_from_dataframe_like():
    class Frame:
        def to_dict(self, orient):
            assert orient == "records"
            return [_row()]

    out = tdx_quote._rows(Frame())
    assert out[0]["price"] == 11.2


def test_fetch_quotes_maps_catalog(monkeypatch):
    monkeypatch.setattr(tdx_quote, "_client", lambda: (_FakeClient([_row()]), _FakeMarket()))
    out = tdx_quote.fetch_quotes(["000001"])
    assert out["sz000001"]["price"] == 11.2
    assert out["000001"]["price"] == 11.2
    assert out["sz000001"]["bids"][0]["vol"] == 200


def test_hub_skips_missing_package(monkeypatch):
    def boom():
        raise astock.DependencyMissing("easy-tdx 未安装: pip install easy-tdx")

    monkeypatch.setattr(tdx_quote, "_client", boom)
    assert tdx_quote.quotes_for_hub(["000001"]) == {}


def test_quotes_map_tdx_fills_ashare_miss(monkeypatch):
    monkeypatch.setattr(cl, "_tencent_quotes", lambda _c: {})
    monkeypatch.setattr(tdx_quote, "quotes_for_hub", lambda _c: {
        "sz000001": {
            "symbol": "sz000001", "name": "平安银行", "price": 11.2,
            "prev": 11.0, "amount": 1.2e8, "bid": 11.19, "ask": 11.21,
            "bid_vol": 200, "ask_vol": 150, "volume": 1000,
        },
    })
    out = cl.quotes_map(["000001"])
    assert out["sz000001"]["price"] == 11.2
    assert out["000001"]["amount"] == 1.2e8
    assert out["000001"]["bid"] == 11.19


def test_fetch_ex_quotes_maps_catalog(monkeypatch):
    rows = [{
        "code": "00700", "name": "腾讯控股", "close": 535.0, "pre_close": 531.0,
        "open": 532.0, "high": 537.0, "low": 530.5, "vol": 13456000, "amount": 7.1e9,
        "bid_price": 534.5, "bid_volume": 200, "ask_price": 535.0, "ask_volume": 180,
        "bid2_price": 534.0, "bid2_volume": 400,
    }]
    fake = _FakeExClient(rows)
    monkeypatch.setattr(tdx_quote, "_ex_client", lambda: (fake, _FakeExMarket()))
    monkeypatch.setattr(tdx_quote, "_ex_fields", lambda: None)
    out = tdx_quote.fetch_ex_quotes(["00700"])
    assert out["hk00700"]["price"] == 535.0
    assert out["00700"]["source"] == "tdx-ex"
    assert out["hk00700"]["bids"][0]["px"] == 534.5
    assert out["hk00700"]["bids"][1]["px"] == 534.0
    assert fake.pairs == [(31, "00700")]


def test_quotes_map_tdx_fills_hk_miss(monkeypatch):
    monkeypatch.setattr(cl, "_tencent_quotes", lambda _c: {})
    monkeypatch.setattr(tdx_quote, "quotes_for_hub", lambda _c: {
        "hk00700": {
            "symbol": "hk00700", "name": "腾讯控股", "price": 535.0,
            "prev": 531.0, "amount": 7.1e9, "bid": 534.5, "ask": 535.0,
        },
    })
    out = cl.quotes_map(["hk00700"])
    assert out["hk00700"]["price"] == 535.0
    assert out["00700"]["amount"] == 7.1e9


def test_quotes_map_tdx_skips_us_index(monkeypatch):
    called: list = []
    monkeypatch.setattr(cl, "_tencent_quotes", lambda _c: {})
    monkeypatch.setattr(cl, "_vix_from_sina", lambda: {})
    monkeypatch.setattr(tdx_quote, "quotes_for_hub", lambda codes: called.append(codes) or {})
    cl.quotes_map(["usIXIC", "hkHSI"])
    assert called == []


def test_quotes_map_tdx_skipped_when_tencent_has_price(monkeypatch):
    called: list = []
    monkeypatch.setattr(cl, "_tencent_quotes", lambda _c: {
        "sz000001": {
            "symbol": "sz000001", "name": "平安银行", "price": 11.0,
            "prev": 10.8, "amount": 1.0, "turnover": 0.2,
        },
    })
    monkeypatch.setattr(tdx_quote, "quotes_for_hub", lambda codes: called.append(codes) or {})
    cl.quotes_map(["000001"])
    assert called == []


def test_click_path_skips_host_scan():
    assert "from_best_host" not in inspect.getsource(tdx_quote._client)
    assert "from_best_host" not in inspect.getsource(tdx_quote._ex_client)
    assert "from_best_host" in inspect.getsource(tdx_quote._client_scan)
    assert "from_best_host" in inspect.getsource(tdx_quote._ex_client_scan)


def test_http_key_not_warmup():
    src = inspect.getsource(ashare)
    assert '"tdx_quote"' in src
    assert "/api/astock/tdx-quote" in src
    for blob in (
        inspect.getsource(review_jobs.warm_dc_jobs),
        inspect.getsource(review_jobs.live_jobs),
        inspect.getsource(review_jobs.money_jobs),
    ):
        assert "tdx_quote" not in blob


def test_tool_registered():
    import tools

    assert "query_tdx_quote" in tools.TOOL_NAMES
    assert "query_tdx_quote" in tools._HANDLERS


def test_ex_minute_mapping():
    assert tdx_quote._pair_ex_min("hf_XAU") == ("COMEX_FUTURES", "GC00W", "hf_XAU")
    assert tdx_quote._pair_ex_min("hf_SI") == ("COMEX_FUTURES", "SI00W", "hf_SI")
    assert tdx_quote._pair_ex_min("hf_CL") == ("NYMEX_FUTURES", "CL00W", "hf_CL")
    assert tdx_quote._pair_ex_min("hf_BTC") is None
    assert tdx_quote._pair_ex_min("hf_CAD") is None
    assert tdx_quote.can_ex_minute("hf_XAU")
    assert not tdx_quote.can_ex_minute("hf_NQ")


def test_hm_from_time_and_string():
    from datetime import time

    assert tdx_quote._hm(time(6, 1, 0)) == "06:01"
    assert tdx_quote._hm("06:02:00") == "06:02"
    assert tdx_quote._hm("1900-01-01 07:03:00") == "07:03"
    assert tdx_quote._hm(None) == ""


def test_fetch_ex_minutes_maps_catalog(monkeypatch):
    ticks = {
        "GC00W": [{
            "code": "GC00W",
            "name": "COMEX黄金主连",
            "pre_close": 4539.9,
            "charts": [
                {"time": "06:00:00", "price": 4522.4, "vol": 35},
                {"time": "06:01:00", "price": 4521.2, "vol": 135},
            ],
        }],
        "CL00W": [{
            "code": "CL00W",
            "pre_close": 70.1,
            "charts": [{"time": "06:00:00", "price": 70.5, "vol": 8}],
        }],
    }
    fake = _FakeExClient([], ticks=ticks)
    monkeypatch.setattr(tdx_quote, "_ex_client", lambda: (fake, _FakeExMarket()))
    out = tdx_quote.fetch_ex_minutes(["hf_XAU", "hf_CL", "hf_BTC"])
    assert out["hf_XAU"]["source"] == "tdx"
    assert out["hf_XAU"]["prec"] == 4539.9
    assert out["hf_XAU"]["points"][0] == {"t": "06:00", "p": 4522.4, "v": 35}
    assert out["hf_CL"]["points"][0]["p"] == 70.5
    assert "hf_BTC" not in out
    assert fake.tick_calls[0][:2] == (16, "GC00W")
    assert fake.tick_calls[1][:2] == (17, "CL00W")


def test_minutes_for_hub_skips_missing_package(monkeypatch):
    def boom():
        raise astock.DependencyMissing("easy-tdx 未安装: pip install easy-tdx")

    monkeypatch.setattr(tdx_quote, "_ex_client", boom)
    assert tdx_quote.minutes_for_hub(["hf_XAU"]) == {}


def test_http_minutes_not_new_key():
    src = inspect.getsource(review_jobs.warm_minutes)
    assert "commodity_minutes" in src
    assert "tdx_minute" not in src
    assert "tdx_quote" not in src
