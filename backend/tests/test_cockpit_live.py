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


def test_sanitize_future_codes():
    codes = cl._sanitize_future_codes("hf_GC,nf_AU0,BTCUSDT,../etc,hf_TOOLONGSYMBOLXXXX,hf_CL")
    assert codes == ["hf_GC", "nf_AU0", "BTCUSDT", "hf_CL"]
