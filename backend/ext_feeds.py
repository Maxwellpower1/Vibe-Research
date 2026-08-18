"""Extra market-data feeds ported from Vibe-Trading loaders.

Stooq: plain HTTP, no extra package.
Baostock / pykrx: lazy import; missing package -> empty + hint.

Bars are always [{date, open, high, low, close, volume}].
"""
from __future__ import annotations

import csv
import io
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from cache import TTLCache

logger = logging.getLogger(__name__)

_UA = "Mozilla/5.0 (compatible; Vibe-Research/0.3; +https://viberesearch.wiki)"
_BJ = timezone(timedelta(hours=8))
_CACHE = TTLCache(maxsize=256, default_ttl=3600, negative_ttl=60, name="ext_feeds")

_KR_RE = re.compile(r"^(\d{6})(?:\.(?:KS|KQ))?$", re.I)
_A_RE = re.compile(r"^(?:(?:sh|sz|bj)\.)?(\d{6})(?:\.(?:SH|SZ|BJ))?$", re.I)


def available_sources() -> dict[str, dict[str, Any]]:
    """Which optional packages are installed. HTTP sources are always on."""
    return {
        "stooq": {"ok": True, "need": None, "markets": ["us"]},
        "baostock": {"ok": _has("baostock"), "need": "pip install baostock", "markets": ["a_share"]},
        "pykrx": {"ok": _has("pykrx"), "need": "pip install pykrx", "markets": ["kr"]},
    }


def _has(mod: str) -> bool:
    try:
        __import__(mod)
        return True
    except ImportError:
        return False


def _get(url: str, *, params: dict | None = None, headers: dict | None = None,
         timeout: int = 20) -> requests.Response:
    h = {"User-Agent": _UA}
    h.update(headers or {})
    r = requests.get(url, params=params, headers=h, timeout=timeout)
    r.raise_for_status()
    return r


def _bar(date: str, o: float, h: float, l: float, c: float, v: float) -> dict:
    return {
        "date": str(date)[:10],
        "open": float(o),
        "high": float(h),
        "low": float(l),
        "close": float(c),
        "volume": float(v),
    }


def _trim(bars: list[dict], num: int) -> list[dict]:
    bars = [b for b in bars if b.get("date") and b.get("close") is not None]
    bars.sort(key=lambda b: b["date"])
    n = max(5, min(int(num or 180), 2000))
    return bars[-n:]


# ---------------------------------------------------------------------------
# Stooq (US EOD CSV, no key)
# ---------------------------------------------------------------------------

def stooq_kline(symbol: str, num: int = 180) -> dict:
    """US daily bars from stooq.com CSV. symbol: AAPL / AAPL.US."""
    raw = (symbol or "").strip().upper().removesuffix(".US")
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,7}", raw):
        return {}
    ticker = raw.replace(".", "-").lower() + ".us"
    end = datetime.now(_BJ).date()
    start = end - timedelta(days=max(int(num or 180) * 3, 400))
    key = f"stooq:{ticker}:{num}"
    return _CACHE.get_or_set(key, lambda: _stooq_fetch(ticker, raw, start, end, num), ttl=3600) or {}


def _stooq_fetch(ticker: str, code: str, start, end, num: int) -> dict:
    url = "https://stooq.com/q/d/l/"
    params = {
        "s": ticker,
        "d1": start.strftime("%Y%m%d"),
        "d2": end.strftime("%Y%m%d"),
        "i": "d",
    }
    text = _get(url, params=params, timeout=20).text.strip()
    if not text or text.upper().startswith("N/D"):
        return {}
    bars: list[dict] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        try:
            bars.append(_bar(
                row.get("Date") or "",
                float(row["Open"]), float(row["High"]),
                float(row["Low"]), float(row["Close"]),
                float(row.get("Volume") or 0),
            ))
        except (TypeError, ValueError, KeyError):
            continue
    bars = _trim(bars, num)
    if not bars:
        return {}
    return {
        "code": code, "name": code, "market": "US",
        "source": "stooq", "adjust": "none", "bars": bars,
    }


# ---------------------------------------------------------------------------
# Baostock (A-share daily, optional package)
# ---------------------------------------------------------------------------

def baostock_symbol(code: str) -> str | None:
    """600519 / 600519.SH / sh.600519 -> sh.600519."""
    raw = (code or "").strip()
    m = _A_RE.match(raw)
    if not m:
        return None
    digits = m.group(1)
    low = raw.lower()
    if digits.startswith(("8", "4")):
        return None
    if low.startswith("sz") or raw.upper().endswith(".SZ") or digits.startswith(("000", "001", "002", "003", "300", "301")):
        return f"sz.{digits}"
    return f"sh.{digits}"


def baostock_kline(symbol: str, num: int = 180) -> dict:
    """A-share daily OHLCV. Volume converted from shares to board lots."""
    bs_code = baostock_symbol(symbol)
    if not bs_code:
        return {}
    if not _has("baostock"):
        return {"error": "baostock 未安装: pip install baostock", "need": "baostock"}
    key = f"baostock:{bs_code}:{num}"
    return _CACHE.get_or_set(key, lambda: _baostock_fetch(bs_code, num), ttl=3600) or {}


def _baostock_fetch(bs_code: str, num: int) -> dict:
    import baostock as bs  # type: ignore

    end = datetime.now(_BJ).date()
    start = end - timedelta(days=max(int(num or 180) * 3, 500))
    lg = bs.login()
    if getattr(lg, "error_code", "0") != "0":
        logger.warning("baostock login failed: %s", getattr(lg, "error_msg", ""))
        return {}
    try:
        rs = bs.query_history_k_data_plus(
            bs_code,
            "date,open,high,low,close,volume",
            start_date=start.isoformat(),
            end_date=end.isoformat(),
            frequency="d",
            adjustflag="2",  # 前复权
        )
        rows: list[dict] = []
        while rs.error_code == "0" and rs.next():
            rows.append(dict(zip(rs.fields, rs.get_row_data())))
    finally:
        bs.logout()
    bars: list[dict] = []
    for row in rows:
        try:
            vol_shares = float(row.get("volume") or 0)
            bars.append(_bar(
                row["date"],
                float(row["open"]), float(row["high"]),
                float(row["low"]), float(row["close"]),
                vol_shares / 100.0,  # shares -> lots
            ))
        except (TypeError, ValueError, KeyError):
            continue
    bars = _trim(bars, num)
    if not bars:
        return {}
    digits = bs_code.split(".", 1)[-1]
    return {
        "code": digits, "name": digits, "market": "CN",
        "source": "baostock", "adjust": "qfq", "bars": bars,
    }


# ---------------------------------------------------------------------------
# pykrx (KRX daily, optional package; Naver-adjusted)
# ---------------------------------------------------------------------------

def pykrx_code(symbol: str) -> str | None:
    m = _KR_RE.match((symbol or "").strip())
    return m.group(1) if m else None


def pykrx_kline(symbol: str, num: int = 180) -> dict:
    """KRX daily bars via pykrx (adjusted=True, Naver-backed)."""
    code = pykrx_code(symbol)
    if not code:
        return {}
    if not _has("pykrx"):
        return {"error": "pykrx 未安装: pip install pykrx", "need": "pykrx"}
    key = f"pykrx:{code}:{num}"
    return _CACHE.get_or_set(key, lambda: _pykrx_fetch(code, num), ttl=3600) or {}


def _pykrx_fetch(code: str, num: int) -> dict:
    from pykrx import stock  # type: ignore

    end = datetime.now(_BJ).date()
    start = end - timedelta(days=max(int(num or 180) * 3, 500))
    time.sleep(0.3)  # pykrx asks for polite spacing
    df = stock.get_market_ohlcv_by_date(
        start.strftime("%Y%m%d"), end.strftime("%Y%m%d"), code, adjusted=True,
    )
    if df is None or getattr(df, "empty", True):
        return {}
    rename = {}
    for c in df.columns:
        s = str(c)
        if s in ("시가", "Open", "open"):
            rename[c] = "open"
        elif s in ("고가", "High", "high"):
            rename[c] = "high"
        elif s in ("저가", "Low", "low"):
            rename[c] = "low"
        elif s in ("종가", "Close", "close"):
            rename[c] = "close"
        elif s in ("거래량", "Volume", "volume"):
            rename[c] = "volume"
    df = df.rename(columns=rename)
    bars: list[dict] = []
    for idx, row in df.iterrows():
        try:
            dt = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            bars.append(_bar(dt, row["open"], row["high"], row["low"], row["close"],
                             float(row.get("volume") or 0)))
        except (TypeError, ValueError, KeyError):
            continue
    bars = _trim(bars, num)
    if not bars:
        return {}
    name = code
    try:
        name = stock.get_market_ticker_name(code) or code
    except Exception:
        pass
    return {
        "code": f"{code}.KS", "name": name, "market": "KR",
        "source": "pykrx", "adjust": "qfq", "bars": bars,
    }


# ---------------------------------------------------------------------------
# Unified fetch (for correlation / research kline API)
# ---------------------------------------------------------------------------

def infer_market(symbol: str) -> str:
    raw = (symbol or "").strip().upper()
    if raw.endswith((".KS", ".KQ")):
        return "kr"
    if raw.endswith((".SH", ".SZ", ".BJ")) or (raw.isdigit() and len(raw) == 6):
        return "a_share"
    if raw.endswith(".HK") or (raw.isdigit() and len(raw) <= 5):
        return "hk"
    return "us"


def fetch_kline(symbol: str, num: int = 180, source: str = "auto",
                interval: str = "1D") -> dict:
    """Route one symbol to the right feed. source=auto uses project fallbacks."""
    market = infer_market(symbol)
    src = (source or "auto").lower()
    if src == "stooq":
        return stooq_kline(symbol, num)
    if src == "baostock":
        return baostock_kline(symbol, num)
    if src == "pykrx":
        return pykrx_kline(symbol, num)
    if src != "auto":
        return {"error": f"source 仅支持 auto / stooq / baostock / pykrx"}

    if market == "kr":
        return pykrx_kline(symbol, num)
    if market == "a_share":
        return _a_share_auto(symbol, num)
    if market == "hk":
        return {"error": "港股日 K 已下线"}
    # US research auto: Sina, then Stooq
    import gstock
    out = gstock.us_stock_kline(symbol, num=num)
    if out.get("bars"):
        return out
    return stooq_kline(symbol, num)


def _a_share_auto(symbol: str, num: int) -> dict:
    """Tencent daily qfq, then baostock."""
    import astock

    code = (symbol or "").strip()
    m = _A_RE.match(code)
    digits = m.group(1) if m else code
    try:
        lk = astock.light_kline(digits, "1D", num=num)
    except Exception:
        lk = {}
    bars = []
    for b in (lk or {}).get("bars") or []:
        bars.append(_bar(
            str(b.get("datetime") or b.get("date") or "")[:10],
            float(b["open"]), float(b["high"]), float(b["low"]),
            float(b["close"]), float(b.get("volume") or 0),
        ))
    if bars:
        return {
            "code": digits, "name": lk.get("name") or digits, "market": "CN",
            "source": lk.get("source") or "tencent", "adjust": lk.get("adjust") or "qfq",
            "bars": _trim(bars, num),
        }
    return baostock_kline(digits, num)
