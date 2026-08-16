"""US/HK movers boards."""
from __future__ import annotations

import astock
from gstock_deep.common import _UA

_MKT_FS = {
    "us_nasdaq": "m:105",
    "us_nyse": "m:106",
    "us_etf": "m:107",
    "hk": "m:116",
}


def market_stock_list(
    market: str = "us_nasdaq",
    sort_field: str = "f3",
    sort_desc: bool = True,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """Eastmoney push2 clist ranking (change% / volume / amount).

    Uses fltt=2 (already-scaled floats) and push2 -> push2delay failover.
    """
    fs = _MKT_FS.get(market, market)
    if not fs.startswith("m:"):
        return {}
    fid = sort_field if sort_field in ("f2", "f3", "f5", "f6", "f7") else "f3"
    params = {
        "fs": fs,
        "fields": "f2,f3,f4,f5,f6,f7,f12,f14",
        "pn": max(1, int(page or 1)),
        "pz": max(5, min(int(page_size or 20), 50)),
        "fid": fid,
        "po": 1 if sort_desc else 0,
        "np": 1,
        "fltt": 2,
        "invt": 2,
    }
    data: dict = {}
    for host in ("push2.eastmoney.com", "push2delay.eastmoney.com"):
        try:
            r = astock.em_get(
                f"https://{host}/api/qt/clist/get",
                params=params,
                headers={"User-Agent": _UA},
                timeout=15,
            )
            data = (r.json() or {}).get("data") or {}
            if data.get("diff"):
                break
        except Exception:
            continue
    diff = data.get("diff") or []
    if isinstance(diff, dict):
        diff = list(diff.values())

    def _num(v):
        return float(v) if isinstance(v, (int, float)) else None

    stocks = []
    for item in diff:
        if not isinstance(item, dict):
            continue
        chg = _num(item.get("f3"))
        amp = _num(item.get("f7"))
        stocks.append({
            "code": item.get("f12"),
            "name": item.get("f14"),
            "price": _num(item.get("f2")),
            "change_pct": round(chg, 2) if chg is not None else None,
            "volume": _num(item.get("f5")),
            "amount": _num(item.get("f6")),
            "amplitude": round(amp, 2) if amp is not None else None,
        })
    return {
        "market": market,
        "sort_field": fid,
        "sort_desc": sort_desc,
        "total": data.get("total") or len(stocks),
        "stocks": stocks,
    }


def market_movers(board: str = "us_gainers", top: int = 20) -> dict:
    """Convenience boards for US/HK movers."""
    n = max(5, min(int(top or 20), 50))
    presets = {
        "us_gainers": ("us_nasdaq", "f3", True),
        "us_losers": ("us_nasdaq", "f3", False),
        "us_amount": ("us_nasdaq", "f6", True),
        "hk_gainers": ("hk", "f3", True),
        "hk_losers": ("hk", "f3", False),
        "hk_amount": ("hk", "f6", True),
    }
    if board not in presets:
        board = "us_gainers"
    market, fid, desc = presets[board]
    data = market_stock_list(market, fid, desc, page=1, page_size=n)
    data["board"] = board
    return data

