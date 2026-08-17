"""Pure tests for fin_window period / code / forecast helpers."""
from datetime import date

import fin_window as fw


def test_default_report_period():
    assert fw.default_report_period(date(2026, 2, 1)) == "2025-09-30"
    assert fw.default_report_period(date(2026, 5, 1)) == "2026-03-31"
    assert fw.default_report_period(date(2026, 8, 15)) == "2026-06-30"
    assert fw.default_report_period(date(2026, 11, 1)) == "2026-09-30"


def test_prev_and_valid_period():
    assert fw.prev_report_period("2026-06-30") == "2026-03-31"
    assert fw.prev_report_period("2026-03-31") == "2025-12-31"
    assert fw.valid_period("2025-12-31") == "2025-12-31"
    assert fw.valid_period("bad") == fw.default_report_period()


def test_secu_and_bare():
    assert fw.secu_code("sh600519") == "600519.SH"
    assert fw.secu_code("600519") == "600519.SH"
    assert fw.secu_code("000001") == "000001.SZ"
    assert fw.secu_code("830001") == "830001.BJ"
    assert fw.bare_code("sh600519") == "600519"
    assert fw.secu_code("AAPL") is None


def test_finance_main_falls_back_to_dc(monkeypatch):
    calls: list[tuple] = []

    def fake_dc_rows(report, filt, n, sort, source="WEB", url=None):
        calls.append((report, source, url))
        if source == "HSF10":
            return []
        if report == "RPT_F10_FINANCE_MAINFINADATA":
            return [{
                "REPORT_DATE_NAME": "2026一季报",
                "REPORT_DATE": "2026-03-31",
                "TOTALOPERATEREVE": 100.0,
                "PARENTNETPROFIT": 20.0,
                "TOTALOPERATEREVETZ": 10.0,
                "PARENTNETPROFITTZ": 8.0,
                "ROEJQ": 12.0,
                "XSMLL": 40.0,
                "XSJLL": 20.0,
                "ZCFZL": 30.0,
                "EPSJB": 1.2,
                "MGJYXJJE": 2.0,
                "SECURITY_NAME_ABBR": "测试股",
            }]
        return [{"BOARD_NAME_2LEVEL": "白酒"}]

    monkeypatch.setattr(fw, "_dc_rows", fake_dc_rows)
    monkeypatch.setattr(fw, "_emweb_extras", lambda *a, **k: {"mainop": [], "mainop_history": [], "balance": {}, "cash": {}})
    main = fw.finance_main("600519")
    assert main["name"] == "测试股"
    assert len(main["reports"]) == 1
    assert main["industry"] == "白酒"
    assert any(c[1] == "WEB" for c in calls)


def test_finance_board_skips_live_tape():
    import inspect

    src = inspect.getsource(fw.finance_board)
    assert "industry_comparison" not in src
    assert "ThreadPoolExecutor" in src
    assert "_http_get" in inspect.getsource(fw._dc_result)


def test_company_bundle_skips_valuation_stack(monkeypatch):
    monkeypatch.setattr(
        fw,
        "finance_main",
        lambda code: {"code": code, "name": "茅台", "industry": "白酒", "reports": []},
    )
    out = fw.company_bundle("600519")
    assert out["valuation"] is None
    assert out["announcements"] == []
    assert out["reports"] == []
    assert out["main"]["name"] == "茅台"


def test_parse_tencent_hint_pinyin_and_filters():
    gzmt = r'v_hint="sh~600519~\u8d35\u5dde\u8305\u53f0~gzmt~GP-A"'
    assert fw.parse_tencent_hint(gzmt) == [{"code": "600519", "name": "贵州茅台"}]

    mixed = (
        r'v_hint="sz~000001~\u5e73\u5b89\u94f6\u884c~payh~GP-A'
        r'^us~payh.am~foo~bp~GP^jj~021574~\u5e73\u5b89\u5143~payh~KJ"'
    )
    assert fw.parse_tencent_hint(mixed) == [{"code": "000001", "name": "平安银行"}]

    idx_and_stock = (
        r'v_hint="sh~000001~\u4e0a\u8bc1\u6307\u6570~szzs~ZS'
        r'^sz~000001~\u5e73\u5b89\u94f6\u884c~payh~GP-A"'
    )
    assert fw.parse_tencent_hint(idx_and_stock) == [{"code": "000001", "name": "平安银行"}]

    etf = r'v_hint="sh~510300~\u6caa\u6df1300ETF~hs300etf~ETF"'
    assert fw.parse_tencent_hint(etf) == [{"code": "510300", "name": "沪深300ETF"}]
    assert fw.parse_tencent_hint('v_hint="N"') == []
    assert fw.parse_tencent_hint("") == []


def test_suggest_ashare_uses_tencent_then_eastmoney(monkeypatch):
    class R:
        def __init__(self, text="", payload=None):
            self.text = text
            self._payload = payload

        def json(self):
            if self._payload is None:
                raise ValueError("not json")
            return self._payload

    calls: list[str] = []

    def fake_get(url, params=None, **_k):
        calls.append(url)
        if "smartbox" in url:
            return R(r'v_hint="sh~600519~\u8d35\u5dde\u8305\u53f0~gzmt~GP-A"')
        raise AssertionError("eastmoney should not run when tencent hits")

    monkeypatch.setattr(fw, "_http_get", fake_get)
    assert fw.suggest_ashare("gzmt") == [{"code": "600519", "name": "贵州茅台"}]
    assert calls == ["https://smartbox.gtimg.cn/s3/"]

    def tencent_empty(url, params=None, **_k):
        if "smartbox" in url:
            return R('v_hint="N"')
        return R(payload={"QuotationCodeTable": {"Data": [{"Code": "000858", "Name": "五粮液", "MktNum": "0"}]}})

    monkeypatch.setattr(fw, "_http_get", tencent_empty)
    assert fw.suggest_ashare("wly") == [{"code": "000858", "name": "五粮液"}]
    assert fw.suggest_ashare("  ") == []


def test_classify_forecast():
    assert fw.classify_forecast("预增", "") == "预增"
    assert fw.classify_forecast("", "预计净利润预减约 20%") == "预减"
    assert fw.classify_forecast("", "无关键词") == "不确定"
    assert fw.forecast_bucket("预增") == "good"
    assert fw.forecast_bucket("首亏") == "bad"
    assert fw.forecast_bucket("续盈") == "neutral"
