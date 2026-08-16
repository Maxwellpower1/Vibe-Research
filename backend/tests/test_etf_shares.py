"""ETF share parsers (no network)."""
import etf_shares


GMBD = """
var gmbd_apidata={ content:"<table><thead><tr><th>日期</th><th>期间申购（亿份）</th>
<th>期间赎回（亿份）</th><th>期末总份额（亿份）</th><th>期末净资产（亿元）</th>
<th>净资产变动率</th></tr></thead>
<tr><td>2026-06-30</td><td>61.27</td><td>320.41</td><td>189.15</td><td>948.72</td><td>-52.54%</td></tr>
<tr><td>2025-12-31</td><td>91.18</td><td>100.04</td><td>888.30</td><td>4,222.58</td><td>-0.78%</td></tr>
</table>"};
"""

SSE = {
    "result": [
        {"STAT_DATE": "2026-08-14", "SEC_CODE": "510010", "SEC_NAME": "治理ETF", "TOT_VOL": "13052.44"},
        {"STAT_DATE": "2026-08-14", "SEC_CODE": "510300", "SEC_NAME": "300ETF", "TOT_VOL": "2350128.77"},
    ]
}


def test_parse_gmbd_net_and_comma():
    rows = etf_shares.parse_gmbd(GMBD)
    assert len(rows) == 2
    assert rows[0]["date"] == "2026-06-30"
    assert rows[0]["subscribe_yi"] == 61.27
    assert rows[0]["redeem_yi"] == 320.41
    assert abs(rows[0]["net_yi"] - (61.27 - 320.41)) < 1e-9
    assert rows[1]["shares_yi"] == 888.30
    assert rows[1]["nav_yi"] == 4222.58


def test_parse_sse_day_wan_to_yi():
    row = etf_shares.parse_sse_day(SSE, "510300")
    assert row is not None
    assert row["name"] == "300ETF"
    assert row["date"] == "2026-08-14"
    assert abs(row["shares_wan"] - 2350128.77) < 1e-6
    assert abs(row["shares_yi"] - 235.0129) < 1e-3
    assert etf_shares.parse_sse_day(SSE, "159919") is None


def test_parse_sse_day_map_two_codes():
    payload = {
        "result": SSE["result"] + [
            {"STAT_DATE": "2026-08-14", "SEC_CODE": "588000", "SEC_NAME": "科创50", "TOT_VOL": "980123.45"},
        ]
    }
    mapped = etf_shares.parse_sse_day_map(payload, {"510300", "588000"})
    assert abs(mapped["510300"]["shares_yi"] - 235.0129) < 1e-3
    assert abs(mapped["588000"]["shares_yi"] - 98.0123) < 1e-3
    assert mapped["588000"]["name"] == "科创50"


def test_parse_szse_records_fen_to_yi():
    parsed = etf_shares.parse_szse_records([
        {"date": "2026-08-14", "code": "159915", "name": "创业板ETF易方达", "shares_fen": 1.746045e10},
        {"date": "2026-08-14", "code": "159919", "name": "沪深300ETF嘉实", "shares_fen": 6.227317e9},
        {"date": "2026-08-14", "code": "158006", "name": "化工ETF博时", "shares_fen": 39046012.0},
    ], {"159915", "159919"})
    assert abs(parsed["159915"]["2026-08-14"]["shares_yi"] - 174.6045) < 1e-3
    assert abs(parsed["159919"]["2026-08-14"]["shares_yi"] - 62.2732) < 1e-3
    assert "158006" not in parsed


def test_exchange_of():
    assert etf_shares.exchange_of("510050") == "sse"
    assert etf_shares.exchange_of("510300") == "sse"
    assert etf_shares.exchange_of("510500") == "sse"
    assert etf_shares.exchange_of("588000") == "sse"
    assert etf_shares.exchange_of("159915") == "szse"
    assert etf_shares.exchange_of("159919") == "szse"
