"""trading_calendar: no network. Mail and warmup share is_cn_trading_day."""
from datetime import date, datetime, timedelta, timezone

import review_mail as rm
import review_warmup as rw
import trading_calendar as tc

BEIJING = timezone(timedelta(hours=8))


def setup_function():
    tc.reset()


def teardown_function():
    tc.reset()


def test_weekend_closed():
    assert tc.is_cn_trading_day(date(2026, 8, 15)) is False  # Saturday
    assert tc.is_cn_trading_day(date(2026, 8, 16)) is False  # Sunday


def test_weekday_without_calendar_is_open():
    assert tc.is_cn_trading_day(date(2026, 10, 1)) is True


def test_holiday_inside_range_is_closed():
    tc.load_dates([date(2026, 9, 30), date(2026, 10, 9)])
    assert tc.is_cn_trading_day(date(2026, 10, 1)) is False
    assert tc.is_cn_trading_day(date(2026, 9, 30)) is True
    assert tc.is_cn_trading_day(date(2026, 10, 9)) is True


def test_outside_range_falls_back_to_weekend_only():
    tc.load_dates([date(2026, 8, 17)])
    assert tc.is_cn_trading_day(date(2026, 10, 1)) is True


def test_parse_kline_dates():
    payload = {
        "data": {
            "klines": [
                "2026-08-17,3000",
                "2026-08-18",
                "bad",
                12,
            ]
        }
    }
    days = tc.parse_kline_dates(payload)
    assert date(2026, 8, 17) in days
    assert date(2026, 8, 18) in days
    assert len(days) == 2
    assert tc.parse_kline_dates(None) == frozenset()


def test_parse_bar_dates():
    payload = {
        "bars": [
            {"datetime": "2026-08-17"},
            {"date": "2026-08-18"},
            {"datetime": "bad"},
            "skip",
        ]
    }
    days = tc.parse_bar_dates(payload)
    assert days == frozenset({date(2026, 8, 17), date(2026, 8, 18)})
    assert tc.parse_bar_dates(None) == frozenset()


def _days(start: date, n: int) -> list[date]:
    return [start + timedelta(days=i) for i in range(n)]


def test_refresh_uses_push2delay_when_push2his_drops(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    days = _days(date(2024, 1, 2), 250)
    payload = {"data": {"klines": [d.isoformat() for d in days]}}

    class _Resp:
        def json(self):
            return payload

    def fake_get(url, **_k):
        if "push2his" in url:
            raise ConnectionError("aborted")
        return _Resp()

    monkeypatch.setattr("astock.em_get", fake_get)
    monkeypatch.setattr("astock.daily_bars", lambda *_a, **_k: {})
    assert tc.refresh() is True
    assert tc.status()["source"] == "eastmoney"
    assert tc.is_cn_trading_day(date(2024, 1, 2)) is True


def test_refresh_uses_tencent_when_eastmoney_drops(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    days = _days(date(2024, 1, 2), 250)

    def boom(*_a, **_k):
        raise ConnectionError("aborted")

    monkeypatch.setattr("astock.em_get", boom)
    monkeypatch.setattr(
        "astock.daily_bars",
        lambda *_a, **_k: {"bars": [{"datetime": d.isoformat()} for d in days]},
    )
    assert tc.refresh() is True
    assert tc.status()["source"] == "tencent"
    assert tc.is_cn_trading_day(date(2024, 1, 2)) is True


def test_refresh_tencent_merges_disk(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    old = _days(date(2016, 1, 4), 250)
    new = _days(date(2026, 1, 5), 250)
    tc._ALLOW_DISK = True
    tc._save_disk(frozenset(old))

    def boom(*_a, **_k):
        raise ConnectionError("aborted")

    monkeypatch.setattr("astock.em_get", boom)
    monkeypatch.setattr(
        "astock.daily_bars",
        lambda *_a, **_k: {"bars": [{"datetime": d.isoformat()} for d in new]},
    )
    assert tc.refresh() is True
    assert tc.status()["source"] == "tencent+disk"
    assert tc.is_cn_trading_day(date(2016, 1, 4)) is True
    assert tc.is_cn_trading_day(date(2026, 1, 5)) is True


def test_refresh_keeps_disk_when_live_fails(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    days = _days(date(2025, 1, 2), 250)
    tc._ALLOW_DISK = True
    tc._save_disk(frozenset(days))

    def boom(*_a, **_k):
        raise ConnectionError("aborted")

    monkeypatch.setattr("astock.em_get", boom)
    monkeypatch.setattr("astock.daily_bars", lambda *_a, **_k: {})
    assert tc.refresh() is False
    assert tc.status()["source"] == "disk"
    assert tc.is_cn_trading_day(date(2025, 1, 2)) is True


def test_mail_skips_holiday():
    tc.load_dates([date(2026, 9, 30), date(2026, 10, 9)])
    holiday = datetime(2026, 10, 1, 16, 10, tzinfo=BEIJING)
    assert rm.due(holiday, None, 16, 10) is False
    open_day = datetime(2026, 9, 30, 16, 10, tzinfo=BEIJING)
    assert rm.due(open_day, None, 16, 10) is True


def test_warmup_holiday_is_closed():
    tc.load_dates([date(2026, 9, 30), date(2026, 10, 9)])
    t = datetime(2026, 10, 1, 10, 0, tzinfo=BEIJING)
    assert rw.session_kind(t) == "closed"
    open_t = datetime(2026, 9, 30, 10, 0, tzinfo=BEIJING)
    assert rw.session_kind(open_t) == "open"


def test_last_closed_before_1500_is_previous_session():
    tc.load_dates([date(2026, 8, 13), date(2026, 8, 14)])
    now = datetime(2026, 8, 14, 14, 59, tzinfo=BEIJING)
    assert tc.last_closed_session(now) == date(2026, 8, 13)


def test_last_closed_at_1500_is_today():
    tc.load_dates([date(2026, 8, 13), date(2026, 8, 14)])
    now = datetime(2026, 8, 14, 15, 0, tzinfo=BEIJING)
    assert tc.last_closed_session(now) == date(2026, 8, 14)


def test_last_closed_weekend_is_friday():
    tc.load_dates([date(2026, 8, 13), date(2026, 8, 14)])
    now = datetime(2026, 8, 15, 10, 0, tzinfo=BEIJING)
    assert tc.last_closed_session(now) == date(2026, 8, 14)
