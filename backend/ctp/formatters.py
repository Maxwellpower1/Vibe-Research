"""CTP SPI field helpers and row mappers."""
from __future__ import annotations

from typing import Any

from ctp.constants import (
    _BS_MAP,
    _DIR_MAP,
    _HEDGE_MAP,
    _OFFSET_MAP,
    _OPTION_ID_RE,
    _OPTION_PRODUCT_CLASSES,
    _ORDER_STATUS_MAP,
    _POS_DATE_MAP,
    _PRICE_SOURCE_MAP,
    _PRICE_TYPE_MAP,
    _SUBMIT_STATUS_MAP,
    _TIME_COND_MAP,
    _TRADE_SOURCE_MAP,
    _TRADE_TYPE_MAP,
    _VOL_COND_MAP,
)

def _field(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    return getattr(obj, name, default)


def _fnum(obj: Any, name: str, nd: int = 2) -> float:
    return round(float(_field(obj, name, 0) or 0), nd)


def _pos_row(p: Any) -> dict[str, Any]:
    direction = str(_field(p, "PosiDirection", "") or "")
    hedge = str(_field(p, "HedgeFlag", "") or "")
    pos_date = str(_field(p, "PositionDate", "") or "")
    position = float(_field(p, "Position", 0) or 0)
    open_cost = float(_field(p, "OpenCost", 0) or 0)
    position_cost = float(_field(p, "PositionCost", 0) or 0)
    # OpenCost / Position = price * volume_multiple (no multiplier in this field set)
    cost_per_lot = round(open_cost / position, 4) if position else 0.0
    return {
        "exchange": str(_field(p, "ExchangeID", "") or ""),
        "instrument": str(_field(p, "InstrumentID", "") or ""),
        "direction": _DIR_MAP.get(direction, direction),
        "direction_code": direction,
        "hedge": _HEDGE_MAP.get(hedge, hedge),
        "position_date": _POS_DATE_MAP.get(pos_date, pos_date),
        "position": position,
        "yd_position": float(_field(p, "YdPosition", 0) or 0),
        "today_position": float(_field(p, "TodayPosition", 0) or 0),
        "open_volume": float(_field(p, "OpenVolume", 0) or 0),
        "close_volume": float(_field(p, "CloseVolume", 0) or 0),
        "open_amount": _fnum(p, "OpenAmount"),
        "close_amount": _fnum(p, "CloseAmount"),
        "open_cost": round(open_cost, 2),
        "position_cost": round(position_cost, 2),
        "cost_per_lot": cost_per_lot,
        "use_margin": _fnum(p, "UseMargin"),
        "exchange_margin": _fnum(p, "ExchangeMargin"),
        "frozen_margin": _fnum(p, "FrozenMargin"),
        "frozen_cash": _fnum(p, "FrozenCash"),
        "frozen_commission": _fnum(p, "FrozenCommission"),
        "long_frozen": float(_field(p, "LongFrozen", 0) or 0),
        "short_frozen": float(_field(p, "ShortFrozen", 0) or 0),
        "close_profit": _fnum(p, "CloseProfit"),
        "close_profit_by_date": _fnum(p, "CloseProfitByDate"),
        "close_profit_by_trade": _fnum(p, "CloseProfitByTrade"),
        "position_profit": _fnum(p, "PositionProfit"),
        "settlement_price": float(_field(p, "SettlementPrice", 0) or 0),
        "pre_settlement_price": float(_field(p, "PreSettlementPrice", 0) or 0),
        "margin_rate_by_money": float(_field(p, "MarginRateByMoney", 0) or 0),
        "margin_rate_by_volume": float(_field(p, "MarginRateByVolume", 0) or 0),
        "commission": _fnum(p, "Commission"),
        "cash_in": _fnum(p, "CashIn"),
        "trading_day": str(_field(p, "TradingDay", "") or ""),
    }


def _account_row(a: Any) -> dict[str, Any]:
    balance = float(_field(a, "Balance", 0) or 0)
    curr_margin = float(_field(a, "CurrMargin", 0) or 0)
    risk_ratio = round(curr_margin / balance * 100, 2) if balance else 0.0
    return {
        "balance": round(balance, 2),
        # Balance is treated as 客户权益 / 动态权益 for live account
        "client_equity": round(balance, 2),
        "available": _fnum(a, "Available"),
        "curr_margin": round(curr_margin, 2),
        "exchange_margin": _fnum(a, "ExchangeMargin"),
        "frozen_margin": _fnum(a, "FrozenMargin"),
        "frozen_cash": _fnum(a, "FrozenCash"),
        "frozen_commission": _fnum(a, "FrozenCommission"),
        "pre_balance": _fnum(a, "PreBalance"),
        "pre_margin": _fnum(a, "PreMargin"),
        "deposit": _fnum(a, "Deposit"),
        "withdraw": _fnum(a, "Withdraw"),
        "withdraw_quota": _fnum(a, "WithdrawQuota"),
        "close_profit": _fnum(a, "CloseProfit"),
        "position_profit": _fnum(a, "PositionProfit"),
        "commission": _fnum(a, "Commission"),
        "credit": _fnum(a, "Credit"),
        "mortgage": _fnum(a, "Mortgage"),
        "cash_in": _fnum(a, "CashIn"),
        "interest": _fnum(a, "Interest"),
        "delivery_margin": _fnum(a, "DeliveryMargin"),
        "risk_ratio": risk_ratio,
        "currency": str(_field(a, "CurrencyID", "") or "CNY"),
        "trading_day": str(_field(a, "TradingDay", "") or ""),
        "account_id": str(_field(a, "AccountID", "") or ""),
    }


def _looks_like_option_id(instrument: str) -> bool:
    return bool(instrument and _OPTION_ID_RE.search(instrument))


def _is_option_meta(meta: dict[str, Any] | None, instrument: str) -> bool:
    if meta:
        pc = str(meta.get("product_class") or "").strip()
        if pc in _OPTION_PRODUCT_CLASSES:
            return True
        # Some builds return letter codes
        if pc.upper() in ("OPTIONS", "SPOTOPTION", "O"):
            return True
    return _looks_like_option_id(instrument)


def _sanitize_price(raw: Any) -> float:
    """CTP uses huge sentinels for empty prices."""
    try:
        v = float(raw or 0)
    except (TypeError, ValueError):
        return 0.0
    if v <= 0 or v > 1e15:
        return 0.0
    return v


def compute_market_equity(
    account: dict[str, Any],
    positions: list[dict[str, Any]],
    instruments: dict[str, dict[str, Any]],
    ticks: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """市值权益 = 客户权益 + 多头期权市值 - 空头期权市值.

    Option market value ≈ LastPrice * Position * VolumeMultiple.
    Price fallback: tick last -> position settlement_price.
    """
    client = float(account.get("client_equity") or account.get("balance") or 0)
    long_v = 0.0
    short_v = 0.0
    used = 0
    missing_px: list[str] = []
    for p in positions:
        inst = str(p.get("instrument") or "")
        if not inst:
            continue
        meta = instruments.get(inst)
        if not _is_option_meta(meta, inst):
            continue
        lots = float(p.get("position") or 0)
        if lots <= 0:
            continue
        mult = float((meta or {}).get("volume_multiple") or 0)
        if mult <= 0:
            # Derive mult from OpenCost / (cost_per_lot path): cost_per_lot ≈ open * mult
            # Without open price, fall back to 1 (wrong for most options) -- skip if unknown
            missing_px.append(f"{inst}:no_mult")
            continue
        tick = ticks.get(inst) or {}
        px = _sanitize_price(tick.get("last_price"))
        if px <= 0:
            px = _sanitize_price(p.get("settlement_price"))
        if px <= 0:
            missing_px.append(inst)
            continue
        mv = px * lots * mult
        used += 1
        # PosiDirection: 2 long / 3 short (mapped to 多/空)
        if p.get("direction") == "多" or str(p.get("direction_code") or "") == "2":
            long_v += mv
        else:
            short_v += mv

    long_v = round(long_v, 2)
    short_v = round(short_v, 2)
    market = round(client + long_v - short_v, 2)
    return {
        "client_equity": round(client, 2),
        "option_long_value": long_v,
        "option_short_value": short_v,
        "market_equity": market,
        "market_equity_method": "客户权益 + 多头期权市值 - 空头期权市值",
        "option_legs": used,
        "option_price_missing": missing_px[:12],
    }

def _offset_label(raw: Any) -> str:
    s = str(raw or "")
    # CombOffsetFlag is often a string whose first char is the flag
    code = s[:1] if s else ""
    return _OFFSET_MAP.get(code, code or "-")


def _order_row(o: Any) -> dict[str, Any]:
    direction = str(_field(o, "Direction", "") or "")
    status = str(_field(o, "OrderStatus", "") or "")
    price_type = str(_field(o, "OrderPriceType", "") or "")
    time_cond = str(_field(o, "TimeCondition", "") or "")
    vol_cond = str(_field(o, "VolumeCondition", "") or "")
    submit = str(_field(o, "OrderSubmitStatus", "") or "")
    insert_date = str(_field(o, "InsertDate", "") or "")
    insert_time = str(_field(o, "InsertTime", "") or "")
    return {
        "exchange": str(_field(o, "ExchangeID", "") or ""),
        "instrument": str(_field(o, "InstrumentID", "") or ""),
        "direction": _BS_MAP.get(direction, direction),
        "direction_code": direction,
        "offset": _offset_label(_field(o, "CombOffsetFlag", "")),
        "hedge": _HEDGE_MAP.get(
            str(_field(o, "CombHedgeFlag", "") or "")[:1],
            str(_field(o, "CombHedgeFlag", "") or ""),
        ),
        "price_type": _PRICE_TYPE_MAP.get(price_type, price_type),
        "limit_price": float(_field(o, "LimitPrice", 0) or 0),
        "stop_price": float(_field(o, "StopPrice", 0) or 0),
        "volume_total": float(_field(o, "VolumeTotalOriginal", 0) or 0),
        "volume_traded": float(_field(o, "VolumeTraded", 0) or 0),
        "volume_left": float(_field(o, "VolumeTotal", 0) or 0),
        "min_volume": float(_field(o, "MinVolume", 0) or 0),
        "time_condition": _TIME_COND_MAP.get(time_cond, time_cond),
        "volume_condition": _VOL_COND_MAP.get(vol_cond, vol_cond),
        "status": _ORDER_STATUS_MAP.get(status, status),
        "status_code": status,
        "submit_status": _SUBMIT_STATUS_MAP.get(submit, submit),
        "status_msg": str(_field(o, "StatusMsg", "") or ""),
        "order_sys_id": str(_field(o, "OrderSysID", "") or "").strip(),
        "order_ref": str(_field(o, "OrderRef", "") or ""),
        "order_local_id": str(_field(o, "OrderLocalID", "") or "").strip(),
        "broker_order_seq": int(_field(o, "BrokerOrderSeq", 0) or 0),
        "insert_time": f"{insert_date} {insert_time}".strip(),
        "update_time": str(_field(o, "UpdateTime", "") or ""),
        "cancel_time": str(_field(o, "CancelTime", "") or ""),
        "active_time": str(_field(o, "ActiveTime", "") or ""),
        "trading_day": str(_field(o, "TradingDay", "") or ""),
        "front_id": int(_field(o, "FrontID", 0) or 0),
        "session_id": int(_field(o, "SessionID", 0) or 0),
        "force_close_reason": str(_field(o, "ForceCloseReason", "") or ""),
        "user_force_close": bool(_field(o, "UserForceClose", 0)),
        "is_swap_order": bool(_field(o, "IsSwapOrder", 0)),
    }


def _trade_row(t: Any) -> dict[str, Any]:
    direction = str(_field(t, "Direction", "") or "")
    offset = str(_field(t, "OffsetFlag", "") or "")
    trade_type = str(_field(t, "TradeType", "") or "")
    price_src = str(_field(t, "PriceSource", "") or "")
    trade_src = str(_field(t, "TradeSource", "") or "")
    trade_date = str(_field(t, "TradeDate", "") or "")
    trade_time = str(_field(t, "TradeTime", "") or "")
    price = float(_field(t, "Price", 0) or 0)
    volume = float(_field(t, "Volume", 0) or 0)
    return {
        "exchange": str(_field(t, "ExchangeID", "") or ""),
        "instrument": str(_field(t, "InstrumentID", "") or ""),
        "exchange_inst_id": str(_field(t, "ExchangeInstID", "") or ""),
        "direction": _BS_MAP.get(direction, direction),
        "direction_code": direction,
        "offset": _OFFSET_MAP.get(offset, offset),
        "hedge": _HEDGE_MAP.get(
            str(_field(t, "HedgeFlag", "") or ""), str(_field(t, "HedgeFlag", "") or "")
        ),
        "price": price,
        "volume": volume,
        "amount": round(price * volume, 2),
        "trade_id": str(_field(t, "TradeID", "") or "").strip(),
        "order_sys_id": str(_field(t, "OrderSysID", "") or "").strip(),
        "order_ref": str(_field(t, "OrderRef", "") or ""),
        "order_local_id": str(_field(t, "OrderLocalID", "") or "").strip(),
        "broker_order_seq": int(_field(t, "BrokerOrderSeq", 0) or 0),
        "trade_type": _TRADE_TYPE_MAP.get(trade_type, trade_type),
        "price_source": _PRICE_SOURCE_MAP.get(price_src, price_src),
        "trade_source": _TRADE_SOURCE_MAP.get(trade_src, trade_src),
        "trade_time": f"{trade_date} {trade_time}".strip(),
        "trading_day": str(_field(t, "TradingDay", "") or ""),
        "sequence_no": int(_field(t, "SequenceNo", 0) or 0),
    }

def _detail_row(d: Any) -> dict[str, Any]:
    """Investor position detail (per open lot) -- has CloseProfitByTrade."""
    direction = str(_field(d, "Direction", "") or "")
    hedge = str(_field(d, "HedgeFlag", "") or "")
    trade_type = str(_field(d, "TradeType", "") or "")
    volume = float(_field(d, "Volume", 0) or 0)
    close_volume = float(_field(d, "CloseVolume", 0) or 0)
    open_price = float(_field(d, "OpenPrice", 0) or 0)
    return {
        "exchange": str(_field(d, "ExchangeID", "") or ""),
        "instrument": str(_field(d, "InstrumentID", "") or ""),
        "comb_instrument": str(_field(d, "CombInstrumentID", "") or ""),
        "direction": _BS_MAP.get(direction, direction),
        "direction_code": direction,
        "hedge": _HEDGE_MAP.get(hedge, hedge),
        "open_date": str(_field(d, "OpenDate", "") or ""),
        "trade_id": str(_field(d, "TradeID", "") or "").strip(),
        "trade_type": _TRADE_TYPE_MAP.get(trade_type, trade_type),
        "open_price": open_price,
        "volume": volume,
        "close_volume": close_volume,
        "close_amount": _fnum(d, "CloseAmount"),
        "close_profit_by_date": _fnum(d, "CloseProfitByDate"),
        "close_profit_by_trade": _fnum(d, "CloseProfitByTrade"),
        "position_profit_by_date": _fnum(d, "PositionProfitByDate"),
        "position_profit_by_trade": _fnum(d, "PositionProfitByTrade"),
        "margin": _fnum(d, "Margin"),
        "exch_margin": _fnum(d, "ExchMargin"),
        "margin_rate_by_money": float(_field(d, "MarginRateByMoney", 0) or 0),
        "margin_rate_by_volume": float(_field(d, "MarginRateByVolume", 0) or 0),
        "last_settlement_price": float(_field(d, "LastSettlementPrice", 0) or 0),
        "settlement_price": float(_field(d, "SettlementPrice", 0) or 0),
        "time_first_volume": float(_field(d, "TimeFirstVolume", 0) or 0),
        "trading_day": str(_field(d, "TradingDay", "") or ""),
    }

