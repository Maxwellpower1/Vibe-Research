"""fear_greed board: one gauge list, no mock scores, shared cache key."""
import inspect

import fear_greed
import review_context as rc
import review_jobs


def test_gauge_keys_are_the_only_list():
    assert fear_greed.GAUGE_KEYS == (
        "crypto", "us", "jp", "hk", "gold", "oil",
    )
    assert [g["key"] for g in fear_greed.GAUGES] == list(fear_greed.GAUGE_KEYS)


def test_score_label_and_vix_invert():
    assert fear_greed.score_label(10) == "极度恐惧"
    assert fear_greed.score_label(40) == "恐惧"
    assert fear_greed.score_label(50) == "中性"
    assert fear_greed.score_label(70) == "贪婪"
    assert fear_greed.score_label(90) == "极度贪婪"
    assert fear_greed.vix_to_score(10, 10, 40) == 100
    assert fear_greed.vix_to_score(40, 10, 40) == 0
    assert fear_greed.vix_to_score(25, 10, 40) == 50


def test_parse_crypto_and_cnn_and_reject_mock():
    score, ts, src = fear_greed.parse_crypto({
        "data": [{"value": "32", "timestamp": "1710000000"}],
    })
    assert score == 32
    assert src == "alternative.me"
    assert ts and ts.startswith("2024")

    score, _ts, detail, src = fear_greed.parse_us({
        "fear_and_greed": {"score": 56.3, "previous_close": 54.4, "timestamp": "2026-08-19T23:00:16+00:00"},
    })
    assert score == 56
    assert src == "cnn"
    assert detail == "昨收 54.4"

    score, _ts, detail, src = fear_greed.parse_us({
        "score": 56, "previous": {"close": 54.4}, "source": "cnn-via-github",
    })
    assert score == 56
    assert "54.4" in (detail or "")

    try:
        fear_greed.parse_us({"score": 76, "source": "mock"})
        assert False, "mock us should raise"
    except ValueError:
        pass
    try:
        fear_greed.parse_vix({"value": 17.2, "score": 76, "source": "mock"}, fear_greed.GAUGES[2])
        assert False, "mock vix should raise"
    except ValueError:
        pass


def test_board_keeps_order_and_drops_failed():
    payloads = {
        fear_greed.ALT_FNG: {"data": [{"value": 40, "timestamp": "1710000000"}]},
        fear_greed.CNN_GRAPH: {"fear_and_greed": {"score": 56, "timestamp": "t"}},
        fear_greed.GF_VIX.format(region="jp"): {"value": 33.97, "source": "yahoo-rv"},
        fear_greed.GF_VIX.format(region="hk"): {"value": 18.7, "source": "yahoo"},
        fear_greed.GF_VIX.format(region="gold"): {"value": 26.68, "source": "yahoo"},
        fear_greed.GF_VIX.format(region="oil"): {"value": 47.69, "source": "yahoo"},
    }

    def fetch(url: str) -> dict:
        if url not in payloads:
            raise RuntimeError(url)
        return payloads[url]

    out = fear_greed.board(fetch=fetch)
    assert fear_greed.board_ok(out)
    keys = [it["key"] for it in out["items"]]
    assert keys == list(fear_greed.GAUGE_KEYS)
    by = {it["key"]: it for it in out["items"]}
    assert by["crypto"]["score"] == 40
    assert by["us"]["score"] == 56
    assert by["jp"]["score"] == fear_greed.vix_to_score(33.97, 10, 40)
    assert by["hk"]["detail"] and "18.70" in by["hk"]["detail"]


def test_http_and_live_jobs_share_fear_greed_key():
    from routers.market_routes import market_fear_greed

    live = inspect.getsource(review_jobs.live_jobs)
    assert '"fear_greed"' in live
    assert '"fear_greed", "board", 300' in live
    route = inspect.getsource(market_fear_greed)
    assert '_cached("fear_greed", "board", 300' in route
    warm = inspect.getsource(review_jobs.warm_dc_jobs)
    assert "fear_greed" not in warm


def test_pack_macro_appends_fear_greed():
    text = rc.pack_review_context({
        "commodities": {"hf_CL": {"name": "WTI", "price": 70, "pct": 1.2}},
        "fear_greed": {"items": [
            {"key": "us", "title": "美股", "score": 56, "label": "贪婪", "detail": "昨收 54.4"},
            {"key": "jp", "title": "日本", "score": None},
        ]},
    })
    assert "【宏观观察】" in text
    assert "WTI" in text
    assert "全球情绪 美股 56 贪婪 昨收 54.4" in text
    assert "日本" not in text
    assert "宏观观察" not in rc.missing_panels(text)
