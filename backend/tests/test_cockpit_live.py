"""Pure parse tests for cockpit_live (no network)."""
import cockpit_live as cl


def test_parse_tencent_a_share_index():
    f = [""] * 40
    f[1] = "上证指数"
    f[3] = "3089.12"
    f[4] = "3080.00"
    f[31] = "9.12"
    f[32] = "0.30"
    f[37] = "12345.6"
    line = f'v_sh000001="{"~".join(f)}"'
    q = cl.parse_tencent_quote_line(line)
    assert q is not None
    assert q["symbol"] == "sh000001"
    assert q["name"] == "上证指数"
    assert q["price"] == 3089.12
    assert q["pct"] == 0.30
    assert q["amount"] == 12345.6


def test_parse_tencent_forex():
    line = 'v_whUSDCNY="200~美元人民币~USDCNY~7.1800~0~0~7.17~0~7.19~7.16~0~0~0.0200~0.28"'
    q = cl.parse_tencent_quote_line(line)
    assert q is not None
    assert q["symbol"] == "whUSDCNY"
    assert abs(q["price"] - 7.18) < 1e-6
    assert q["pct"] == 0.28


def test_parse_sina_hf_and_nf():
    hf = 'hq_str_hf_GC="2345.6,0,0,0,2350,2330,10:01,2300.0,2310,0,0,0,2026-08-15,纽约黄金,0";'
    nf = 'hq_str_nf_AU0="沪金,0,780,790,770,785,784,786,780,0,0,0,0,0,0,0,2026-08-15";'
    h = cl.parse_sina_hf(hf)
    n = cl.parse_sina_nf(nf)
    assert h["hf_GC"]["price"] == 2345.6
    assert h["hf_GC"]["prev"] == 2300.0
    assert h["hf_GC"]["pct"] == cl._pct(2345.6, 2300.0)
    assert n["nf_AU0"]["name"] == "沪金"
    assert n["nf_AU0"]["price"] == 785


def test_normalize_board_code():
    assert cl.normalize_board_code("bk0474") == "BK0474"
    assert cl.normalize_board_code("BK0474") == "BK0474"
    assert cl.normalize_board_code("0474") == "BK0474"
    assert cl.normalize_board_code("bk474") == "BK0474"


def test_parse_qq_board_rank():
    rows = cl.parse_qq_board_rank([
        {
            "code": "sz002080",
            "name": "中材科技",
            "zxj": "59.93",
            "zdf": "7.48",
            "hsl": "3.61",
            "volume": "606524",
        },
        {"code": "bad", "zxj": "10", "zdf": "1"},
    ], 20)
    assert len(rows) == 1
    assert rows[0]["code"] == "002080"
    assert rows[0]["symbol"] == "sz002080"
    assert rows[0]["pct"] == 7.48
    assert abs(rows[0]["amount"] - 606524 * 100 * 59.93) < 1
    assert rows[0]["turnover"] == 3.61


def test_attach_em_flow(monkeypatch):
    monkeypatch.setattr(cl, "_em_ulist_flow", lambda codes: {"002080": (8.718e7, 2.4)})
    rows = [{"code": "002080", "name": "中材科技", "main_net": None, "main_pct": None}]
    cl._attach_em_flow(rows)
    assert rows[0]["main_net"] == 8.718e7
    assert rows[0]["main_pct"] == 2.4


def test_board_stocks_prefers_tencent_pt(monkeypatch):
    em_calls = []
    monkeypatch.setattr(cl, "_tencent_board_stocks", lambda raw, n: [{
        "code": "002080", "name": "中材科技", "price": 59.93, "pct": 7.48,
        "amount": 1e8, "turnover": 3.6,
    }])
    monkeypatch.setattr(cl, "_attach_em_flow", lambda rows: rows)
    monkeypatch.setattr(cl, "_em_board_stocks", lambda raw, n: em_calls.append(raw) or [])
    out = cl.board_stocks("pt01801712", 20)
    assert out[0]["code"] == "002080"
    assert em_calls == []


def test_board_stocks_falls_back_to_eastmoney(monkeypatch):
    monkeypatch.setattr(cl, "_tencent_board_stocks", lambda raw, n: [])
    monkeypatch.setattr(cl, "_em_board_stocks", lambda raw, n: [{"code": "600000", "name": "浦发", "price": 10, "pct": 1}])
    out = cl.board_stocks("BK0474", 12)
    assert out[0]["code"] == "600000"


def test_parse_jsonp():
    assert cl.parse_jsonp('var t=({"minLine_1d":[["09:31",1]]});') == {"minLine_1d": [["09:31", 1]]}


def test_board_fflow_kline_cached_hits_same_key(monkeypatch):
    from api_common import _DC_CACHE

    calls = []
    monkeypatch.setattr(cl, "_board_fflow_kline", lambda code: calls.append(code) or [{"t": "09:31", "v": 1.0}])
    _DC_CACHE.clear()
    a = cl._board_fflow_kline_cached("bk0474")
    b = cl._board_fflow_kline_cached("BK0474")
    assert a == b == [{"t": "09:31", "v": 1.0}]
    assert calls == ["BK0474"]


def test_board_flow_ranks_skip_kline(monkeypatch):
    from api_common import _DC_CACHE

    class R:
        def json(self):
            return {"data": {"diff": [{"f12": "BK0474", "f14": "银行", "f62": 1e8}]}}

    kl_calls = []
    monkeypatch.setattr(cl, "em_get", lambda *a, **k: R())
    monkeypatch.setattr(cl, "_board_fflow_kline", lambda code: kl_calls.append(code) or [{"t": "09:31", "v": 1}])
    _DC_CACHE.clear()
    out = cl.board_flow_intraday(6, curves=False)
    assert kl_calls == []
    assert out[0]["name"] == "银行"
    assert out[0]["code"] == "BK0474"
    assert out[0]["points"] == []


def test_board_flow_ranks_peek_cached_kline(monkeypatch):
    from api_common import _DC_CACHE

    class R:
        def json(self):
            return {"data": {"diff": [{"f12": "BK0474", "f14": "银行", "f62": 1e8}]}}

    kl_calls = []
    monkeypatch.setattr(cl, "em_get", lambda *a, **k: R())
    monkeypatch.setattr(cl, "_board_fflow_kline", lambda code: kl_calls.append(code) or [{"t": "09:31", "v": 1}])
    _DC_CACHE.clear()
    _DC_CACHE.set(("board_fflow_kline", "BK0474"), [{"t": "09:31", "v": 1.0}, {"t": "09:32", "v": 2.0}])
    out = cl.board_flow_intraday(6, curves=False)
    assert kl_calls == []
    assert len(out[0]["points"]) == 2


def test_sanitize_future_codes():
    codes = cl._sanitize_future_codes("hf_GC,nf_AU0,BTCUSDT,../etc,hf_TOOLONGSYMBOLXXXX,hf_CL")
    assert codes == ["hf_GC", "nf_AU0", "BTCUSDT", "hf_CL"]


def test_parse_sina_amount_rows_converts_wan_yuan():
    rows = cl.parse_sina_amount_rows([
        {
            "code": "600519",
            "name": "贵州茅台",
            "trade": "1400",
            "changepercent": "1.25",
            "amount": "8000000000",
            "mktcap": "21890000",
            "nmc": "21880000",
        },
        {"code": "bad", "trade": "10", "amount": "1"},
    ], 20)
    assert len(rows) == 1
    assert rows[0]["code"] == "600519"
    assert rows[0]["amount"] == 8000000000.0
    assert rows[0]["mcap"] == 21890000 * 10000
    assert rows[0]["float_cap"] == 21880000 * 10000
    assert set(rows[0]) == {"code", "name", "price", "pct", "amount", "mcap", "float_cap", "industry"}


def test_stock_rank_prefers_sina(monkeypatch):
    sina_calls = []
    em_calls = []
    monkeypatch.setattr(cl, "_sina_rank", lambda *a, **k: sina_calls.append(a) or [{"code": "600519", "pct": 1}])
    monkeypatch.setattr(cl, "_em_rank", lambda *a, **k: em_calls.append(a) or [{"code": "000001", "pct": 2}])
    out = cl.stock_rank("amount", 0, 10)
    assert out[0]["code"] == "600519"
    assert sina_calls
    assert em_calls == []


def test_stock_rank_falls_back_to_eastmoney(monkeypatch):
    monkeypatch.setattr(cl, "_sina_rank", lambda *a, **k: [])
    monkeypatch.setattr(cl, "_em_rank", lambda *a, **k: [{"code": "000001", "pct": 2}])
    out = cl.stock_rank("changepercent", 0, 10)
    assert out[0]["code"] == "000001"


def test_quotes_map_aliases_and_filters(monkeypatch):
    monkeypatch.setattr(cl, "_tencent_quotes", lambda codes: {
        "sh600519": {
            "symbol": "sh600519", "name": "贵州茅台", "price": 1400.0,
            "pct": 1.2, "change": 16.0, "prev": 1384.0, "amount": 12.5, "turnover": 0.31,
        },
        "usIXIC": {
            "symbol": "usIXIC", "name": "纳斯达克", "price": 21000.0,
            "pct": 0.4, "change": 80.0, "prev": 20920.0, "amount": 0, "turnover": 0,
        },
    })
    out = cl.quotes_map(["600519", "sh600519", "usIXIC", "bad!!", "600519"])
    assert out["600519"]["price"] == 1400.0
    assert out["sh600519"]["price"] == 1400.0
    assert out["600519"]["amount"] == 12.5 * 10000
    assert out["usIXIC"]["name"] == "纳斯达克"
    assert out["usIXIC"]["amount"] == 0
    assert "bad!!" not in out


def test_quotes_map_skips_empty_price(monkeypatch):
    monkeypatch.setattr(cl, "_tencent_quotes", lambda codes: {
        "sz000001": {"symbol": "sz000001", "name": "平安银行", "price": 0, "pct": 0},
    })
    assert cl.quotes_map(["000001"]) == {}


def test_turnover_top_prefers_sina(monkeypatch):
    import astock
    import market

    market._CACHE.clear()
    em_calls = []
    monkeypatch.setattr(cl, "sina_amount_rank", lambda n: [{
        "code": "600519", "name": "茅台", "price": 1400.0, "pct": 1.2,
        "amount": 1e9, "mcap": 2e12, "float_cap": 2e12, "industry": "",
    }])
    monkeypatch.setattr(astock, "market_turnover_rank", lambda n: em_calls.append(n) or [])
    out = market.get_turnover_top()
    assert out["stocks"][0]["code"] == "600519"
    assert em_calls == []
