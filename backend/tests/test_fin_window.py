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
    main = fw.finance_main("600519")
    assert main["name"] == "测试股"
    assert len(main["reports"]) == 1
    assert main["industry"] == "白酒"
    assert any(c[1] == "WEB" for c in calls)


def test_classify_forecast():
    assert fw.classify_forecast("预增", "") == "预增"
    assert fw.classify_forecast("", "预计净利润预减约 20%") == "预减"
    assert fw.classify_forecast("", "无关键词") == "不确定"
    assert fw.forecast_bucket("预增") == "good"
    assert fw.forecast_bucket("首亏") == "bad"
    assert fw.forecast_bucket("续盈") == "neutral"
