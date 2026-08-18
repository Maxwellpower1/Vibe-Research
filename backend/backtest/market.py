"""Partitioned parquet market store. Query in memory (DuckDB / Polars). No .db.

Layout under VR_DATA_DIR/market/:
  bars/symbol=sh600519/year=2024.parquet   raw OHLC
  adj/symbol=sh600519.parquet              date, factor (qfq_close / raw_close)
  members/index=sh000300/year=2024.parquet date, symbol
  fundamentals/symbol=sh600519.parquet     field, start, end, announce_date, value
"""

from __future__ import annotations

import os
from pathlib import Path

from backtest.panel import norm_date

try:
    import polars as pl
except ImportError:  # pragma: no cover
    pl = None  # type: ignore[assignment]


def data_root() -> Path:
    return Path(os.environ.get("VR_DATA_DIR") or (Path.home() / ".vibe-research"))


def market_root() -> Path:
    return data_root() / "market"


def _need_pl():
    if pl is None:
        raise RuntimeError("回测行情需要 polars: pip install polars pyarrow duckdb")
    return pl


def _safe(token: str) -> str:
    return "".join(c for c in (token or "") if c.isalnum() or c in ("-", "_")) or "unknown"


def _atomic_write(df, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    df.write_parquet(tmp)
    tmp.replace(path)


def _read_parquet(path: Path):
    p = _need_pl()
    if not path.is_file():
        return None
    try:
        return p.read_parquet(path)
    except Exception:
        return None


def last_closed_iso() -> str:
    import trading_calendar as tc

    return tc.last_closed_session().isoformat()


def drop_open_bars(rows: list[dict], closed_end: str | None = None) -> list[dict]:
    """Keep bars on or before the last closed session."""
    end = closed_end or last_closed_iso()
    out = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        day = norm_date(row.get("datetime") or row.get("date"))
        if day and day <= end:
            out.append({**row, "datetime": day, "date": day})
    return out


def _upsert(path: Path, incoming, keys: list[str]):
    p = _need_pl()
    old = _read_parquet(path)
    df = incoming if old is None else p.concat([old, incoming], how="diagonal_relaxed")
    df = df.unique(subset=keys, keep="last").sort(keys)
    _atomic_write(df, path)
    return df


def bars_path(symbol: str, year: str) -> Path:
    return market_root() / "bars" / f"symbol={_safe(symbol)}" / f"year={year}.parquet"


def adj_path(symbol: str) -> Path:
    return market_root() / "adj" / f"symbol={_safe(symbol)}.parquet"


def members_path(index: str, year: str) -> Path:
    return market_root() / "members" / f"index={_safe(index)}" / f"year={year}.parquet"


def fundamentals_path(symbol: str) -> Path:
    return market_root() / "fundamentals" / f"symbol={_safe(symbol)}.parquet"


def write_bars(symbol: str, rows: list[dict], *, closed_end: str | None = None) -> int:
    """Write raw daily bars. Open session is dropped."""
    p = _need_pl()
    kept = drop_open_bars(rows, closed_end)
    if not kept:
        return 0
    by_year: dict[str, list[dict]] = {}
    for row in kept:
        day = row["date"]
        by_year.setdefault(day[:4], []).append(row)
    n = 0
    for year, chunk in by_year.items():
        df = p.DataFrame({
            "date": [r["date"] for r in chunk],
            "open": [r.get("open") for r in chunk],
            "high": [r.get("high") for r in chunk],
            "low": [r.get("low") for r in chunk],
            "close": [r.get("close") for r in chunk],
            "volume": [r.get("volume") for r in chunk],
            "source": [str(r.get("source") or "tencent") for r in chunk],
        })
        _upsert(bars_path(symbol, year), df, ["date"])
        n += len(chunk)
    return n


def write_adj(symbol: str, rows: list[dict], *, closed_end: str | None = None) -> int:
    p = _need_pl()
    kept = drop_open_bars(rows, closed_end)
    if not kept:
        return 0
    df = p.DataFrame({
        "date": [r["date"] for r in kept],
        "factor": [r.get("factor") for r in kept],
        "source": [str(r.get("source") or "tencent") for r in kept],
    })
    _upsert(adj_path(symbol), df, ["date"])
    return len(kept)


def write_members(index: str, asof: str, symbols: list[str]) -> int:
    """Replace the snapshot of `index` on `asof`. Leftover names that day are dropped."""
    p = _need_pl()
    day = norm_date(asof)
    if not day:
        raise ValueError("成分快照需要日期")
    syms = [s for s in symbols if s]
    if not syms:
        return 0
    incoming = p.DataFrame({"date": [day] * len(syms), "symbol": syms})
    path = members_path(index, day[:4])
    old = _read_parquet(path)
    if old is not None:
        old = old.filter(p.col("date") != day)
        df = incoming if old.is_empty() else p.concat([old, incoming], how="diagonal_relaxed")
    else:
        df = incoming
    df = df.unique(subset=["date", "symbol"], keep="last").sort(["date", "symbol"])
    _atomic_write(df, path)
    return len(syms)


def write_fundamentals(symbol: str, rows: list[dict]) -> int:
    """Financial facts: (start, end) + announce_date. Not a point-in-time leak."""
    p = _need_pl()
    cleaned = []
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("field"):
            continue
        start = norm_date(row.get("start"))
        end = norm_date(row.get("end"))
        ann = norm_date(row.get("announce_date") or row.get("announce"))
        if not (start and end and ann):
            continue
        cleaned.append({
            "field": str(row["field"]),
            "start": start,
            "end": end,
            "announce_date": ann,
            "value": row.get("value"),
            "source": str(row.get("source") or ""),
        })
    if not cleaned:
        return 0
    df = p.DataFrame(cleaned)
    _upsert(fundamentals_path(symbol), df, ["field", "start", "end", "announce_date"])
    return len(cleaned)


def _scan_bars_polars(symbols: list[str], start: str, end: str):
    p = _need_pl()
    root = market_root() / "bars"
    if symbols:
        files = []
        for s in symbols:
            files.extend((root / f"symbol={_safe(s)}").glob("year=*.parquet"))
    else:
        files = list(root.glob("symbol=*/year=*.parquet"))
    if not files:
        return p.DataFrame(schema={"symbol": p.String, "date": p.String, "open": p.Float64,
                                   "high": p.Float64, "low": p.Float64, "close": p.Float64,
                                   "volume": p.Float64})
    frames = []
    for path in files:
        df = _read_parquet(path)
        if df is None:
            continue
        sym = path.parent.name.split("=", 1)[-1]
        df = df.with_columns(p.lit(sym).alias("symbol"))
        frames.append(df)
    if not frames:
        return p.DataFrame()
    out = p.concat(frames, how="diagonal_relaxed")
    return out.filter((p.col("date") >= start) & (p.col("date") <= end))


def query_bars(symbols: list[str], start: str, end: str) -> list[dict]:
    """Read only the asked symbol folders. Do not scan the whole hive per name."""
    root = market_root() / "bars"
    if symbols:
        files = []
        for s in symbols:
            files.extend((root / f"symbol={_safe(s)}").glob("year=*.parquet"))
        if not files:
            return []
        df = _scan_bars_polars(symbols, start, end)
        return df.to_dicts() if df is not None else []
    if not list(root.glob("symbol=*/year=*.parquet")):
        return []
    try:
        import duckdb
        pattern = (root / "*" / "*.parquet").as_posix()
        sql = (
            "SELECT * FROM read_parquet(?, hive_partitioning=true, union_by_name=true) "
            "WHERE date >= ? AND date <= ?"
        )
        con = duckdb.connect(":memory:")
        try:
            rows = con.execute(sql, [pattern, start, end]).fetchdf().to_dict("records")
            return [{k: (None if v != v else v) for k, v in r.items()} for r in rows]
        finally:
            con.close()
    except Exception:
        df = _scan_bars_polars(symbols, start, end)
        return df.to_dicts() if df is not None else []


def query_adj(symbol: str, start: str, end: str) -> dict[str, float]:
    df = _read_parquet(adj_path(symbol))
    if df is None:
        return {}
    p = _need_pl()
    df = df.filter((p.col("date") >= start) & (p.col("date") <= end))
    out: dict[str, float] = {}
    for row in df.to_dicts():
        try:
            out[str(row["date"])] = float(row["factor"])
        except (TypeError, ValueError):
            continue
    return out


def members_asof(index: str, asof: str) -> tuple[str, list[str]]:
    """Latest snapshot date and members on or before asof."""
    p = _need_pl()
    day = norm_date(asof)
    root = market_root() / "members" / f"index={_safe(index)}"
    files = list(root.glob("year=*.parquet"))
    if not files or not day:
        return "", []
    frames = [_read_parquet(f) for f in files]
    frames = [f for f in frames if f is not None]
    if not frames:
        return "", []
    df = p.concat(frames, how="diagonal_relaxed").filter(p.col("date") <= day)
    if df.is_empty():
        return "", []
    latest = str(df.select(p.col("date").max()).item())
    return latest, sorted(df.filter(p.col("date") == latest)["symbol"].to_list())


def members_on(index: str, asof: str) -> list[str]:
    """Members of the latest snapshot on or before asof."""
    _day, symbols = members_asof(index, asof)
    return symbols


def iter_snapshots(index: str) -> list[tuple[str, list[str]]]:
    """All stored snapshots, oldest first."""
    p = _need_pl()
    root = market_root() / "members" / f"index={_safe(index)}"
    files = list(root.glob("year=*.parquet"))
    if not files:
        return []
    frames = [f for f in (_read_parquet(path) for path in files) if f is not None]
    if not frames:
        return []
    df = p.concat(frames, how="diagonal_relaxed")
    if df.is_empty():
        return []
    out: list[tuple[str, list[str]]] = []
    for day in sorted({str(x) for x in df["date"].to_list()}):
        out.append((day, sorted(df.filter(p.col("date") == day)["symbol"].to_list())))
    return out


def members_union(index: str, start: str, end: str) -> list[str]:
    """Names that appear in any snapshot overlapping [start, end]."""
    start_d = norm_date(start)
    end_d = norm_date(end)
    seen: set[str] = set(members_on(index, start_d))
    for day, syms in iter_snapshots(index):
        if start_d < day <= end_d:
            seen.update(syms)
    return sorted(seen)


def members_covers(index: str, start: str) -> bool:
    """True only when a snapshot exists on or before start. Today's list does not cover last year."""
    day, symbols = members_asof(index, start)
    return bool(day and symbols)


def membership_mask(index: str, dates: list[str], symbols: list[str]):
    """(T, S) bool: in the index on that bar. Needs numpy."""
    import numpy as np

    snaps = iter_snapshots(index)
    out = np.zeros((len(dates), len(symbols)), dtype=bool)
    col = {sym: j for j, sym in enumerate(symbols)}
    k = -1
    current: list[str] = []
    for i, day in enumerate(dates):
        while k + 1 < len(snaps) and snaps[k + 1][0] <= day:
            k += 1
            current = snaps[k][1]
        for sym in current:
            j = col.get(sym)
            if j is not None:
                out[i, j] = True
    return out


def query_fundamentals(symbol: str, field: str | None = None) -> list[dict]:
    """Local PIT rows. No network."""
    df = _read_parquet(fundamentals_path(symbol))
    if df is None:
        return []
    p = _need_pl()
    if field:
        df = df.filter(p.col("field") == field)
    if df.is_empty():
        return []
    return df.sort("announce_date").to_dicts()


def fundamental_asof(symbol: str, field: str, asof: str) -> float | None:
    """Value known on asof. (start, end) is the report period; announce_date is when it is known."""
    p = _need_pl()
    day = norm_date(asof)
    df = _read_parquet(fundamentals_path(symbol))
    if df is None or not day:
        return None
    hit = df.filter((p.col("field") == field) & (p.col("announce_date") <= day))
    if hit.is_empty():
        return None
    hit = hit.sort("announce_date")
    val = hit["value"][-1]
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def coverage(symbol: str) -> tuple[str, str] | None:
    df = _scan_bars_polars([symbol], "0000-01-01", "9999-12-31")
    if df is None or df.is_empty():
        return None
    return str(df["date"].min()), str(df["date"].max())


def _tree_bytes(root: Path) -> int:
    if not root.is_dir():
        return 0
    total = 0
    for path in root.rglob("*"):
        if path.is_file():
            try:
                total += path.stat().st_size
            except OSError:
                continue
    return total


def _span(df, col: str = "date") -> tuple[str | None, str | None, int]:
    if df is None or df.is_empty() or col not in df.columns:
        return None, None, 0
    return str(df[col].min()), str(df[col].max()), int(df.height)


def inventory() -> dict:
    """Portrait of the local working store. No network."""
    import trading_calendar as tc
    from backtest.archive import list_runs, runs_root

    p = _need_pl()
    symbols: list[dict] = []
    bars_root = market_root() / "bars"
    for folder in sorted(bars_root.glob("symbol=*")):
        if not folder.is_dir():
            continue
        sym = folder.name.split("=", 1)[-1]
        frames = []
        years: list[str] = []
        for path in sorted(folder.glob("year=*.parquet")):
            df = _read_parquet(path)
            if df is None:
                continue
            years.append(path.name.replace("year=", "").replace(".parquet", ""))
            frames.append(df)
        if not frames:
            continue
        df = p.concat(frames, how="diagonal_relaxed")
        d0, d1, n = _span(df)
        adj_df = _read_parquet(adj_path(sym))
        _af, _at, an = _span(adj_df) if adj_df is not None else (None, None, 0)
        symbols.append({
            "symbol": sym,
            "bars": n,
            "from": d0,
            "to": d1,
            "years": years,
            "adj": an,
        })

    members: list[dict] = []
    for folder in sorted((market_root() / "members").glob("index=*")):
        idx = folder.name.split("=", 1)[-1]
        frames = [_read_parquet(f) for f in folder.glob("year=*.parquet")]
        frames = [f for f in frames if f is not None]
        if not frames:
            continue
        df = p.concat(frames, how="diagonal_relaxed")
        d0, d1, n = _span(df)
        snaps = int(df.select(p.col("date").n_unique()).item()) if n else 0
        members.append({"index": idx, "rows": n, "snapshots": snaps, "from": d0, "to": d1})

    funds: list[dict] = []
    for path in sorted((market_root() / "fundamentals").glob("symbol=*.parquet")):
        df = _read_parquet(path)
        d0, d1, n = _span(df, "announce_date")
        funds.append({
            "symbol": path.stem.split("=", 1)[-1],
            "rows": n,
            "from": d0,
            "to": d1,
        })

    kline_dir = data_root() / "kline"
    legacy = len(list(kline_dir.glob("*.json"))) if kline_dir.is_dir() else 0
    run_root = runs_root()
    run_count = 0
    if run_root.is_dir():
        run_count = sum(
            1 for child in run_root.iterdir()
            if child.is_dir() and not child.name.startswith(".") and (child / "meta.json").is_file()
        )
    cal = tc.status()
    preview = 80
    from backtest.universe_sync import portrait

    uni = portrait()
    return {
        "root": str(data_root()),
        "closed_end": last_closed_iso(),
        "bytes": {"market": _tree_bytes(market_root()), "runs": _tree_bytes(run_root)},
        "calendar": cal,
        "bars": {"count": len(symbols), "symbols": symbols[:preview], "preview": min(preview, len(symbols))},
        "universe": uni,
        "members": members,
        "fundamentals": funds,
        "runs": {"count": run_count, "recent": list_runs(8)},
        "legacy_kline": legacy,
        "note": "本机日历 / 日 K / 按日成分 / 财务PIT / 实验. 标的池近 3 年可点补齐, 只写已收盘 bar, 不清库.",
    }


def peek_bars(symbol: str, n: int = 30) -> dict:
    """Last n raw bars from parquet. No network."""
    n = max(1, min(int(n or 30), 80))
    rows = query_bars([symbol], "0000-01-01", "9999-12-31")
    kept = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        tag = str(row.get("symbol") or symbol)
        if tag and tag != symbol:
            continue
        day = norm_date(row.get("date") or row.get("datetime"))
        if day:
            kept.append({**row, "date": day})
    kept.sort(key=lambda r: r["date"])
    factors = query_adj(symbol, "0000-01-01", "9999-12-31")
    tail = kept[-n:]
    return {
        "symbol": symbol,
        "count": len(kept),
        "available": [kept[0]["date"], kept[-1]["date"]] if kept else None,
        "bars": [
            {
                "date": r["date"],
                "open": r.get("open"),
                "high": r.get("high"),
                "low": r.get("low"),
                "close": r.get("close"),
                "volume": r.get("volume"),
                "factor": factors.get(r["date"]),
            }
            for r in tail
        ],
    }
