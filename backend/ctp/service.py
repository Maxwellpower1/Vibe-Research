"""Public CTP service: login / logout / portfolio / settlement fetch."""
from __future__ import annotations

import os
import threading
import time
from typing import Any

import ctp.state as state
from ctp.config import _mask_user, load_config
from ctp.constants import (
    CACHE_DIR,
    CTP_CFG_FILE,
    SETTLEMENT_CACHE_FILE,
    _DEFAULT_TIMEOUT,
)
from ctp.errors import CtpError
from ctp.formatters import compute_market_equity
from ctp.session import _build_session
from ctp.settlement import (
    _account_cache_id,
    _get_cached_settlement,
    _iter_range_days,
    _normalize_trading_day,
    _normalize_ymd,
    _put_cached_settlement,
    _series_point,
    _today_ymd,
    build_settlement_analytics,
    reparse_settlement_cache,
)
from ctp.state import _now, add_log

def login(timeout: float = _DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Connect + authenticate + login; keep session open. Click-driven."""

    cfg = load_config()
    if not cfg:
        raise CtpError(
            f"未配置 CTP 账户. 请写入 {CTP_CFG_FILE} 或设置环境变量 "
            "CTP_HOST/CTP_BROKER/CTP_USER/CTP_PASSWORD/CTP_APPID/CTP_AUTHCODE"
        )
    try:
        from openctp_ctp import thosttraderapi as tdapi
    except ImportError as e:
        raise CtpError("未安装 openctp-ctp, 请执行: pip install openctp-ctp") from e

    if not state._op_lock.acquire(timeout=2):
        raise CtpError("已有操作进行中, 请稍候")
    td = None
    pending_me: dict[str, Any] | None = None
    try:
        with state._lock:
            if state._logging_in:
                raise CtpError("正在登录中, 请稍候")
            if _is_logged_in_unlocked():
                add_log("Already logged in, auto query ...", "warn")
                td_exist = state._session
                # fall through to auto query below (still hold state._op_lock)
            else:
                td_exist = None
                stale = state._session
                state._session = None
                state._logging_in = True

        if td_exist is not None:
            try:
                portfolio = td_exist.query_portfolio(timeout=timeout)
                msg = "已登录, 已刷新持仓"
            except CtpError as e:
                add_log(f"Auto query failed: {e}", "error")
                portfolio = None
                msg = f"已登录, 但自动查询失败: {e}"
            pending_me = portfolio
            return {
                "logged_in": True,
                "trading_day": td_exist.trading_day,
                "user_masked": _mask_user(cfg["user"]),
                "message": msg,
                "portfolio": portfolio,
            }

        if stale is not None:
            try:
                stale.close()
            except Exception:
                pass

        os.makedirs(CACHE_DIR, exist_ok=True)
        add_log(f"Login start user={_mask_user(cfg['user'])}")
        td = _build_session(tdapi, cfg)
        td.connect_and_login(timeout=timeout)
        with state._lock:
            state._session = td
            state._logging_in = False
        add_log("Login OK, session kept open; auto query account + positions")
        try:
            portfolio = td.query_portfolio(timeout=timeout)
            msg = "登录成功, 已拉取持仓"
        except CtpError as e:
            # Keep session even if first query fails
            add_log(f"Auto query failed: {e}", "error")
            portfolio = None
            msg = f"登录成功, 但自动查询失败: {e}"
        pending_me = portfolio
        return {
            "logged_in": True,
            "trading_day": td.trading_day,
            "user_masked": _mask_user(cfg["user"]),
            "message": msg,
            "portfolio": portfolio,
        }
    except Exception:
        with state._lock:
            state._logging_in = False
            # Login never finished: drop the half-open api
            if state._session is None and td is not None:
                try:
                    td.close()
                except Exception:
                    pass
        raise
    finally:
        state._op_lock.release()
        schedule_market_equity(pending_me)


def logout() -> dict[str, Any]:
    if not state._op_lock.acquire(timeout=2):
        raise CtpError("已有操作进行中, 请稍候")
    try:
        with state._lock:
            td = state._session
            state._session = None
            state._logging_in = False
        if td is not None:
            try:
                td.close()
            except Exception as e:
                add_log(f"Logout warn: {e}", "warn")
        add_log("Logged out")
        _reset_market_equity_state()
        return {"logged_in": False, "message": "已退出登录"}
    finally:
        state._op_lock.release()


def _reset_market_equity_state() -> None:
    with state._me_lock:
        state._me_seq += 1
        state._me_state.update({
            "status": "idle",
            "seq": state._me_seq,
            "result": None,
            "error": None,
            "updated": None,
            "trading_day": "",
        })


def get_market_equity_job() -> dict[str, Any]:
    """Poll async 市值权益 job (option ticks loaded in background)."""
    with state._me_lock:
        st = dict(state._me_state)
    result = st.get("result")
    return {
        "status": st.get("status") or "idle",
        "seq": st.get("seq") or 0,
        "trading_day": st.get("trading_day") or "",
        "updated": st.get("updated"),
        "error": st.get("error"),
        "account_patch": result,
        "pending": st.get("status") in ("pending", "running"),
    }


def schedule_market_equity(portfolio: dict[str, Any] | None) -> None:
    """Start background option-tick load after portfolio returns (non-blocking)."""
    if not portfolio or not portfolio.get("market_equity_pending"):
        return
    positions = list(portfolio.get("positions") or [])
    account = dict(portfolio.get("account") or {})
    trading_day = str(portfolio.get("trading_day") or "")
    with state._me_lock:
        state._me_seq += 1
        seq = state._me_seq
        state._me_state.update({
            "status": "pending",
            "seq": seq,
            "result": None,
            "error": None,
            "updated": None,
            "trading_day": trading_day,
        })

    def worker() -> None:
        with state._me_lock:
            if state._me_state.get("seq") != seq:
                return
            state._me_state["status"] = "running"
        add_log(f"MarketEquity bg start seq={seq} (option ticks, rate-limited)")
        # Wait for main portfolio / login to release op lock
        if not state._op_lock.acquire(timeout=180):
            with state._me_lock:
                if state._me_state.get("seq") == seq:
                    state._me_state.update({
                        "status": "error",
                        "error": "等待操作锁超时",
                        "updated": _now(),
                    })
            add_log("MarketEquity bg wait op_lock timeout", "warn")
            return
        try:
            with state._me_lock:
                if state._me_state.get("seq") != seq:
                    return
            with state._lock:
                td = state._session
                if td is None or not getattr(td, "ready", False):
                    raise CtpError("会话已断开")
            instruments, ticks = td._load_option_meta_and_ticks(positions)
            me = compute_market_equity(account, positions, instruments, ticks)
            me["market_equity_pending"] = False
            with state._me_lock:
                if state._me_state.get("seq") != seq:
                    return
                state._me_state.update({
                    "status": "ready",
                    "result": me,
                    "error": None,
                    "updated": _now(),
                    "trading_day": trading_day,
                })
            add_log(
                f"MarketEquity bg ready seq={seq} "
                f"eq={me.get('market_equity')} long={me.get('option_long_value')} "
                f"short={me.get('option_short_value')} legs={me.get('option_legs')}"
            )
        except Exception as e:
            add_log(f"MarketEquity bg fail seq={seq}: {e}", "error")
            with state._me_lock:
                if state._me_state.get("seq") == seq:
                    state._me_state.update({
                        "status": "error",
                        "error": str(e),
                        "updated": _now(),
                    })
        finally:
            state._op_lock.release()

    threading.Thread(target=worker, name=f"ctp-me-{seq}", daemon=True).start()


def fetch_portfolio(timeout: float = _DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Query account + positions on the existing logged-in session."""
    if not state._op_lock.acquire(timeout=2):
        raise CtpError("已有操作进行中, 请稍候")
    try:
        with state._lock:
            td = state._session
            if td is None or not getattr(td, "ready", False):
                raise CtpError("尚未登录, 请先点「登录」")
            if state._logging_in:
                raise CtpError("正在登录中, 请稍候")
        result = td.query_portfolio(timeout=timeout)
    finally:
        state._op_lock.release()
    schedule_market_equity(result)
    return result


def fetch_settlement(
    trading_day: str,
    timeout: float = _DEFAULT_TIMEOUT,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Query one settlement day; use local cache unless force=True."""
    day = _normalize_trading_day(trading_day)
    if len(day) == 8 and not force:
        cached = _get_cached_settlement(day)
        if cached and cached.get("status") == "ok":
            add_log(f"Settlement {day}: cache hit")
            return {
                "trading_day": day,
                "parsed": cached.get("parsed") or {},
                "content": cached.get("content") or "",
                "chunk_count": cached.get("chunk_count") or 0,
                "updated": cached.get("updated") or _now(),
                "status": "ok",
                "from_cache": True,
            }

    if not state._op_lock.acquire(timeout=2):
        raise CtpError("已有操作进行中, 请稍候")
    try:
        with state._lock:
            td = state._session
            if td is None or not getattr(td, "ready", False):
                raise CtpError("尚未登录, 请先点「登录」")
            if state._logging_in:
                raise CtpError("正在登录中, 请稍候")
        result = td.query_settlement(day, timeout=timeout, allow_empty=False)
        if len(day) == 8 and result.get("status") == "ok":
            _put_cached_settlement(
                day,
                {
                    "status": "ok",
                    "trading_day": day,
                    "parsed": result.get("parsed") or {},
                    "content": result.get("content") or "",
                    "chunk_count": result.get("chunk_count") or 0,
                    "updated": result.get("updated") or _now(),
                },
            )
        result["from_cache"] = False
        return result
    finally:
        state._op_lock.release()


def fetch_settlement_range(
    start: str,
    end: str | None = None,
    *,
    refresh: bool = True,
    force: bool = False,
    timeout: float = _DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Pull settlements for [start, end] (end defaults to today).

    Cached ok/empty days are skipped unless force=True.
    refresh=False: read cache only (no CTP).
    """
    # Fix historically truncated parses (e.g. 779151.49 -> 779) from old regex
    try:
        rep = reparse_settlement_cache()
        if rep.get("fixed"):
            add_log(f"Settlement cache reparsed: fixed={rep['fixed']}/{rep['scanned']}")
    except Exception as e:
        add_log(f"Settlement cache reparse warn: {e}", "warn")

    start_d = _normalize_ymd(start)
    end_d = _normalize_ymd(end) if end else _today_ymd()
    days = _iter_range_days(start_d, end_d)

    series: list[dict[str, Any]] = []
    stats = {
        "total_days": len(days),
        "cached": 0,
        "fetched": 0,
        "empty": 0,
        "errors": 0,
        "missing": 0,
    }

    need_fetch: list[str] = []
    for day in days:
        cached = None if force else _get_cached_settlement(day)
        if cached and cached.get("status") in ("ok", "empty"):
            # Today empty may become available later -- do not trust empty cache for today
            if cached.get("status") == "empty" and day >= _today_ymd() and refresh:
                need_fetch.append(day)
                continue
            pt = _series_point(day, cached, from_cache=True)
            series.append(pt)
            stats["cached"] += 1
            if cached.get("status") == "empty":
                stats["empty"] += 1
            continue
        if refresh:
            need_fetch.append(day)
        else:
            series.append(_series_point(day, None, from_cache=False))
            stats["missing"] += 1

    if need_fetch:
        # Hold op lock for the whole batch (CTP qry gap already serializes)
        lock_wait = max(5.0, min(30.0, 2.0 + len(need_fetch) * 0.05))
        if not state._op_lock.acquire(timeout=lock_wait):
            raise CtpError("已有操作进行中, 请稍候")
        try:
            with state._lock:
                td = state._session
                if td is None or not getattr(td, "ready", False):
                    raise CtpError("尚未登录, 请先点「登录」后再拉取缺失结算单")
                if state._logging_in:
                    raise CtpError("正在登录中, 请稍候")
            add_log(
                f"Settlement range fetch {len(need_fetch)} days ({start_d}..{end_d})"
            )
            for day in need_fetch:
                try:
                    result = td.query_settlement(day, timeout=timeout, allow_empty=True)
                    status = result.get("status") or "ok"
                    rec = {
                        "status": status,
                        "trading_day": day,
                        "parsed": result.get("parsed") or {},
                        "content": result.get("content") or "",
                        "chunk_count": result.get("chunk_count") or 0,
                        "updated": result.get("updated") or _now(),
                    }
                    # Do not permanently cache empty for today (settlement may arrive later)
                    if status == "ok" or day < _today_ymd():
                        _put_cached_settlement(day, rec)
                    series.append(_series_point(day, rec, from_cache=False))
                    stats["fetched"] += 1
                    if status == "empty":
                        stats["empty"] += 1
                except CtpError as e:
                    add_log(f"Settlement {day} fail: {e}", "error")
                    series.append(
                        _series_point(day, None, from_cache=False, error=str(e))
                    )
                    stats["errors"] += 1
        finally:
            state._op_lock.release()

    series.sort(key=lambda x: x["trading_day"])
    chart = [
        {
            "date": p["date"],
            "trading_day": p["trading_day"],
            "equity": p["equity"],
            "market_equity": p["market_equity"],
            "client_equity": p["client_equity"],
        }
        for p in series
        if p.get("status") == "ok" and p.get("equity") is not None
    ]
    analytics = build_settlement_analytics(series)
    return {
        "start": start_d,
        "end": end_d,
        "account": _account_cache_id(),
        "series": series,
        "chart": chart,
        "analytics": analytics,
        "stats": stats,
        "cache_file": SETTLEMENT_CACHE_FILE,
        "updated": _now(),
    }
