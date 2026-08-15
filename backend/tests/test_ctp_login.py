"""CTP package offline tests (no broker / no openctp)."""
from __future__ import annotations

import sys
import types

import ctp.service as svc
import ctp.state as state


class _FakeTd:
    ready = True
    trading_day = "20260813"

    def query_portfolio(self, timeout=0):
        return {"account": {}, "positions": []}


def test_login_already_logged_in_no_nameerror(monkeypatch):
    """Regression: login() used a bare _is_logged_in_unlocked after the ctp split."""
    monkeypatch.setattr(
        svc,
        "load_config",
        lambda: {
            "user": "123456",
            "host": "x",
            "broker": "x",
            "password": "x",
            "appid": "x",
            "authcode": "x",
        },
    )
    fake_ctp = types.ModuleType("openctp_ctp")
    fake_ctp.thosttraderapi = types.ModuleType("thosttraderapi")
    monkeypatch.setitem(sys.modules, "openctp_ctp", fake_ctp)
    monkeypatch.setitem(sys.modules, "openctp_ctp.thosttraderapi", fake_ctp.thosttraderapi)
    monkeypatch.setattr(svc, "schedule_market_equity", lambda *_a, **_k: None)

    fake = _FakeTd()
    with state._lock:
        state._session = fake
        state._logging_in = False
    try:
        out = svc.login(timeout=0.1)
    finally:
        with state._lock:
            state._session = None
            state._logging_in = False

    assert out["logged_in"] is True
    assert "已登录" in out["message"]
    assert out["trading_day"] == "20260813"


def test_settlement_range_helpers_defined():
    """Regression: split left CtpError / timedelta / CACHE_DIR unbound in settlement.py."""
    from ctp.errors import CtpError
    from ctp.settlement import _iter_range_days, _normalize_ymd

    try:
        _normalize_ymd("2026-08")
        raise AssertionError("expected CtpError")
    except CtpError as e:
        assert "YYYYMMDD" in str(e)

    days = _iter_range_days("20260810", "20260814")  # Mon-Fri
    assert days[0] == "20260810"
    assert days[-1] == "20260814"
    assert all(d >= "20260810" for d in days)

    try:
        _iter_range_days("20260814", "20260810")
        raise AssertionError("expected CtpError")
    except CtpError as e:
        assert "开始日期" in str(e)

    # Apr 8 -> Aug 13 2026 used to fail the old 120-day calendar cap.
    long = _iter_range_days("20260408", "20260813")
    assert long[0] == "20260408"
    assert long[-1] == "20260813"
    year = _iter_range_days("20250101", "20261231")
    assert year[0] == "20250101"
    assert year[-1] == "20261231"
