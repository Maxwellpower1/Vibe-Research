"""Research desk: extra feeds, correlation, ETF look-through, 13F QoQ."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

import correlation
import etf_lookthrough
import ext_feeds
import inst_13f
from api_common import _cached

router = APIRouter(tags=["research"])


@router.get("/api/research/sources")
def research_sources():
    return {"data": ext_feeds.available_sources()}


@router.get("/api/research/kline")
def research_kline(
    symbol: str = Query(..., min_length=1, max_length=24),
    source: str = Query("auto"),
    num: int = Query(180, ge=5, le=2000),
    interval: str = Query("1D"),
):
    src = (source or "auto").lower()
    allowed = {"auto", "stooq", "baostock", "okx", "binance", "ccxt", "pykrx"}
    if src not in allowed:
        raise HTTPException(400, f"source 仅支持 {sorted(allowed)}")
    try:
        data = _cached(
            f"rs_kline:{src}:{interval}:{num}",
            symbol.strip(),
            300,
            lambda: ext_feeds.fetch_kline(symbol.strip(), num=num, source=src, interval=interval),
        )
    except Exception as e:
        raise HTTPException(502, f"研究 K 线异常: {e}") from e
    if data.get("error"):
        need = data.get("need")
        raise HTTPException(501 if need else 502, data["error"])
    if not data.get("bars"):
        raise HTTPException(404, f"未取到 {symbol} 的 K 线")
    return {"data": data}


@router.get("/api/research/correlation")
def research_correlation(
    codes: str = Query(..., description="逗号分隔, 最多 12 个"),
    window: int = Query(60, ge=20, le=250),
):
    symbols = [c.strip() for c in codes.split(",") if c.strip()]
    if len(symbols) < 2:
        raise HTTPException(400, "至少 2 个代码")
    try:
        data = _cached(
            f"rs_corr:{window}",
            ",".join(s.upper() for s in symbols),
            600,
            lambda: correlation.correlation_matrix(symbols, window=window),
        )
    except Exception as e:
        raise HTTPException(502, f"相关性计算异常: {e}") from e
    if data.get("error") and not data.get("matrix"):
        raise HTTPException(502, data["error"])
    return {"data": data}


@router.get("/api/research/etf-holdings")
def research_etf(
    symbol: str = Query(..., min_length=1, max_length=12),
    market: str = Query("auto"),
):
    mkt = (market or "auto").upper()
    if mkt not in {"AUTO", "CN", "US"}:
        raise HTTPException(400, "market 仅支持 auto / CN / US")
    try:
        data = etf_lookthrough.etf_holdings(symbol.strip(), market=mkt)
    except Exception as e:
        raise HTTPException(502, f"ETF 穿透异常: {e}") from e
    if data.get("error"):
        raise HTTPException(502, data["error"])
    return {"data": data}


@router.get("/api/research/13f")
def research_13f(
    manager: str | None = Query(None),
    cik: str | None = Query(None),
    ticker: str | None = Query(None),
    top: int = Query(40, ge=5, le=200),
):
    if not manager and not cik and not ticker:
        raise HTTPException(400, "请提供 manager / cik / ticker 之一")
    try:
        data = inst_13f.query_13f(manager=manager, cik=cik, ticker=ticker, top=top)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(502, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"13F 异常: {e}") from e
    if data.get("error"):
        raise HTTPException(502, data["error"])
    return {"data": data}
