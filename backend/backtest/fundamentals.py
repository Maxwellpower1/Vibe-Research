"""A-share financials with announce_date. Point-in-time, not report-date leak.

Hangs on fin_window F10 MAINFINADATA (NOTICE_DATE / REPORT_DATE).
Writes np / revenue / roe into the existing fundamentals/ hive.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

import astock
import fin_window as fw
from backtest.market import fundamentals_path, write_fundamentals
from backtest.panel import norm_date

log = logging.getLogger(__name__)

FIELDS = {
    "np": "PARENTNETPROFIT",
    "revenue": "TOTALOPERATEREVE",
    "roe": "ROEJQ",
}


def _num(raw: object) -> float | None:
    if raw is None or raw == "" or raw == "-":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def rows_from_f10(raw_rows: list[dict], *, source: str = "eastmoney-f10") -> list[dict]:
    """Map F10 rows. Skip a period when NOTICE_DATE is missing."""
    out: list[dict] = []
    for row in raw_rows or []:
        if not isinstance(row, dict):
            continue
        ann = norm_date(row.get("NOTICE_DATE") or row.get("announce_date"))
        end = norm_date(row.get("REPORT_DATE") or row.get("end"))
        if not ann or not end:
            continue
        start = f"{end[:4]}-01-01"
        for field, key in FIELDS.items():
            val = _num(row.get(key) if key in row else row.get(field))
            if val is None:
                continue
            out.append({
                "field": field,
                "start": start,
                "end": end,
                "announce_date": ann,
                "value": val,
                "source": source,
            })
    return out


def fetch_f10(symbol: str) -> list[dict]:
    secu = fw.secu_code(symbol)
    if not secu:
        return []
    filt = f'(SECUCODE="{secu}")'
    try:
        raw = fw._f10_rows("RPT_F10_FINANCE_MAINFINADATA", filt, 24, "REPORT_DATE")
    except Exception as e:  # noqa: BLE001
        log.info("f10 %s failed: %s", symbol, e)
        return []
    return raw if isinstance(raw, list) else []


def ensure_fundamentals(
    symbols: list[str],
    *,
    fetch_fn: Callable[[str], list[dict]] | None = None,
    skip_existing: bool = True,
) -> dict:
    """Write PIT facts for these names. Skip a file that already has rows."""
    getter = fetch_fn or fetch_f10
    ok = 0
    skip = 0
    fail = 0
    rows_n = 0
    for raw in symbols:
        sym = astock.resolve_symbol(str(raw))
        if not sym:
            fail += 1
            continue
        if skip_existing and fundamentals_path(sym).is_file():
            skip += 1
            continue
        try:
            mapped = rows_from_f10(getter(sym))
            n = write_fundamentals(sym, mapped) if mapped else 0
        except Exception as e:  # noqa: BLE001
            log.info("fundamentals %s failed: %s", sym, e)
            fail += 1
            continue
        if n:
            ok += 1
            rows_n += n
        else:
            fail += 1
    return {"asked": len(symbols), "ok": ok, "skip": skip, "fail": fail, "rows": rows_n}


def sync_fundamentals(
    symbols: list[str],
    *,
    fetch_fn: Callable[[str], list[dict]] | None = None,
    workers: int = 4,
) -> dict:
    """Same as ensure, a few names in parallel. Not a second sync stack."""
    getter = fetch_fn or fetch_f10
    resolved = []
    seen: set[str] = set()
    for raw in symbols:
        sym = astock.resolve_symbol(str(raw))
        if not sym or sym in seen:
            continue
        seen.add(sym)
        resolved.append(sym)

    def one(sym: str) -> tuple[str, int, str]:
        if fundamentals_path(sym).is_file():
            return sym, 0, "skip"
        try:
            n = write_fundamentals(sym, rows_from_f10(getter(sym)))
            return sym, n, "ok" if n else "fail"
        except Exception:  # noqa: BLE001
            return sym, 0, "fail"

    ok = skip = fail = rows_n = 0
    if not resolved:
        return {"asked": 0, "ok": 0, "skip": 0, "fail": 0, "rows": 0}
    workers = max(1, min(int(workers or 1), 8, len(resolved)))
    if workers == 1:
        results = [one(sym) for sym in resolved]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(one, resolved))
    for _sym, n, state in results:
        if state == "skip":
            skip += 1
        elif state == "ok":
            ok += 1
            rows_n += n
        else:
            fail += 1
    return {"asked": len(resolved), "ok": ok, "skip": skip, "fail": fail, "rows": rows_n}
