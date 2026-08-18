"""Sunsirs / lives / future-daily / stock-boards parsers (no network)."""
import cockpit_live as cl
import lives_feed
import sunsirs


SF_HTML = """
<td colspan="8">上海期货交易所</td>
<tr bgcolor="#fafdff">
  <td>沪金</td><td>780.5</td><td>au2508</td><td>785.0</td>
  <td><table><tr><td><font>4.5</font></td><td><font>0.58%</font></td></tr></table></td>
</tr>
"""

CHEM_HTML = """
<tr class="x"><td class="p-name">碳酸亚乙烯酯</td><td>市场价</td><td>12000 元/吨</td></tr>
<tr class="x"><td class="p-name">碳酸亚乙烯酯</td><td>出厂价</td><td>15000 元/吨</td></tr>
<div>2026-08-15</div>
"""


def test_parse_sf_table():
    rows = sunsirs.parse_sf_table(SF_HTML)
    assert len(rows) == 1
    assert rows[0]["exchange"] == "上海期货交易所"
    assert rows[0]["name"] == "沪金"
    assert rows[0]["spot"] == 780.5
    assert rows[0]["futures"] == 785.0
    assert rows[0]["basis"] == 4.5
    assert abs(rows[0]["basis_pct"] - 0.58) < 1e-9


def test_parse_chem_median_prefers_market():
    market, all_p, date = sunsirs.parse_chem_quotes(CHEM_HTML)
    assert market == [12000.0]
    assert all_p == [12000.0, 15000.0]
    assert date == "2026-08-15"
    assert sunsirs._median(market) == 12000.0


def test_chem_id_rejects_non_digits():
    try:
        sunsirs.chem_spot("../x", "a")
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_parse_sina_and_wscn_items():
    sina = lives_feed.parse_sina_item({
        "id": 1, "rich_text": "【标题】正文", "create_time": "2026-08-15 10:00:00",
    })
    assert sina["title"] == "标题"
    assert sina["content"] == "正文"
    wscn = lives_feed.parse_wscn_items({
        "data": {"items": [
            {"id": 9, "title": "T", "content_text": "<p>hi</p>", "display_time": 1},
        ]},
    }, 10)
    assert wscn[0]["content"] == "hi"
    assert wscn[0]["title"] == "T"
    flash = lives_feed.parse_jin10_js(
        'var newest = ['
        '{"id":"1","time":"2026-08-18 19:02:33","type":0,"channel":[1,3],"important":1,'
        '"data":{"title":"","content":"<b>【株冶集团】上半年净利润增232%</b>"}},'
        '{"id":"2","time":"2026-08-18 19:00:00","type":1,'
        '"data":{"content":"广告"}},'
        '{"id":"3","time":"2026-08-18 18:38:33","type":0,"channel":[5],'
        '"data":{"title":"","content":"Xiaomi Group to hold earnings call."}},'
        '{"id":"4","time":"2026-08-18 18:20:00","type":0,"channel":[1],'
        '"data":{"content":"美债收益率持续走高？点击进入直播间>"}}'
        '];',
        40,
    )
    assert [x["id"] for x in flash] == ["1", "3"]
    assert flash[0]["title"] == "株冶集团"
    assert flash[0]["tags"] == ["重要", "股票"]
    assert flash[1]["title"] == "Xiaomi Group to hold earnings call."
    assert flash[1]["tags"] == ["英文"]
    assert lives_feed.jin10_tags({"channel": [1, 2, 3], "important": 0}) == ["宏观"]
    assert lives_feed.jin10_tags({"channel": [1, 3], "important": 0}) == ["股票"]
    assert lives_feed.jin10_tags({"channel": [1, 4], "important": 1}) == ["重要", "预告"]
    assert lives_feed.jin10_tags({"channel": [1], "important": 0}) == []


def test_future_daily_parses_jsonp(monkeypatch):
    monkeypatch.setattr(cl, "_fetch_text", lambda *a, **k: 'var t=([{"d":"2026-08-14","o":1,"h":2,"l":0.5,"c":1.5,"v":9}])')
    out = cl.future_daily("nf_AU0", 20)
    assert out["source"] == "sina"
    assert out["points"][0]["c"] == 1.5
    assert out["points"][0]["t"] == "2026-08-14"


def test_stock_basic_info_area_concepts(monkeypatch):
    import astock_boards

    class R:
        def json(self):
            return {"data": {
                "f57": "600519", "f58": "贵州茅台", "f127": "白酒", "f128": "贵州",
                "f129": "消费,茅台", "f84": 1, "f85": 1, "f116": 1, "f117": 1,
                "f162": 1805, "f167": 641, "f173": 20.0, "f189": 20010827,
            }}

    monkeypatch.setattr(astock_boards, "em_get", lambda *a, **k: R())
    out = astock_boards.stock_basic_info("600519")
    assert out["industry"] == "白酒"
    assert out["area"] == "贵州"
    assert out["concepts"] == ["消费", "茅台"]
    assert out["list_date"] == "2001-08-27"
    assert out["pe_ttm"] == 18.05


def test_stock_boards_parses(monkeypatch):
    class R:
        def json(self):
            return {"data": {"f57": "600519", "f58": "贵州茅台", "f127": "白酒", "f128": "贵州", "f129": "消费,茅台"}}

    monkeypatch.setattr(cl, "em_get", lambda *a, **k: R())
    out = cl.stock_boards("600519")
    assert out["industry"] == "白酒"
    assert out["area"] == "贵州"
    assert out["concepts"] == ["消费", "茅台"]
    assert out["code"] == "sh600519"
