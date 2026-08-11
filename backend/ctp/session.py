"""CTP trader SPI session factory (connect / query / release)."""
from __future__ import annotations

import os
import threading
import time
from typing import Any

from ctp.config import _mask_user
from ctp.constants import CTP_FLOW_DIR, _DEFAULT_TIMEOUT, _QRY_GAP
from ctp.errors import CtpError
from ctp.formatters import (
    _account_row,
    _detail_row,
    _field,
    _is_option_meta,
    _looks_like_option_id,
    _order_row,
    _pos_row,
    _sanitize_price,
    _trade_row,
    compute_market_equity,
)
from ctp.settlement import (
    _decode_settlement_chunk,
    _normalize_trading_day,
    parse_settlement_text,
)
from ctp.state import _now, add_log

def _build_session(tdapi: Any, cfg: dict[str, str]):
    """SPI that stays connected after login until logout()."""

    class CtpSession(tdapi.CThostFtdcTraderSpi):
        def __init__(self) -> None:
            super().__init__()
            self.cfg = cfg
            self.trading_day = ""
            self.ready = False
            self.error: str | None = None
            self.logged_in_ev = threading.Event()
            self.settlement_done = threading.Event()
            self.account_done = threading.Event()
            self.position_done = threading.Event()
            self.order_done = threading.Event()
            self.trade_done = threading.Event()
            self.detail_done = threading.Event()
            self.settlement_qry_done = threading.Event()
            self.instrument_done = threading.Event()
            self.tick_done = threading.Event()
            self.account: dict[str, Any] | None = None
            self.positions: list[dict[str, Any]] = []
            self.orders: list[dict[str, Any]] = []
            self.trades: list[dict[str, Any]] = []
            self.details: list[dict[str, Any]] = []
            self._settlement_chunks: list[tuple[int, str]] = []
            self._instrument_buf: dict[str, dict[str, Any]] = {}
            self._tick_buf: dict[str, dict[str, Any]] = {}
            self._qry_error: str | None = None

            os.makedirs(CTP_FLOW_DIR, exist_ok=True)
            # Trailing sep => CTP creates DialogRsp.con etc. inside the folder
            flow = CTP_FLOW_DIR + os.sep
            self.api = tdapi.CThostFtdcTraderApi.CreateFtdcTraderApi(flow)
            self.api.RegisterSpi(self)
            self.api.RegisterFront(cfg["host"])
            self.api.SubscribePrivateTopic(tdapi.THOST_TERT_QUICK)
            self.api.SubscribePublicTopic(tdapi.THOST_TERT_QUICK)
            add_log(f"FlowPath {CTP_FLOW_DIR}")
            add_log(f"RegisterFront {cfg['host']}")

        def _fail_login(self, msg: str) -> None:
            self.error = msg
            self.ready = False
            add_log(msg, "error")
            self.logged_in_ev.set()

        def OnFrontConnected(self):
            add_log("OnFrontConnected")
            try:
                req = tdapi.CThostFtdcReqAuthenticateField()
                req.BrokerID = self.cfg["broker"]
                req.UserID = self.cfg["user"]
                req.AppID = self.cfg["appid"]
                req.AuthCode = self.cfg["authcode"]
                add_log(
                    f"ReqAuthenticate user={_mask_user(self.cfg['user'])} appid={self.cfg['appid']}"
                )
                self.api.ReqAuthenticate(req, 0)
            except Exception as e:
                self._fail_login(f"认证请求异常: {e}")

        def OnFrontDisconnected(self, nReason: int):
            add_log(f"OnFrontDisconnected nReason={nReason}", "warn")
            self.ready = False
            if not self.logged_in_ev.is_set():
                self._fail_login(f"前置断开 nReason={nReason}")

        def OnRspAuthenticate(
            self, pRspAuthenticateField, pRspInfo, nRequestID, bIsLast
        ):
            try:
                if pRspInfo and pRspInfo.ErrorID != 0:
                    self._fail_login(f"认证失败: {pRspInfo.ErrorMsg}")
                    return
                add_log("Authenticate succeed")
                req = tdapi.CThostFtdcReqUserLoginField()
                req.BrokerID = self.cfg["broker"]
                req.UserID = self.cfg["user"]
                req.Password = self.cfg["password"]
                req.UserProductInfo = "vr"
                add_log("ReqUserLogin ...")
                self.api.ReqUserLogin(req, 0)
            except Exception as e:
                self._fail_login(f"登录请求异常: {e}")

        def OnRspUserLogin(self, pRspUserLogin, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._fail_login(f"登录失败: {pRspInfo.ErrorMsg}")
                    return
                if pRspUserLogin is not None:
                    self.trading_day = str(pRspUserLogin.TradingDay or "")
                    add_log(
                        f"Login succeed TradingDay={self.trading_day} "
                        f"FrontID={pRspUserLogin.FrontID} SessionID={pRspUserLogin.SessionID}"
                    )
                if bIsLast:
                    self.ready = True
                    self.logged_in_ev.set()
            except Exception as e:
                self._fail_login(f"登录回调异常: {e}")

        def OnRspSettlementInfoConfirm(
            self, pSettlementInfoConfirm, pRspInfo, nRequestID, bIsLast
        ):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    add_log(f"Settlement confirm warn: {pRspInfo.ErrorMsg}", "warn")
                elif bIsLast:
                    add_log("Settlement confirmed")
            finally:
                if bIsLast:
                    self.settlement_done.set()

        def OnRspQryTradingAccount(
            self, pTradingAccount, pRspInfo, nRequestID, bIsLast
        ):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查资金失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pTradingAccount is not None:
                    self.account = _account_row(pTradingAccount)
                    add_log(
                        f"Account Balance={self.account['balance']} "
                        f"Available={self.account['available']} "
                        f"Margin={self.account['curr_margin']}"
                    )
            finally:
                if bIsLast:
                    self.account_done.set()

        def OnRspQryInvestorPosition(
            self, pInvestorPosition, pRspInfo, nRequestID, bIsLast
        ):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查持仓失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pInvestorPosition is not None:
                    row = _pos_row(pInvestorPosition)
                    if row["position"] or row["yd_position"] or row["today_position"]:
                        self.positions.append(row)
                        add_log(
                            f"Position {row['instrument']} {row['direction']} "
                            f"{row['position']}手 margin={row['use_margin']}"
                        )
            finally:
                if bIsLast:
                    self.position_done.set()

        def OnRspQryOrder(self, pOrder, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查委托失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pOrder is not None:
                    row = _order_row(pOrder)
                    self.orders.append(row)
                    add_log(
                        f"Order {row['instrument']} {row['direction']}{row['offset']} "
                        f"{row['volume_traded']}/{row['volume_total']} @ {row['limit_price']} "
                        f"{row['status']}"
                    )
            finally:
                if bIsLast:
                    self.order_done.set()

        def OnRspQryTrade(self, pTrade, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查成交失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pTrade is not None:
                    row = _trade_row(pTrade)
                    self.trades.append(row)
                    add_log(
                        f"Trade {row['instrument']} {row['direction']}{row['offset']} "
                        f"{row['volume']}手 @ {row['price']}"
                    )
            finally:
                if bIsLast:
                    self.trade_done.set()

        def OnRspQryInvestorPositionDetail(
            self, pInvestorPositionDetail, pRspInfo, nRequestID, bIsLast
        ):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查持仓明细失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pInvestorPositionDetail is not None:
                    row = _detail_row(pInvestorPositionDetail)
                    if row["volume"] or row["close_volume"]:
                        self.details.append(row)
                        add_log(
                            f"Detail {row['instrument']} {row['direction']} "
                            f"open={row['open_price']} vol={row['volume']} "
                            f"closePnL={row['close_profit_by_trade']} "
                            f"posPnL={row['position_profit_by_trade']}"
                        )
            finally:
                if bIsLast:
                    self.detail_done.set()

        def OnRspQrySettlementInfo(
            self, pSettlementInfo, pRspInfo, nRequestID, bIsLast
        ):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查结算单失败: {pRspInfo.ErrorMsg}"
                    add_log(self._qry_error, "error")
                elif pSettlementInfo is not None:
                    seq = int(_field(pSettlementInfo, "SequenceNo", 0) or 0)
                    chunk = _decode_settlement_chunk(
                        _field(pSettlementInfo, "Content", "")
                    )
                    # Must copy now: Content buffer may be reused on next callback
                    self._settlement_chunks.append((seq, chunk))
            finally:
                if bIsLast:
                    self.settlement_qry_done.set()

        def connect_and_login(self, timeout: float = _DEFAULT_TIMEOUT) -> None:
            add_log("Init trader api ...")
            self.api.Init()
            if not self.logged_in_ev.wait(timeout):
                raise CtpError("登录超时: 检查前置地址 / 网络 / 账号")
            if self.error:
                raise CtpError(self.error)

            self.settlement_done.clear()
            req = tdapi.CThostFtdcSettlementInfoConfirmField()
            req.BrokerID = self.cfg["broker"]
            req.InvestorID = self.cfg["user"]
            add_log("ReqSettlementInfoConfirm ...")
            self.api.ReqSettlementInfoConfirm(req, 0)
            if not self.settlement_done.wait(min(15.0, timeout)):
                add_log("Settlement confirm timeout, continue", "warn")

        def _wait_qry(self, done: threading.Event, label: str, timeout: float) -> None:
            if not done.wait(timeout):
                raise CtpError(f"查询{label}超时")
            if self._qry_error:
                raise CtpError(self._qry_error)

        def _wait_qry_soft(
            self, done: threading.Event, label: str, timeout: float
        ) -> bool:
            """Optional qry: log failures, never abort portfolio."""
            if not done.wait(timeout):
                add_log(f"查询{label}超时", "warn")
                return False
            if self._qry_error:
                add_log(self._qry_error, "warn")
                self._qry_error = None
                return False
            return True

        def OnRspQryInstrument(self, pInstrument, pRspInfo, nRequestID, bIsLast):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查合约失败: {pRspInfo.ErrorMsg}"
                elif pInstrument is not None:
                    iid = str(_field(pInstrument, "InstrumentID", "") or "")
                    if iid:
                        self._instrument_buf[iid] = {
                            "instrument": iid,
                            "exchange": str(
                                _field(pInstrument, "ExchangeID", "") or ""
                            ),
                            "product_class": str(
                                _field(pInstrument, "ProductClass", "") or ""
                            ),
                            "volume_multiple": int(
                                _field(pInstrument, "VolumeMultiple", 0) or 0
                            ),
                            "options_type": str(
                                _field(pInstrument, "OptionsType", "") or ""
                            ),
                            "underlying": str(
                                _field(pInstrument, "UnderlyingInstrID", "") or ""
                            ),
                        }
            finally:
                if bIsLast:
                    self.instrument_done.set()

        def OnRspQryDepthMarketData(
            self, pDepthMarketData, pRspInfo, nRequestID, bIsLast
        ):
            try:
                if pRspInfo is not None and pRspInfo.ErrorID != 0:
                    self._qry_error = f"查行情失败: {pRspInfo.ErrorMsg}"
                elif pDepthMarketData is not None:
                    iid = str(_field(pDepthMarketData, "InstrumentID", "") or "")
                    if iid:
                        self._tick_buf[iid] = {
                            "instrument": iid,
                            "last_price": _sanitize_price(
                                _field(pDepthMarketData, "LastPrice", 0)
                            ),
                            "settlement_price": _sanitize_price(
                                _field(pDepthMarketData, "SettlementPrice", 0)
                            ),
                            "exchange": str(
                                _field(pDepthMarketData, "ExchangeID", "") or ""
                            ),
                        }
            finally:
                if bIsLast:
                    self.tick_done.set()

        def _qry_instrument(
            self, instrument: str, exchange: str = "", timeout: float = 12.0
        ) -> None:
            self._qry_error = None
            self.instrument_done.clear()
            time.sleep(_QRY_GAP)
            req = tdapi.CThostFtdcQryInstrumentField()
            req.InstrumentID = instrument
            if exchange:
                req.ExchangeID = exchange
            add_log(f"ReqQryInstrument {instrument}")
            self.api.ReqQryInstrument(req, 0)
            self._wait_qry_soft(self.instrument_done, f"合约{instrument}", timeout)

        def _qry_tick(
            self, instrument: str, exchange: str = "", timeout: float = 12.0
        ) -> None:
            self._qry_error = None
            self.tick_done.clear()
            time.sleep(_QRY_GAP)
            req = tdapi.CThostFtdcQryDepthMarketDataField()
            req.InstrumentID = instrument
            if exchange:
                req.ExchangeID = exchange
            add_log(f"ReqQryDepthMarketData {instrument}")
            self.api.ReqQryDepthMarketData(req, 0)
            self._wait_qry_soft(self.tick_done, f"行情{instrument}", timeout)

        def _load_option_meta_and_ticks(
            self,
            positions: list[dict[str, Any]],
            timeout: float = 12.0,
        ) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
            """Fetch instrument + last price for option-like positions only."""
            uniq: dict[str, str] = {}
            for p in positions:
                inst = str(p.get("instrument") or "")
                if not inst:
                    continue
                if inst not in uniq:
                    uniq[inst] = str(p.get("exchange") or "")

            # Avoid querying every futures contract: ID heuristic first
            candidates = [
                (iid, ex) for iid, ex in uniq.items() if _looks_like_option_id(iid)
            ]
            instruments: dict[str, dict[str, Any]] = {}
            ticks: dict[str, dict[str, Any]] = {}
            if not candidates:
                return instruments, ticks

            for iid, ex in candidates:
                self._qry_instrument(iid, ex, timeout=timeout)
                meta = self._instrument_buf.get(iid)
                if meta:
                    instruments[iid] = meta
                    ex = str(meta.get("exchange") or ex)
                if not _is_option_meta(meta, iid):
                    continue
                self._qry_tick(iid, ex, timeout=timeout)
                tick = self._tick_buf.get(iid)
                if tick:
                    ticks[iid] = tick

            add_log(
                f"Option meta instruments={len(instruments)} ticks={len(ticks)} "
                f"candidates={len(candidates)}"
            )
            return instruments, ticks

        def query_settlement(
            self,
            trading_day: str,
            timeout: float = _DEFAULT_TIMEOUT,
            *,
            allow_empty: bool = False,
        ) -> dict[str, Any]:
            """Query daily/monthly settlement bill and parse historical equity."""
            if not self.ready:
                raise CtpError("尚未登录或连接已断开, 请先点登录")
            day = _normalize_trading_day(trading_day)

            self._qry_error = None
            self._settlement_chunks = []
            self.settlement_qry_done.clear()

            time.sleep(_QRY_GAP)
            req = tdapi.CThostFtdcQrySettlementInfoField()
            req.BrokerID = self.cfg["broker"]
            req.InvestorID = self.cfg["user"]
            req.TradingDay = day
            add_log(f"ReqQrySettlementInfo TradingDay={day}")
            self.api.ReqQrySettlementInfo(req, 0)
            self._wait_qry(self.settlement_qry_done, "结算单", timeout)

            chunks = sorted(self._settlement_chunks, key=lambda x: x[0])
            content = "".join(c for _, c in chunks)
            if not content.strip():
                add_log(f"Settlement {day}: empty", "warn")
                if allow_empty:
                    return {
                        "trading_day": day,
                        "parsed": parse_settlement_text(""),
                        "content": "",
                        "chunk_count": 0,
                        "updated": _now(),
                        "status": "empty",
                    }
                raise CtpError(
                    f"结算单为空 (TradingDay={day}). "
                    "柜台可能未生成该日结算单, 或该日无结算数据"
                )
            parsed = parse_settlement_text(content)
            add_log(
                f"Settlement {day}: equity={parsed.get('equity')} "
                f"market={parsed.get('market_equity')} client={parsed.get('client_equity')} "
                f"chunks={len(chunks)} chars={len(content)}"
            )
            return {
                "trading_day": day,
                "parsed": parsed,
                "content": content,
                "chunk_count": len(chunks),
                "updated": _now(),
                "status": "ok",
            }

        def query_portfolio(self, timeout: float = _DEFAULT_TIMEOUT) -> dict[str, Any]:
            """Query account + positions + details + orders + trades (serial)."""
            if not self.ready:
                raise CtpError("尚未登录或连接已断开, 请先点登录")

            self._qry_error = None
            self.account = None
            self.positions = []
            self.orders = []
            self.trades = []
            self.details = []
            self.account_done.clear()
            self.position_done.clear()
            self.order_done.clear()
            self.trade_done.clear()
            self.detail_done.clear()

            time.sleep(_QRY_GAP)
            req_acc = tdapi.CThostFtdcQryTradingAccountField()
            req_acc.BrokerID = self.cfg["broker"]
            req_acc.InvestorID = self.cfg["user"]
            add_log("ReqQryTradingAccount ...")
            self.api.ReqQryTradingAccount(req_acc, 0)
            self._wait_qry(self.account_done, "资金账户", timeout)

            time.sleep(_QRY_GAP)
            req_pos = tdapi.CThostFtdcQryInvestorPositionField()
            req_pos.BrokerID = self.cfg["broker"]
            req_pos.InvestorID = self.cfg["user"]
            add_log("ReqQryInvestorPosition ...")
            self.api.ReqQryInvestorPosition(req_pos, 0)
            self._wait_qry(self.position_done, "持仓", timeout)

            time.sleep(_QRY_GAP)
            req_det = tdapi.CThostFtdcQryInvestorPositionDetailField()
            req_det.BrokerID = self.cfg["broker"]
            req_det.InvestorID = self.cfg["user"]
            add_log("ReqQryInvestorPositionDetail ...")
            self.api.ReqQryInvestorPositionDetail(req_det, 0)
            self._wait_qry(self.detail_done, "持仓明细", timeout)

            time.sleep(_QRY_GAP)
            req_ord = tdapi.CThostFtdcQryOrderField()
            req_ord.BrokerID = self.cfg["broker"]
            req_ord.InvestorID = self.cfg["user"]
            add_log("ReqQryOrder ...")
            self.api.ReqQryOrder(req_ord, 0)
            self._wait_qry(self.order_done, "委托", timeout)

            time.sleep(_QRY_GAP)
            req_trd = tdapi.CThostFtdcQryTradeField()
            req_trd.BrokerID = self.cfg["broker"]
            req_trd.InvestorID = self.cfg["user"]
            add_log("ReqQryTrade ...")
            self.api.ReqQryTrade(req_trd, 0)
            self._wait_qry(self.trade_done, "成交", timeout)

            positions = sorted(
                self.positions,
                key=lambda r: (r["instrument"], r["direction"], r["position_date"]),
            )
            details = sorted(
                self.details,
                key=lambda r: (r["instrument"], r["open_date"], r["trade_id"]),
                reverse=True,
            )
            orders = sorted(
                self.orders,
                key=lambda r: (r["insert_time"], r["order_sys_id"]),
                reverse=True,
            )
            trades = sorted(
                self.trades,
                key=lambda r: (r["trade_time"], r["trade_id"]),
                reverse=True,
            )

            # Fast path: provisional 市值权益 = 客户权益. Option ticks load in background
            # (CTP qry gap ~1s/leg would otherwise block the whole portfolio response).
            account = dict(self.account or {})
            client = float(account.get("client_equity") or account.get("balance") or 0)
            account["client_equity"] = round(client, 2)
            need_ticks = any(
                _looks_like_option_id(str(p.get("instrument") or "")) for p in positions
            )
            if need_ticks:
                account["market_equity"] = round(client, 2)
                account["option_long_value"] = 0.0
                account["option_short_value"] = 0.0
                account["option_legs"] = 0
                account["market_equity_pending"] = True
                account["market_equity_method"] = "客户权益(期权行情后台计算中)"
            else:
                me = compute_market_equity(account, positions, {}, {})
                account.update(me)
                account["market_equity_pending"] = False

            add_log(
                f"Query done: pos={len(positions)} details={len(details)} "
                f"orders={len(orders)} trades={len(trades)} "
                f"marketEquityPending={account.get('market_equity_pending')}"
            )
            return {
                "trading_day": self.trading_day,
                "account": account,
                "positions": positions,
                "details": details,
                "orders": orders,
                "trades": trades,
                "totals": {
                    "position_count": len(positions),
                    "detail_count": len(details),
                    "order_count": len(orders),
                    "trade_count": len(trades),
                    "use_margin": round(sum(p["use_margin"] for p in positions), 2),
                    "position_profit": round(
                        sum(p["position_profit"] for p in positions), 2
                    ),
                    "close_profit": round(sum(p["close_profit"] for p in positions), 2),
                    "detail_close_profit": round(
                        sum(d["close_profit_by_trade"] for d in details), 2
                    ),
                    "detail_position_profit": round(
                        sum(d["position_profit_by_trade"] for d in details), 2
                    ),
                    "market_equity": float(account.get("market_equity") or 0),
                    "option_long_value": float(account.get("option_long_value") or 0),
                    "option_short_value": float(account.get("option_short_value") or 0),
                },
                "updated": _now(),
                "user_masked": _mask_user(self.cfg["user"]),
                "logged_in": True,
                "market_equity_pending": bool(account.get("market_equity_pending")),
            }

        def close(self) -> None:
            add_log("Release trader api")
            self.ready = False
            try:
                self.api.RegisterSpi(None)
                self.api.Release()
            except Exception as e:
                add_log(f"Release warn: {e}", "warn")

    return CtpSession()

