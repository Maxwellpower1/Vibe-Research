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
