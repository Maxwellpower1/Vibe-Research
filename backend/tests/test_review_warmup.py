"""review_warmup: session clock + interval (no network)."""
from datetime import datetime, timezone, timedelta

import review_warmup as rw

BEIJING = timezone(timedelta(hours=8))


def test_session_weekday_open_morning():
    t = datetime(2026, 8, 6, 10, 0, tzinfo=BEIJING)  # Thursday
    assert rw.session_kind(t) == "open"


def test_session_weekday_lunch():
    t = datetime(2026, 8, 6, 12, 0, tzinfo=BEIJING)
    assert rw.session_kind(t) == "lunch"


def test_session_weekend_closed():
    t = datetime(2026, 8, 8, 10, 0, tzinfo=BEIJING)  # Saturday
    assert rw.session_kind(t) == "closed"


def test_cockpit_warm_keys_cover_first_paint():
    import inspect

    from api_common import COCKPIT_WARM_KEYS, _warm_review_dc

    assert "board_flow_intraday" in COCKPIT_WARM_KEYS
    assert "world_indices" in COCKPIT_WARM_KEYS
    assert COCKPIT_WARM_KEYS[-1] == "board_flow_intraday"
    src = inspect.getsource(_warm_review_dc)
    for key in COCKPIT_WARM_KEYS:
        assert f'"{key}"' in src


def test_interval_defaults(monkeypatch):
    monkeypatch.delenv("VR_REVIEW_WARMUP_OPEN_SEC", raising=False)
    monkeypatch.delenv("VR_REVIEW_WARMUP_CLOSED_SEC", raising=False)
    assert rw.interval_for_session("open") == 90
    assert rw.interval_for_session("closed") == 900
