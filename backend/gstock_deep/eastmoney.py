"""Eastmoney statements and daily fund-flow for US/HK."""
from __future__ import annotations

import astock
import gstock
from gstock_deep.yahoo import _resolve_yahoo

def _match_stmt_item(name: str, keys: list[str]) -> str | None:
    if not name:
        return None
    if name in keys:
        return name
    for k in keys:
        if k in name:
            return k
    return None


def financial_statements(query: str, statement: str = "income", periods: int = 5) -> dict:
    """Eastmoney three-statement key lines, pivoted by report date."""
    statement = (statement or "income").lower()
    if statement not in _STMT_REPORT:
        return {}
    info = gstock.resolve_symbol(query)
    if not info or info.get("market") == "KR":
        return {}
    market = "hk" if info["secucode"].endswith(".HK") else "us"
    report = _STMT_REPORT[statement][market]
    rows = astock.eastmoney_datacenter(
        report,
        filter_str=f'(SECUCODE="{info["secucode"]}")',
        page_size=400,
        sort_columns="REPORT_DATE",
        sort_types="-1",
    )
    if not rows:
        return {}
    keys = _STMT_KEYS[statement]
    by_period: dict[str, dict] = {}
    for r in rows:
        rd = str(r.get("REPORT_DATE") or "")[:10]
        label = _match_stmt_item(str(r.get("ITEM_NAME") or ""), keys)
        if not rd or not label:
            continue
        p = by_period.setdefault(rd, {
            "report_date": rd,
            "report": r.get("REPORT"),
            "currency": r.get("CURRENCY"),
            "items": {},
        })
        # Keep first occurrence per label (rows already newest-first overall)
        if label in p["items"]:
            continue
        amt, yoy = r.get("AMOUNT"), r.get("YOY_RATIO")
        p["items"][label] = {
            "amount": amt if isinstance(amt, (int, float)) else None,
            "yoy": yoy if isinstance(yoy, (int, float)) else None,
        }
    if not by_period:
        return {}
    periods_out = sorted(by_period.values(), key=lambda x: x["report_date"], reverse=True)[:periods]
    # Stable item order: whitelist order, only those present in any period
    present: set[str] = set()
    for p in periods_out:
        present.update(p["items"].keys())
    item_order = [k for k in keys if k in present]
    return {
        "code": info["code"],
        "name": info["name"],
        "market": info["market"],
        "statement": statement,
        "currency": periods_out[0].get("currency"),
        "item_order": item_order,
        "periods": periods_out,
    }


# ── Fund flow ─────────────────────────────────────────────────────────────

def fund_flow_daily(query: str, limit: int = 60) -> dict:
    info = gstock.resolve_symbol(query)
    if not info or info.get("market") == "KR":
        return {}
    prefix = info["secid_prefix"]
    code = info["code"]
    url = "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get"
    params = {
        "secid": f"{prefix}.{code}",
        "klt": 101,
        "fields1": "f1,f2,f3,f7",
        "fields2": "f51,f52,f53,f54,f55,f56,f57",
        "lmt": max(5, min(int(limit or 60), 200)),
    }
    try:
        r = astock.em_get(url, params=params, headers={"User-Agent": _UA}, timeout=15)
        data = (r.json() or {}).get("data") or {}
        klines = data.get("klines") or []
    except Exception:
        return {}
    rows = []
    for line in klines:
        parts = str(line).split(",")
        if len(parts) < 6:
            continue
        try:
            rows.append({
                "date": parts[0],
                "main_net": float(parts[1]),
                "small_net": float(parts[2]),
                "mid_net": float(parts[3]),
                "big_net": float(parts[4]),
                "super_big_net": float(parts[5]),
                "main_pct": float(parts[6]) if len(parts) > 6 and parts[6] else None,
            })
        except (TypeError, ValueError):
            continue
    if not rows:
        return {}
    return {
        "code": info["code"], "name": info["name"], "market": info["market"],
        "rows": rows,
    }

