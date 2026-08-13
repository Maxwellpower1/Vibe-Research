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
            "global_indices": [],
            "overview": None,
            "emotion": None,
            "turnover": None,
            "hot": None,
            "industry": None,
            "lhb": None,
            "monitor": None,
            "anomaly": None,
            "limit_pool": None,
            "ths_limit_up": None,
            "board_flow": None,
            "errors": [],
            "updated": "2026-08-13 09:00:00",
        },
    )
    r = client.get("/api/market/review-snapshot?scope=top")
    assert r.status_code == 200
    body = r.json()["data"]
    assert body["scope"] == "top"
    assert body["indices"][0]["name"] == "上证"


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
        lambda b, e: b.update(
            global_indices=[], emotion=None, turnover=None, hot=None, industry=None
        ),
    )
    monkeypatch.setattr(rs, "_fill_em_extra", lambda *a, **k: extra_calls.append(1))
    data = rs.build_review_snapshot(scope="top")
    assert extra_calls == []
    assert data["scope"] == "top"
    assert data["lhb"] is None
    assert data["indices"][0]["name"] == "上证"
    assert "updated" in data


def test_user_busy_skips_warmup():
    with rw.user_fetch():
        out = rw.warm_once()
    assert out.get("skipped") is True
    assert rw.user_busy() is False
