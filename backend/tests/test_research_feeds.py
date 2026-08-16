"""Offline tests for research feeds: parse, map, math, fallbacks."""
from __future__ import annotations

import correlation
import etf_lookthrough
import ext_feeds
import inst_13f


def test_hk_kline_removed():
    out = ext_feeds.fetch_kline("00700")
    assert out.get("error")


def test_infer_market():
    assert ext_feeds.infer_market("AAPL") == "us"
    assert ext_feeds.infer_market("600519") == "a_share"
    assert ext_feeds.infer_market("600519.SH") == "a_share"
    assert ext_feeds.infer_market("00700.HK") == "hk"
    assert ext_feeds.infer_market("700") == "hk"
    assert ext_feeds.infer_market("BTC-USDT") == "crypto"
    assert ext_feeds.infer_market("BTCUSDT") == "crypto"
    assert ext_feeds.infer_market("005930.KS") == "kr"
    assert ext_feeds.infer_market("005930") == "a_share"  # bare 6-digit is A-share


def test_baostock_symbol():
    assert ext_feeds.baostock_symbol("600519") == "sh.600519"
    assert ext_feeds.baostock_symbol("600519.SH") == "sh.600519"
    assert ext_feeds.baostock_symbol("000001") == "sz.000001"
    assert ext_feeds.baostock_symbol("300750") == "sz.300750"
    assert ext_feeds.baostock_symbol("510300") == "sh.510300"
    assert ext_feeds.baostock_symbol("830001") is None


def test_pykrx_code():
    assert ext_feeds.pykrx_code("005930.KS") == "005930"
    assert ext_feeds.pykrx_code("005930") == "005930"
    assert ext_feeds.pykrx_code("AAPL") is None


def test_stooq_csv_parse(monkeypatch):
    csv_text = "Date,Open,High,Low,Close,Volume\n2026-01-02,1,2,0.5,1.5,10\n2026-01-03,1.5,2.5,1,2,20\n"

    class _R:
        text = csv_text

        def raise_for_status(self):
            return None

    monkeypatch.setattr(ext_feeds, "_get", lambda *a, **k: _R())
    ext_feeds._CACHE.clear()
    out = ext_feeds.stooq_kline("AAPL", num=20)
    assert out["source"] == "stooq"
    assert out["bars"][-1]["close"] == 2.0
    assert out["bars"][0]["volume"] == 10


def test_okx_binance_parse(monkeypatch):
    class _R:
        def __init__(self, payload):
            self._p = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._p

    okx = {"code": "0", "data": [["1700000000000", "1", "2", "0.5", "1.5", "9"]]}
    bnc = [[1700000000000, "1", "2", "0.5", "1.5", "9"]]

    def fake_get(url, params=None, headers=None, timeout=20):
        if "okx.com" in url:
            return _R(okx)
        return _R(bnc)

    monkeypatch.setattr(ext_feeds, "_get", fake_get)
    ext_feeds._CACHE.clear()
    o = ext_feeds.okx_kline("BTC-USDT", num=20)
    assert o["source"] == "okx"
    assert o["bars"][0]["close"] == 1.5
    b = ext_feeds.binance_kline("BTCUSDT", num=20)
    assert b["source"] == "binance"
    assert b["code"] == "BTCUSDT"


def test_pearson_and_matrix(monkeypatch):
    assert correlation.pearson([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]) == 1.0
    assert correlation.pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]) == -1.0
    assert correlation.pearson([1, 1, 1, 1, 1], [1, 2, 3, 4, 5]) is None

    def fake_fetch(symbol, num=180, source="auto", interval="1D"):
        bars = [
            {"date": f"2026-01-{i:02d}", "open": 100, "high": 100, "low": 100,
             "close": 100 + i, "volume": 1}
            for i in range(1, 40)
        ]
        return {"code": symbol, "name": symbol, "market": "US", "source": "t", "bars": bars}

    monkeypatch.setattr(correlation.ext_feeds, "fetch_kline", fake_fetch)
    out = correlation.correlation_matrix(["AAA", "BBB"], window=30)
    assert out["codes"] == ["AAA", "BBB"]
    assert out["matrix"][0][0] == 1.0
    assert out["matrix"][0][1] == 1.0


def test_cn_etf_parse_skips_starred():
    block = """
    title='沪深300ETF'
    截止至：<font>2025-12-31</font>
    2025年4季度报告</label>
    <tr><th>序号</th><th>股票代码</th><th>股票名称</th><th>占净值(%)</th><th>持股数(万股)</th><th>持仓市值(万元)</th></tr>
    <tr><td>1</td><td>600519</td><td>贵州茅台</td><td>4.00%</td><td>1.00</td><td>200.00</td></tr>
    <tr><td>2*</td><td>000001</td><td>平安银行</td><td>1.00%</td><td>2.00</td><td>10.00</td></tr>
    """
    period = etf_lookthrough.parse_cn_period(block)
    assert period is not None
    assert period["as_of"] == "2025-12-31"
    assert period["fund_report_holdings"] == 1
    assert period["cross_referenced_holdings"] == 1
    assert period["pct_of_net_assets_disclosed"] == 4.0
    assert period["holdings"][0]["shares"] == 10000.0
    etf_lookthrough.annotate_cn_period(period, {"2025-12-31": {"report": "2025年年度报告", "published": "2026-03-01"}})
    assert period["coverage"] == "top_n_disclosed"  # only 1 fund row, below quarterly cap


def test_cn_etf_archive_envelope():
    body = 'var apidata={content:"<div class=\'boxitem w770\'>' \
           "<tr><th>股票代码</th><th>占净值(%)</th></tr>" \
           "<tr><td>600519</td><td>3.2%</td></tr>" \
           '",arryear:[2026],curyear:2026};'
    periods = etf_lookthrough.parse_cn_archive(body)
    assert len(periods) == 1
    assert periods[0]["holdings"][0]["symbol"] == "600519"


def test_nport_uses_reppddate_not_reppend():
    xml = """<?xml version="1.0"?>
    <edgarSubmission>
      <formData>
        <genInfo>
          <seriesId>S000004151</seriesId>
          <seriesName>iShares Core S&amp;P 500 ETF</seriesName>
          <regName>iShares Trust</regName>
          <repPdDate>2025-09-30</repPdDate>
          <repPdEnd>2026-03-31</repPdEnd>
        </genInfo>
        <fundInfo><netAssets>1000</netAssets></fundInfo>
        <invstOrSecs>
          <invstOrSec>
            <name>APPLE INC</name>
            <cusip>037833100</cusip>
            <pctVal>7.1</pctVal>
            <valUSD>71</valUSD>
            <identifiers><ticker value="AAPL"/></identifiers>
          </invstOrSec>
        </invstOrSecs>
      </formData>
    </edgarSubmission>
    """
    parsed = etf_lookthrough.parse_nport(xml)
    assert parsed["as_of"] == "2025-09-30"
    assert parsed["fiscal_year_end"] == "2026-03-31"
    assert parsed["holdings"][0]["ticker"] == "AAPL"


def test_series_csv_ticker():
    text = "CIK Number,Entity Name,Series ID,Series Name,Class Ticker\n" \
           "0000036405,iShares Trust,S000004151,IVV,IVV\n"
    hit = etf_lookthrough.parse_series_csv(text, "ivv")
    assert hit["cik"] == "0000036405"
    assert hit["series_id"] == "S000004151"


def test_13f_parse_diff_units():
    xml = b"""<?xml version="1.0"?>
    <informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
      <infoTable>
        <nameOfIssuer>APPLE INC</nameOfIssuer>
        <titleOfClass>COM</titleOfClass>
        <cusip>037833100</cusip>
        <value>1000</value>
        <shrsOrPrnAmt><sshPrnamt>10</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
      </infoTable>
      <infoTable>
        <nameOfIssuer>MSFT</nameOfIssuer>
        <titleOfClass>COM</titleOfClass>
        <cusip>594918104</cusip>
        <value>500</value>
        <shrsOrPrnAmt><sshPrnamt>5</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
      </infoTable>
    </informationTable>
    """
    rows = inst_13f.parse_information_table(xml)
    assert len(rows) == 2
    assert rows[0]["cusip"] == "037833100"
    current = inst_13f.aggregate_positions(rows, 1)
    prior = [{"issuer": "APPLE INC", "cusip": "037833100", "put_call": None, "value_usd": 800, "shares": 8}]
    changes = inst_13f.diff_positions(current, prior)
    actions = {c["cusip"]: c["action"] for c in changes}
    assert actions["037833100"] == "increased"
    assert actions["594918104"] == "new"
    # fewer than 8 rows: filing date decides (2023-01-03 cut)
    mult, units = inst_13f.detect_value_units(rows, "2020-01-01")
    assert (mult, units) == (1000, "usd_thousands")
    assert inst_13f.detect_value_units(rows, "2024-06-01") == (1, "usd")
    fat = rows * 5  # 10 rows, implied 100 per share
    assert inst_13f.detect_value_units(fat, "2020-01-01") == (1, "usd")


def test_us_kline_empty_when_yahoo_empty(monkeypatch):
    import gstock

    monkeypatch.setattr(gstock, "resolve_symbol", lambda q: {
        "code": "AAPL", "name": "Apple", "market": "NASDAQ",
    })
    monkeypatch.setattr(gstock, "_us_kline_yahoo_qfq", lambda *a, **k: [])
    assert gstock.us_stock_kline("AAPL") == {}


def test_light_kline_falls_back_to_baostock(monkeypatch):
    import astock

    monkeypatch.setattr(astock, "resolve_symbol", lambda c: "sh600519")
    monkeypatch.setattr(astock, "_tencent_json", lambda url: {"data": {}})
    monkeypatch.setattr(
        "ext_feeds.baostock_kline",
        lambda code, n: {
            "name": "贵州茅台",
            "adjust": "qfq",
            "bars": [{"date": "2026-08-14", "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 8}],
        },
    )
    out = astock.light_kline("600519", "1D", num=20)
    assert out["source"] == "baostock"
    assert out["bars"][0]["close"] == 1.5


def test_available_sources_shape():
    src = ext_feeds.available_sources()
    for key in ("stooq", "okx", "binance", "baostock", "pykrx", "ccxt"):
        assert key in src
        assert "ok" in src[key]
