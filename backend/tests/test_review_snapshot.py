"""review_snapshot BFF: shape + warmup yield (no network)."""
from __future__ import annotations

from fastapi.testclient import TestClient

import app as app_module
import review_snapshot as rs
import review_warmup as rw

client = TestClient(app_module.app)


def test_review_snapshot_bad_scope():
    assert client.get("/api/market/review-snapshot?scope=nope").status_code == 400


def test_review_snapshot_route_top(monkeypatch):
    monkeypatch.setattr(
        rs,
        "build_review_snapshot",
        lambda **kw: {
            "scope": kw.get("scope", "full"),
            "indices": [{"name": "上证", "price": 1, "change_pct": 0, "change_amt": 0}],
            "overview": None,
            "emotion": None,
            "industry": None,
            "lhb": None,
            "errors": [],
            "updated": "2026-08-13 09:00:00",
        },
    )
    r = client.get("/api/market/review-snapshot?scope=top")
    assert r.status_code == 200
    body = r.json()["data"]
    assert body["scope"] == "top"
    assert body["indices"][0]["name"] == "上证"


def test_review_snapshot_route_paint(monkeypatch):
    monkeypatch.setattr(
        rs,
        "build_review_snapshot",
        lambda **kw: {"scope": kw.get("scope", "full"), "indices": [], "errors": []},
    )
    r = client.get("/api/market/review-snapshot?scope=paint")
    assert r.status_code == 200
    assert r.json()["data"]["scope"] == "paint"


def test_build_snapshot_paint_skips_em(monkeypatch):
    em_top: list[int] = []
    extra_calls: list[int] = []
    monkeypatch.setattr(
        rs,
        "_fill_tencent",
        lambda b, e: b.update(hsgt={"latest": None, "points": []}),
    )
    monkeypatch.setattr(
        rs, "_fill_overview", lambda b, e: b.update(overview={"sentiment": {}, "sectors": [], "updated": ""})
    )
    monkeypatch.setattr(rs, "_fill_em_top", lambda *a, **k: em_top.append(1))
    monkeypatch.setattr(rs, "_fill_em_extra", lambda *a, **k: extra_calls.append(1))
    data = rs.build_review_snapshot(scope="paint")
    assert em_top == []
    assert extra_calls == []
    assert data["scope"] == "paint"
    assert data["emotion"] is None
    assert data["indices"] is None
    assert data["hsgt"]["points"] == []
    assert "global_indices" not in data
    assert "turnover" not in data
    assert "monitor" not in data


def test_build_snapshot_top_skips_extra(monkeypatch):
    extra_calls = []
    monkeypatch.setattr(
        rs,
        "_fill_tencent",
        lambda b, e: b.update(hsgt={"latest": None, "points": []}),
    )
    monkeypatch.setattr(
        rs, "_fill_overview", lambda b, e: b.update(overview={"sentiment": {}, "sectors": [], "updated": ""})
    )
    monkeypatch.setattr(
        rs,
        "_fill_em_top",
        lambda b, e: b.update(emotion=None, industry=None),
    )
    monkeypatch.setattr(rs, "_fill_em_extra", lambda *a, **k: extra_calls.append(1))
    data = rs.build_review_snapshot(scope="top")
    assert extra_calls == []
    assert data["scope"] == "top"
    assert data["lhb"] is None
    assert data["indices"] is None
    assert "updated" in data


def test_tencent_jobs_skip_index_quote():
    import inspect
    import review_jobs

    jobs = inspect.getsource(review_jobs.tencent_jobs)
    warm = inspect.getsource(review_jobs.warm_dc_jobs)
    assert "index_quote" not in jobs
    assert "index_quote" not in warm
    assert "hsgt" in jobs
    assert "world_indices" in warm


def test_query_market_indices_reads_world_indices(monkeypatch):
    import inspect

    from tools import handlers as th

    src = inspect.getsource(th._market)
    block = src[src.find('scope == "indices"'):src.find('scope == "global"')]
    assert "get_global_indices" in block
    assert "index_quote" not in block
    monkeypatch.setattr(
        th.market,
        "get_global_indices",
        lambda: [
            {"symbol": "sh000001", "name": "上证", "region": "CN"},
            {"symbol": "usIXIC", "name": "纳指", "region": "US"},
        ],
    )
    out = th._market({"scope": "indices"})
    assert [r["symbol"] for r in out] == ["sh000001"]


def test_em_fillers_skip_unused_eastmoney():
    import inspect
    import review_jobs

    top_src = inspect.getsource(review_jobs.em_top_jobs)
    extra_src = inspect.getsource(review_jobs.em_extra_jobs)
    assert "get_short_term_emotion" in top_src
    assert "industry_comparison" in top_src
    assert "get_global_indices" not in top_src
    assert "get_turnover_top" not in top_src
    assert "ths_hot_list" not in top_src
    assert "board_fund_flow" not in extra_src
    assert "em_stock_monitor" not in extra_src
    assert "em_price_anomaly" not in extra_src
    assert "limit_up_pools" not in extra_src
    assert "ths_limit_up_pool" not in extra_src


def test_collect_bundle_uses_shared_jobs(monkeypatch):
    monkeypatch.setattr(
        rs,
        "build_review_snapshot",
        lambda **kw: {
            "indices": [{"name": "上证"}],
            "overview": None,
            "emotion": None,
            "industry": None,
            "lhb": None,
            "hsgt": None,
            "errors": [],
        },
    )
    monkeypatch.setattr(
        "review_jobs.live_jobs",
        lambda **kw: [("world", lambda: [{"name": "上证指数", "price": 1, "change_pct": 1}])],
    )
    monkeypatch.setattr("review_jobs.watch_quotes", lambda codes: [{"name": "茅台", "price": 1, "pct": 1}])
    data, errors = rs.collect_review_bundle(watch_codes=["600519"])
    assert data["indices"][0]["name"] == "上证"
    assert data["world"][0]["name"] == "上证指数"
    assert data["watch"][0]["name"] == "茅台"
    assert errors == []


def test_review_context_route(monkeypatch):
    monkeypatch.setattr(
        rs,
        "collect_review_bundle",
        lambda **kw: ({"world": [{"name": "上证指数", "price": 3200, "change_pct": 0.85}]}, []),
    )
    r = client.post("/api/market/review-context", json={"watch_codes": [], "sector_kind": "01"})
    assert r.status_code == 200
    body = r.json()["data"]
    assert "【全球指数】" in body["text"]
    assert "prompt_task" in body
    assert "自选" in body["missing"] or "【自选】" in body["text"]


def test_save_archive_once_per_day(monkeypatch, tmp_path):
    import review_context as rc

    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("VR_REVIEW_ARCHIVE", "1")
    p1 = rc.save_archive("hello snapshot", day="2026-08-19")
    p2 = rc.save_archive("hello snapshot v2", day="2026-08-19")
    assert p1 is not None and p1 == p2
    assert p1.read_text(encoding="utf-8") == "hello snapshot v2"
    monkeypatch.setenv("VR_REVIEW_ARCHIVE", "0")
    assert rc.save_archive("nope", day="2026-08-19") is None


def test_user_busy_skips_warmup(monkeypatch):
    monkeypatch.setattr("review_jobs.warm_minutes", lambda: (0, 0, []))
    with rw.user_fetch():
        out = rw.warm_once()
    assert out.get("skipped") is True
    assert rw.user_busy() is False
