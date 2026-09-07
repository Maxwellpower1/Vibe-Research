"""easy_tdx 通达信报价.

A 股: TdxClient.get_security_quotes (7709).
港股/美股: MacExClient.goods_quotes (7727, CLI ex quote).
金银油分时: MacExClient.goods_tick_chart, 挂同一把 commodity_minutes.
点开个股才取报价. 腾讯空了才补进 quotes_map. 不进预热, 不另开报价轮询.
未装 easy-tdx 时 HTTP 501; 报价中心 / 商品分时静默跳过. 期货快照仍走 futures_quotes.
"""
from __future__ import annotations

import logging
import re
from typing import Any

import astock

log = logging.getLogger("tdx_quote")

_ASHARE = re.compile(r"^(?:sh|sz|bj)\d{6}$", re.I)
_HK_STOCK = re.compile(r"^(?:hk)?(\d{5})$", re.I)
_US_STOCK = re.compile(r"^(?:us)?([A-Za-z]{1,5})$")
_MKT = {"sh": "SH", "sz": "SZ", "bj": "BJ"}
_HK_INDEX = frozenset({"hkhsi", "hkhstech"})
_US_INDEX = frozenset({"usdji", "usixic", "usinx", "usvix", "ussoxx"})
# Cockpit hf_ -> (ExMarket name, TDX code). Futures, not London spot.
EX_MINUTE = {
    "hf_xau": ("COMEX_FUTURES", "GC00W"),
    "hf_si": ("COMEX_FUTURES", "SI00W"),
    "hf_cl": ("NYMEX_FUTURES", "CL00W"),
}


def _num(v: Any) -> float:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0.0
    if n != n:
        return 0.0
    return n


def _pair(code: str) -> tuple[str, str, str] | None:
    """(Market name, 6 digits, catalog symbol) or None."""
    sym = astock.resolve_symbol(code)
    if not _ASHARE.fullmatch(sym):
        return None
    mkt = _MKT.get(sym[:2].lower())
    if not mkt:
        return None
    return mkt, sym[2:], sym


def _rows(raw: Any) -> list[dict]:
    if raw is None:
        return []
    to_dict = getattr(raw, "to_dict", None)
    if callable(to_dict):
        recs = to_dict("records")
        return recs if isinstance(recs, list) else []
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for r in raw:
        fields = getattr(r, "__dataclass_fields__", None)
        if fields:
            out.append({k: getattr(r, k) for k in fields})
        elif isinstance(r, dict):
            out.append(r)
    return out


def _pair_ex(code: str) -> tuple[str, str, str] | None:
    """(ExMarket name, native code, catalog symbol) or None."""
    raw = (code or "").strip()
    if not raw or _pair(raw):
        return None
    low = raw.lower()
    if low in _HK_INDEX or low in _US_INDEX:
        return None
    hk = _HK_STOCK.fullmatch(raw)
    if hk:
        digits = hk.group(1).zfill(5)
        return "HK_MAIN_BOARD", digits, f"hk{digits}"
    us = _US_STOCK.fullmatch(raw)
    if us:
        ticker = us.group(1).upper()
        return "US_STOCK", ticker, f"us{ticker}"
    return None


def can_fill(code: str) -> bool:
    return _pair(code) is not None or _pair_ex(code) is not None


def _pair_ex_min(code: str) -> tuple[str, str, str] | None:
    """(ExMarket name, TDX code, catalog symbol) or None."""
    raw = (code or "").strip()
    hit = EX_MINUTE.get(raw.lower())
    if not hit:
        return None
    mkt, tdx = hit
    return mkt, tdx, raw


def can_ex_minute(code: str) -> bool:
    return _pair_ex_min(code) is not None


def _hm(v: Any) -> str:
    if v is None:
        return ""
    fmt = getattr(v, "strftime", None)
    if callable(fmt):
        try:
            out = fmt("%H:%M")
        except Exception:
            out = None
        if isinstance(out, str) and out:
            return out
    s = str(v).strip()
    if " " in s:
        s = s.split()[-1]
    parts = s.split(":")
    if len(parts) < 2:
        return ""
    try:
        return f"{int(parts[0]):02d}:{int(parts[1]):02d}"
    except ValueError:
        return ""


def _charts(row: dict) -> list[dict]:
    raw = row.get("charts")
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    return []


def _levels(row: dict, side: str) -> list[dict]:
    out: list[dict] = []
    for i in range(1, 6):
        if i == 1:
            px = _num(row.get(f"{side}{i}") or row.get(f"{side}_price") or row.get(f"{side}1_price"))
            vol = _num(row.get(f"{side}_vol{i}") or row.get(f"{side}_volume") or row.get(f"{side}1_volume"))
        else:
            px = _num(row.get(f"{side}{i}") or row.get(f"{side}{i}_price"))
            vol = _num(row.get(f"{side}_vol{i}") or row.get(f"{side}{i}_volume"))
        if px <= 0 and vol <= 0:
            continue
        out.append({"px": px, "vol": vol})
    return out


def _item(row: dict, canon: str, *, source: str = "tdx") -> dict:
    price = _num(row.get("price") or row.get("close"))
    prev = _num(row.get("pre_close") or row.get("prev") or row.get("last_close"))
    bids = _levels(row, "bid")
    asks = _levels(row, "ask")
    bid = bids[0]["px"] if bids else 0.0
    ask = asks[0]["px"] if asks else 0.0
    return {
        "symbol": canon,
        "name": str(row.get("name") or canon),
        "price": price,
        "prev": prev,
        "open": _num(row.get("open")),
        "high": _num(row.get("high")),
        "low": _num(row.get("low")),
        "volume": _num(row.get("vol") or row.get("volume")),
        "amount": _num(row.get("amount")),
        "bid": bid,
        "ask": ask,
        "bid_vol": bids[0]["vol"] if bids else 0.0,
        "ask_vol": asks[0]["vol"] if asks else 0.0,
        "bids": bids,
        "asks": asks,
        "time": str(row.get("server_time") or row.get("server_update_time") or ""),
        "source": source,
        "suspended": int(row.get("trading_status") or 0) == 0x8020,
    }


def _client() -> tuple[Any, Any]:
    """Saved 7709 host. Do not ping_all here; that is 5s every click."""
    try:
        from easy_tdx import Market, TdxClient  # type: ignore[import-not-found]
    except ImportError as e:
        raise astock.DependencyMissing("easy-tdx 未安装: pip install easy-tdx") from e
    return TdxClient(), Market


def _client_scan() -> tuple[Any, Any]:
    try:
        from easy_tdx import Market, TdxClient  # type: ignore[import-not-found]
    except ImportError as e:
        raise astock.DependencyMissing("easy-tdx 未安装: pip install easy-tdx") from e
    factory = getattr(TdxClient, "from_best_host", None)
    client = factory() if callable(factory) else TdxClient()
    return client, Market


def _ex_client() -> tuple[Any, Any]:
    """Saved 7727 host. Same: no ping_all on the click path."""
    try:
        from easy_tdx import ExMarket, MacExClient  # type: ignore[import-not-found]
    except ImportError as e:
        raise astock.DependencyMissing("easy-tdx 未安装: pip install easy-tdx") from e
    return MacExClient(), ExMarket


def _ex_client_scan() -> tuple[Any, Any]:
    try:
        from easy_tdx import ExMarket, MacExClient  # type: ignore[import-not-found]
    except ImportError as e:
        raise astock.DependencyMissing("easy-tdx 未安装: pip install easy-tdx") from e
    factory = getattr(MacExClient, "from_best_host", None)
    client = factory() if callable(factory) else MacExClient()
    return client, ExMarket


def _run_ashare(fn):
    client, Market = _client()
    try:
        with client as c:
            return fn(c, Market)
    except astock.DependencyMissing:
        raise
    except Exception:
        log.warning("tdx 7709 host dead, rescan")
        client, Market = _client_scan()
        with client as c:
            return fn(c, Market)


def _run_ex(fn):
    client, ExMarket = _ex_client()
    try:
        with client as c:
            return fn(c, ExMarket)
    except astock.DependencyMissing:
        raise
    except Exception:
        log.warning("tdx 7727 host dead, rescan")
        client, ExMarket = _ex_client_scan()
        with client as c:
            return fn(c, ExMarket)


def _ex_fields() -> Any:
    try:
        from easy_tdx.codec.bitmap import PresetField  # type: ignore[import-not-found]

        return PresetField.COMMON + PresetField.HANDICAP
    except Exception:
        return None


def fetch_quotes(codes: list[str]) -> dict[str, dict]:
    """Catalog-keyed quotes. Raises DependencyMissing if the package is absent."""
    wanted: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for raw in codes:
        hit = _pair(raw)
        if not hit or hit[2] in seen:
            continue
        seen.add(hit[2])
        wanted.append(hit)
        if len(wanted) >= 80:
            break
    if not wanted:
        return {}

    def _pull(c, Market):
        pairs = [(Market[mkt], digits) for mkt, digits, _canon in wanted]
        return c.get_security_quotes(pairs)

    raw = _run_ashare(_pull)
    by_digits = {}
    for row in _rows(raw):
        digits = str(row.get("code") or "").zfill(6)
        if digits:
            by_digits[digits] = row
    out: dict[str, dict] = {}
    for _mkt, digits, canon in wanted:
        row = by_digits.get(digits)
        if not row:
            continue
        item = _item(row, canon)
        if not item.get("price"):
            continue
        out[canon] = item
        out[digits] = item
    return out


def fetch_ex_quotes(codes: list[str]) -> dict[str, dict]:
    """HK / US quotes via MacExClient.goods_quotes. Raises DependencyMissing."""
    wanted: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for raw in codes:
        hit = _pair_ex(raw)
        if not hit or hit[2] in seen:
            continue
        seen.add(hit[2])
        wanted.append(hit)
        if len(wanted) >= 80:
            break
    if not wanted:
        return {}
    fields = _ex_fields()

    def _pull(c, ExMarket):
        pairs = [(ExMarket[mkt], code) for mkt, code, _canon in wanted]
        return c.goods_quotes(pairs, fields) if fields is not None else c.goods_quotes(pairs)

    raw = _run_ex(_pull)
    by_code: dict[str, dict] = {}
    for row in _rows(raw):
        key = str(row.get("code") or "").strip()
        if key:
            by_code[key] = row
            by_code[key.upper()] = row
    out: dict[str, dict] = {}
    for _mkt, code, canon in wanted:
        row = by_code.get(code) or by_code.get(code.upper())
        if not row:
            continue
        item = _item(row, canon, source="tdx-ex")
        if not item.get("price"):
            continue
        out[canon] = item
        out[code] = item
    return out


def quotes_for_hub(codes: list[str]) -> dict[str, dict]:
    """Hub fill-in. Missing package or a dead host stays empty."""
    out: dict[str, dict] = {}
    ashare = [c for c in codes if _pair(c)]
    exo = [c for c in codes if _pair_ex(c)]
    if ashare:
        try:
            out.update(fetch_quotes(ashare))
        except astock.DependencyMissing:
            pass
        except Exception:
            log.exception("tdx quotes skipped")
    if exo:
        try:
            out.update(fetch_ex_quotes(exo))
        except astock.DependencyMissing:
            pass
        except Exception:
            log.exception("tdx ex quotes skipped")
    return out


def depth(code: str) -> dict:
    """One book. A-share 7709, HK/US 7727. Raises DependencyMissing / ValueError."""
    hit = _pair(code)
    if hit:
        return fetch_quotes([hit[2]]).get(hit[2]) or {}
    exo = _pair_ex(code)
    if exo:
        return fetch_ex_quotes([exo[2]]).get(exo[2]) or {}
    raise ValueError("只支持沪深北 A 股 / 港股 / 美股")


def fetch_ex_minutes(codes: list[str]) -> dict[str, dict]:
    """hf_XAU/SI/CL tick charts. Same shape as future_minute. Raises DependencyMissing."""
    wanted: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for raw in codes:
        hit = _pair_ex_min(raw)
        if not hit or hit[2].lower() in seen:
            continue
        seen.add(hit[2].lower())
        wanted.append(hit)
        if len(wanted) >= 8:
            break
    if not wanted:
        return {}

    def _pull(c, ExMarket):
        out: dict[str, dict] = {}
        for mkt, tdx, canon in wanted:
            raw = c.goods_tick_chart(ExMarket[mkt], tdx)
            rows = _rows(raw)
            if not rows:
                continue
            row = rows[0]
            pts: list[dict] = []
            for ch in _charts(row):
                t = _hm(ch.get("time"))
                p = _num(ch.get("price"))
                if not t or p <= 0:
                    continue
                v = _num(ch.get("vol"))
                pt = {"t": t, "p": p}
                if v > 0:
                    pt["v"] = v
                pts.append(pt)
            if not pts:
                continue
            out[canon] = {
                "code": canon,
                "prec": _num(row.get("pre_close")),
                "points": pts,
                "source": "tdx",
            }
        return out

    return _run_ex(_pull)


def minutes_for_hub(codes: list[str]) -> dict[str, dict]:
    """Commodity-minutes fill-in. Missing package or a dead host stays empty."""
    if not any(can_ex_minute(c) for c in codes):
        return {}
    try:
        return fetch_ex_minutes(codes)
    except astock.DependencyMissing:
        return {}
    except Exception:
        log.exception("tdx minutes skipped")
        return {}
