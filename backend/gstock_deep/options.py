"""CBOE delayed options overview (personal research only)."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import gstock
from gstock_deep.common import DataNotAvailable
from gstock_deep.official import official_get
from gstock_deep.yahoo import _resolve_yahoo, to_yahoo_symbol

CBOE_BASE = "https://cdn.cboe.com/api/global/delayed_quotes"
_OSI = re.compile(
    r"^(?P<root>[A-Z][A-Z0-9]*)(?P<y>\d{2})(?P<m>\d{2})(?P<d>\d{2})"
    r"(?P<cp>[CP])(?P<strike>\d{8})$"
)

try:
    from zoneinfo import ZoneInfo

    _ET_TZ = ZoneInfo("America/New_York")
except Exception:
    _ET_TZ = None


def assert_us_ticker(ticker: str) -> str:
    t = str(ticker).strip().upper()
    if t.endswith(".HK") or (t.isdigit() and len(t) in (4, 5)):
        raise ValueError(f"'{ticker}' looks like HK; CBOE options are US-only")
    if not t.replace(".", "").replace("-", "").isalnum():
        raise ValueError(f"invalid ticker: '{ticker}'")
    return t.replace(".", "-")


def parse_osi(symbol: str) -> dict:
    m = _OSI.match(symbol or "")
    if not m:
        return {}
    g = m.groupdict()
    return {
        "expiry": f"20{g['y']}-{g['m']}-{g['d']}",
        "type": "call" if g["cp"] == "C" else "put",
        "strike": int(g["strike"]) / 1000.0,
    }


def _et_today() -> str:
    now = datetime.now(timezone.utc)
    if _ET_TZ is not None:
        return now.astimezone(_ET_TZ).strftime("%Y-%m-%d")
    y = now.year
    mar8 = datetime(y, 3, 8, tzinfo=timezone.utc)
    dst_start = (mar8 + timedelta(days=(6 - mar8.weekday()) % 7)).replace(hour=7)
    nov1 = datetime(y, 11, 1, tzinfo=timezone.utc)
    dst_end = (nov1 + timedelta(days=(6 - nov1.weekday()) % 7)).replace(hour=6)
    offset = 4 if dst_start <= now < dst_end else 5
    return (now - timedelta(hours=offset)).strftime("%Y-%m-%d")


def options_chain_cboe(ticker: str) -> dict:
    """Full delayed CBOE chain. Personal research only (compliance tier C)."""
    ticker = assert_us_ticker(ticker)
    raw = official_get(f"{CBOE_BASE}/options/{ticker}.json", as_json=True)
    data = raw.get("data") or {}
    contracts = []
    for o in data.get("options") or []:
        meta = parse_osi(o.get("option", ""))
        if not meta:
            continue
        contracts.append({
            "symbol": o["option"], **meta,
            "bid": o.get("bid"), "ask": o.get("ask"),
            "volume": o.get("volume") or 0,
            "open_interest": o.get("open_interest") or 0,
            "iv": o.get("iv"), "delta": o.get("delta"), "gamma": o.get("gamma"),
            "vega": o.get("vega"), "theta": o.get("theta"), "rho": o.get("rho"),
            "last_trade_price": o.get("last_trade_price"),
        })
    if not contracts:
        raise DataNotAvailable(
            f"{ticker}: no option contracts (may be unsupported on CBOE)"
        )
    return {
        "ticker": ticker,
        "timestamp": raw.get("timestamp"),
        "spot": data.get("current_price"),
        "contracts": contracts,
    }


def filter_expiry(chain: dict, expiry: str | None = None,
                  dte_max: int | None = None) -> list[dict]:
    cs = chain["contracts"]
    if expiry == "0DTE":
        today = _et_today()
        return [c for c in cs if c["expiry"] == today]
    if expiry:
        return [c for c in cs if c["expiry"] == expiry]
    if dte_max is not None:
        today = datetime.strptime(_et_today(), "%Y-%m-%d")
        return [
            c for c in cs
            if 0 <= (datetime.strptime(c["expiry"], "%Y-%m-%d") - today).days <= dte_max
        ]
    return cs


def unusual_activity(contracts: list[dict], min_volume: int = 500,
                     vol_oi_min: float = 1.0) -> list[dict]:
    out = []
    for c in contracts:
        vol, oi = c["volume"], c["open_interest"]
        if vol < min_volume:
            continue
        ratio = vol / oi if oi > 0 else float("inf")
        if ratio >= vol_oi_min:
            out.append({
                **c,
                "vol_oi_ratio": round(ratio, 2) if oi > 0 else None,
            })
    return sorted(out, key=lambda x: -x["volume"])


def chain_summary(contracts: list[dict]) -> dict:
    calls = [c for c in contracts if c["type"] == "call"]
    puts = [c for c in contracts if c["type"] == "put"]
    cv = sum(c["volume"] for c in calls)
    pv = sum(c["volume"] for c in puts)
    coi = sum(c["open_interest"] for c in calls)
    poi = sum(c["open_interest"] for c in puts)
    traded = [c for c in contracts if c["volume"] > 0 and c.get("iv")]
    tot_v = sum(c["volume"] for c in traded)
    vwiv = sum(c["iv"] * c["volume"] for c in traded) / tot_v if tot_v else None
    net_delta = sum((c.get("delta") or 0) * c["volume"] * 100 for c in contracts)
    return {
        "call_volume": cv,
        "put_volume": pv,
        "put_call_volume_ratio": round(pv / cv, 3) if cv else None,
        "call_oi": coi,
        "put_oi": poi,
        "put_call_oi_ratio": round(poi / coi, 3) if coi else None,
        "volume_weighted_iv": round(vwiv, 4) if vwiv else None,
        "net_delta_exposure_shares": round(net_delta),
        "contracts_total": len(contracts),
        "contracts_traded": len([c for c in contracts if c["volume"] > 0]),
    }


def _slim_contract(c: dict) -> dict:
    return {
        "symbol": c.get("symbol"),
        "expiry": c.get("expiry"),
        "type": c.get("type"),
        "strike": c.get("strike"),
        "bid": c.get("bid"),
        "ask": c.get("ask"),
        "volume": c.get("volume"),
        "open_interest": c.get("open_interest"),
        "iv": c.get("iv"),
        "delta": c.get("delta"),
        "gamma": c.get("gamma"),
        "vega": c.get("vega"),
        "theta": c.get("theta"),
        "last_trade_price": c.get("last_trade_price"),
        "vol_oi_ratio": c.get("vol_oi_ratio"),
    }


def _atm_slice(contracts: list[dict], spot: float | None, n: int = 6) -> list[dict]:
    """Nearest strikes around spot (calls+puts), for a compact ATM view."""
    if not contracts or spot is None:
        return []
    strikes = sorted({c["strike"] for c in contracts if c.get("strike") is not None})
    if not strikes:
        return []
    nearest = sorted(strikes, key=lambda s: abs(s - spot))[: max(1, n)]
    want = set(nearest)
    rows = [c for c in contracts if c.get("strike") in want]
    rows.sort(key=lambda c: (c["strike"], 0 if c["type"] == "call" else 1))
    return [_slim_contract(c) for c in rows]


def options_overview(query: str, unusual_top: int = 15) -> dict:
    """Dashboard-friendly CBOE options package (US only).

    Returns summaries + unusual flow + ATM 0DTE slice; not the full chain
    (thousands of contracts) to keep API payload small.
    """
    info = gstock.resolve_symbol(query)
    if not info or info.get("market") not in ("NASDAQ", "NYSE", "US"):
        return {}
    ticker = assert_us_ticker(info["code"])
    try:
        chain = options_chain_cboe(ticker)
    except DataNotAvailable:
        return {}
    except Exception:
        return {}

    zero = filter_expiry(chain, expiry="0DTE")
    near = filter_expiry(chain, dte_max=7)
    expiries = sorted({c["expiry"] for c in chain["contracts"]})
    top_n = max(5, min(int(unusual_top or 15), 40))

    flow_0dte = [_slim_contract(c) for c in unusual_activity(zero, min_volume=200)[:top_n]]
    flow_near = [_slim_contract(c) for c in unusual_activity(near, min_volume=500)[:top_n]]

    return {
        "code": info["code"],
        "name": info["name"],
        "market": info["market"],
        "ticker": ticker,
        "timestamp": chain.get("timestamp"),
        "spot": chain.get("spot"),
        "et_today": _et_today(),
        "compliance": "C",
        "note": (
            "CBOE delayed quotes; personal research only. "
            "Commercial use requires Cboe license. Not for live trading."
        ),
        "expiries": expiries[:24],
        "summary_all": chain_summary(chain["contracts"]),
        "summary_0dte": chain_summary(zero) if zero else None,
        "summary_7d": chain_summary(near) if near else None,
        "unusual_0dte": flow_0dte,
        "unusual_7d": flow_near,
        "atm_0dte": _atm_slice(zero, chain.get("spot"), n=5),
    }

