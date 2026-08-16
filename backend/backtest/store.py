"""Load daily bars for a backtest. Parquet working store, not JSON kline."""

from __future__ import annotations

from backtest.market import (
    coverage,
    last_closed_iso,
    query_adj,
    query_bars,
    write_adj,
    write_bars,
)
from backtest.panel import norm_date


def fetch_daily_bars(symbol: str, num: int = 1000) -> dict:
    """Default fetch: qfq only (tests monkeypatch this). Live path uses the pair."""
    import astock

    n = max(20, min(int(num or 1000), 1000))
    out = astock.daily_bars(symbol, n, "qfq")
    return out if isinstance(out, dict) else {}


def fetch_daily_pair(symbol: str, num: int = 1000) -> tuple[dict, dict]:
    import astock

    n = max(20, min(int(num or 1000), 1000))
    raw = astock.daily_bars(symbol, n, "none") or {}
    qfq = astock.daily_bars(symbol, n, "qfq") or {}
    return raw, qfq


def _factors_from_pair(raw_bars: list[dict], qfq_bars: list[dict]) -> list[dict]:
    qfq_c = {norm_date(b.get("datetime") or b.get("date")): b.get("close") for b in qfq_bars or []}
    out = []
    for row in raw_bars or []:
        day = norm_date(row.get("datetime") or row.get("date"))
        try:
            raw_c = float(row.get("close"))
            adj_c = float(qfq_c.get(day))
        except (TypeError, ValueError):
            continue
        if day and raw_c > 0 and adj_c > 0:
            out.append({"date": day, "datetime": day, "factor": adj_c / raw_c, "source": "tencent"})
    return out


def _ingest_pair(symbol: str, raw: dict, qfq: dict, closed_end: str) -> str | None:
    raw_bars = list((raw or {}).get("bars") or [])
    qfq_bars = list((qfq or {}).get("bars") or [])
    if raw_bars:
        write_bars(symbol, raw_bars, closed_end=closed_end)
        factors = _factors_from_pair(raw_bars, qfq_bars)
        if factors:
            write_adj(symbol, factors, closed_end=closed_end)
        return (raw or {}).get("name") or (qfq or {}).get("name")
    if qfq_bars:
        write_bars(symbol, qfq_bars, closed_end=closed_end)
        write_adj(
            symbol,
            [{"date": norm_date(b.get("datetime")), "datetime": norm_date(b.get("datetime")),
              "factor": 1.0, "source": "qfq-only"} for b in qfq_bars],
            closed_end=closed_end,
        )
        return (qfq or {}).get("name")
    return None


def _ingest_flat(symbol: str, payload: dict, closed_end: str) -> str | None:
    bars = list((payload or {}).get("bars") or [])
    if not bars:
        return None
    write_bars(symbol, bars, closed_end=closed_end)
    write_adj(
        symbol,
        [{"date": norm_date(b.get("datetime") or b.get("date")),
          "datetime": norm_date(b.get("datetime") or b.get("date")),
          "factor": 1.0, "source": "flat"} for b in bars],
        closed_end=closed_end,
    )
    return (payload or {}).get("name")


def _to_panel_rows(symbol: str, start: str, end: str) -> list[dict]:
    raw_rows = [r for r in query_bars([symbol], start, end) if str(r.get("symbol") or symbol) == symbol
                or not r.get("symbol")]
    # hive scan may tag symbol; also accept untagged polars rows
    if not raw_rows:
        raw_rows = query_bars([symbol], start, end)
    factors = query_adj(symbol, start, end)
    pinned = None
    for day in sorted(factors):
        if start <= day <= end:
            pinned = factors[day]
    rows = []
    for r in raw_rows:
        day = norm_date(r.get("date") or r.get("datetime"))
        if not day:
            continue
        close = r.get("close")
        fac = factors.get(day)
        if fac and pinned:
            adj_close = (close or 0) * fac / pinned
        else:
            adj_close = close
        rows.append({
            "datetime": day,
            "open": r.get("open"),
            "high": r.get("high"),
            "low": r.get("low"),
            "close": close,
            "adj_close": adj_close,
            "volume": r.get("volume"),
        })
    rows.sort(key=lambda x: x["datetime"])
    return rows


def panel_hash(symbols: list[str], start: str, end: str) -> str | None:
    """Hash the parquet panel only. No network, do not rewrite a run."""
    from backtest.panel import build_panel

    bars: dict[str, list[dict]] = {}
    for sym in symbols:
        rows = _to_panel_rows(sym, start, end)
        if rows:
            bars[sym] = rows
    if not bars:
        return None
    return build_panel(bars).data_hash()


def ensure_bars(
    symbol: str,
    start: str,
    end: str,
    *,
    fetch_fn=None,
    use_cache: bool = True,
) -> dict:
    """Return raw+adj rows in [start, end], clipped to the last closed session."""
    closed = last_closed_iso()
    end = min(end, closed)
    if start > end:
        return {"symbol": symbol, "name": "", "bars": [], "error": "区间还没有已收盘日 K"}

    rows = _to_panel_rows(symbol, start, end) if use_cache else []
    cov = coverage(symbol) if use_cache else None
    covered = bool(rows) and cov and cov[0] <= start and cov[1] >= end
    name = ""
    if not covered:
        fetch = fetch_fn or fetch_daily_bars
        if fetch is fetch_daily_bars and fetch_fn is None:
            raw, qfq = fetch_daily_pair(symbol)
            name = _ingest_pair(symbol, raw, qfq, closed) or ""
            if not (raw.get("bars") or qfq.get("bars")):
                return {"symbol": symbol, "name": "", "bars": [], "error": f"未取到 {symbol} 的日 K"}
        else:
            payload = fetch(symbol) or {}
            name = _ingest_flat(symbol, payload, closed) or ""
            if not payload.get("bars"):
                return {"symbol": symbol, "name": name, "bars": [], "error": f"未取到 {symbol} 的日 K"}
        rows = _to_panel_rows(symbol, start, end)
        cov = coverage(symbol)

    if not rows:
        return {"symbol": symbol, "name": name, "bars": [], "error": f"{symbol} 这段没有日 K"}
    return {
        "symbol": symbol,
        "name": name,
        "adjust": "raw+factor",
        "source": "parquet",
        "bars": rows,
        "available": list(cov) if cov else [rows[0]["datetime"], rows[-1]["datetime"]],
        "closed_end": closed,
    }
