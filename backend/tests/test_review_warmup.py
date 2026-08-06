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


def test_interval_defaults(monkeypatch):
    monkeypatch.delenv("VR_REVIEW_WARMUP_OPEN_SEC", raising=False)
    monkeypatch.delenv("VR_REVIEW_WARMUP_CLOSED_SEC", raising=False)
    assert rw.interval_for_session("open") == 90
    assert rw.interval_for_session("closed") == 900
