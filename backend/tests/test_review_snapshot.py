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
        lambda b, e: b.update(
            indices=[{"name": "上证", "price": 1, "change_pct": 0, "change_amt": 0}]
        ),
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
    assert data["indices"][0]["name"] == "上证"
    assert "global_indices" not in data
    assert "turnover" not in data
    assert "monitor" not in data


def test_build_snapshot_top_skips_extra(monkeypatch):
    extra_calls = []
    monkeypatch.setattr(
        rs,
        "_fill_tencent",
        lambda b, e: b.update(
            indices=[{"name": "上证", "price": 1, "change_pct": 0, "change_amt": 0}]
        ),
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
    assert data["indices"][0]["name"] == "上证"
    assert "updated" in data


def test_em_fillers_skip_unused_eastmoney():
    import inspect

    top_src = inspect.getsource(rs._fill_em_top)
    extra_src = inspect.getsource(rs._fill_em_extra)
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


def test_user_busy_skips_warmup():
    with rw.user_fetch():
        out = rw.warm_once()
    assert out.get("skipped") is True
    assert rw.user_busy() is False
