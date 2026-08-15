"""Cockpit live feeds: world indices, sector boards, stock rank, commodities.

Ported from marketingdashboard public endpoints (Tencent / Sina / Eastmoney).
Objective snapshots only; no recommendation / scoring / prediction.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

import astock

UA = astock.UA
em_get = astock.em_get

_HF_RE = re.compile(r"^(hf|nf)_[A-Za-z0-9]{1,12}$")
_BK_RE = re.compile(r"^BK\d{4}$", re.I)
_SINA_RANK_SORT = {"changepercent", "amount", "turnoverratio"}

WORLD_INDICES: tuple[tuple[str, str, str], ...] = (
    ("sh000001", "上证指数", "CN"),
    ("sz399001", "深证成指", "CN"),
    ("sz399006", "创业板指", "CN"),
    ("sh000688", "科创50", "CN"),
    ("sh000300", "沪深300", "CN"),
    ("sh000905", "中证500", "CN"),
    ("hkHSI", "恒生指数", "HK"),
    ("hkHSTECH", "恒生科技", "HK"),
    ("usDJI", "道琼斯", "US"),
    ("usIXIC", "纳斯达克", "US"),
    ("usINX", "标普500", "US"),
    ("usVIX", "恐慌指数", "US"),
    ("usSOXX", "费城半导体", "US"),
    ("whUSDCNY", "美元/人民币", "FX"),
)

DEFAULT_FUTURES = "hf_GC,hf_XAU,nf_AU0,hf_SI,hf_CAD,hf_CL,BTCUSDT"

_EM_TO_WORLD = {
    "dji": "usDJI",
    "spx": "usINX",
    "ndx": "usIXIC",
    "hsi": "hkHSI",
    "hstech": "hkHSTECH",
}


def _num(v) -> float:
    try:
        if v is None or v == "" or v == "-":
            return 0.0
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _change(price: float, prev: float) -> float:
    return round(price - prev, 4) if prev else 0.0


def _pct(price: float, prev: float) -> float:
    if not prev:
        return 0.0
    return round((price - prev) / prev * 100, 2)


def _fetch_bytes(url: str, headers: dict | None = None, timeout: int = 12) -> bytes:
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _fetch_text(url: str, *, referer: str | None = None, encoding: str = "utf-8", timeout: int = 12) -> str:
    headers = {"User-Agent": UA}
    if referer:
        headers["Referer"] = referer
    raw = _fetch_bytes(url, headers=headers, timeout=timeout)
    if encoding == "gbk":
        return raw.decode("gbk", errors="replace")
    try:
        return raw.decode(encoding)
    except UnicodeDecodeError:
        return raw.decode("gbk", errors="replace")


def parse_jsonp(text: str):
    """Unwrap `var t=(...)` / `jQuery(...);` JSONP payloads."""
    src = (text or "").strip()
    a = src.find("(")
    b = src.rfind(")")
    if a < 0 or b <= a:
        raise ValueError("bad jsonp")
    return json.loads(src[a + 1 : b])


def parse_tencent_quote_line(line: str) -> dict | None:
    """Parse one `v_symbol="f0~f1~..."` gtimg line. Keeps full symbol as key."""
    m = re.search(r'v_([A-Za-z0-9_]+)="([^"]*)"', line or "")
    if not m:
        return None
    symbol = m.group(1)
    f = m.group(2).split("~")
    if symbol.startswith("wh") and len(f) > 13:
        price = _num(f[3])
        chg = _num(f[12])
        return {
            "symbol": symbol,
            "name": f[1] or symbol,
            "price": price,
            "change": chg,
            "pct": _num(f[13]),
            "prev": price - chg if price else 0.0,
            "amount": 0.0,
        }
    if len(f) < 33:
        return None
    return {
        "symbol": symbol,
        "name": f[1] or symbol,
        "price": _num(f[3]),
        "prev": _num(f[4]),
        "change": _num(f[31]),
        "pct": _num(f[32]),
        "amount": _num(f[37]) if len(f) > 37 else 0.0,
    }


def parse_tencent_quotes(text: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for line in (text or "").split(";"):
        q = parse_tencent_quote_line(line.strip())
        if q:
            out[q["symbol"]] = q
    return out


def parse_sina_hf(text: str) -> dict[str, dict]:
    """Outer-market futures: hq_str_hf_XX / v_hf_XX (Tencent-compatible layout)."""
    out: dict[str, dict] = {}
    for m in re.finditer(r'(?:hq_str_|v_)(hf_\w+)="([^"]*)"', text or ""):
        f = m.group(2).split(",")
        if len(f) < 14 or not f[0]:
            continue
        price = _num(f[0])
        prev = _num(f[7])
        out[m.group(1)] = {
            "symbol": m.group(1),
            "name": f[13] or m.group(1),
            "price": price,
            "high": _num(f[4]),
            "low": _num(f[5]),
            "open": _num(f[8]),
            "prev": prev,
            "change": _change(price, prev),
            "pct": _pct(price, prev),
            "time": f"{f[12]} {f[6]}".strip() if len(f) > 12 else "",
        }
    return out


def parse_sina_nf(text: str) -> dict[str, dict]:
    """Domestic futures hq_str_nf_XX."""
    out: dict[str, dict] = {}
    for m in re.finditer(r'hq_str_(nf_\w+)="([^"]*)"', text or ""):
        f = m.group(2).split(",")
        if len(f) < 17 or not f[0]:
            continue
        prev = _num(f[8])
        price = _num(f[5])
        if not price:
            bid, ask = _num(f[6]), _num(f[7])
            if bid and ask:
                price = round((bid + ask) / 2, 2)
            else:
                price = bid or ask or prev
        out[m.group(1)] = {
            "symbol": m.group(1),
            "name": f[0] or m.group(1),
            "price": price,
            "high": _num(f[3]),
            "low": _num(f[4]),
            "open": _num(f[2]),
            "prev": prev,
            "change": _change(price, prev),
            "pct": _pct(price, prev),
            "time": f[16] if len(f) > 16 else "",
        }
    return out


def normalize_board_code(raw: str) -> str:
    """Tencent bd_code / Eastmoney f12 -> BK####."""
    s = str(raw or "").strip().upper()
    if _BK_RE.fullmatch(s):
        return s
    m = re.search(r"(?:BK)?(\d{3,6})", s)
    if not m:
        return s
    digits = m.group(1)
    if len(digits) >= 4:
        digits = digits[-4:]
    else:
        digits = digits.zfill(4)
    return f"BK{digits}"


def _tencent_quotes(codes: list[str]) -> dict[str, dict]:
    if not codes:
        return {}
    url = "https://qt.gtimg.cn/q=" + ",".join(codes)
    return parse_tencent_quotes(_fetch_text(url, encoding="gbk", timeout=10))


def _vix_from_sina() -> dict | None:
    try:
        text = _fetch_text(
            "https://hq.sinajs.cn/list=hf_VX",
            referer="https://finance.sina.com.cn/futures/",
            encoding="gbk",
            timeout=6,
        )
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    parsed = parse_sina_hf(text)
    item = parsed.get("hf_VX")
    if not item or not item.get("price"):
        return None
    return {
        "symbol": "usVIX",
        "name": "恐慌指数",
        "price": item["price"],
        "prev": item["prev"],
        "change": item["change"],
        "pct": item["pct"],
        "amount": 0.0,
    }


def world_indices() -> list[dict]:
    """A / HK / US / FX key indices in one list (Tencent, EM / Sina fallback)."""
    codes = [c for c, _n, _r in WORLD_INDICES]
    quotes: dict[str, dict] = {}
    try:
        quotes = _tencent_quotes(codes)
    except (urllib.error.URLError, TimeoutError, OSError, UnicodeError):
        quotes = {}

    if "usVIX" not in quotes or not quotes["usVIX"].get("price"):
        vix = _vix_from_sina()
        if vix:
            quotes["usVIX"] = vix

    missing_us = [c for c, _n, r in WORLD_INDICES if r in ("US", "HK") and not quotes.get(c, {}).get("price")]
    if missing_us:
        try:
            import gstock
            for row in gstock.global_indices():
                mapped = _EM_TO_WORLD.get(row.get("key") or "")
                if mapped and not quotes.get(mapped, {}).get("price"):
                    quotes[mapped] = {
                        "symbol": mapped,
                        "name": row.get("name") or mapped,
                        "price": row.get("price") or 0,
                        "change": 0.0,
                        "pct": row.get("change_pct") or 0,
                        "amount": 0.0,
                    }
        except Exception:
            pass

    out = []
    for code, label, region in WORLD_INDICES:
        q = quotes.get(code) or {}
        price = q.get("price")
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        out.append({
            "symbol": code,
            "name": q.get("name") or label,
            "label": label,
            "region": region,
            "price": price,
            "change": q.get("change") or 0,
            "change_pct": q.get("pct") or 0,
            "amount": q.get("amount") or 0,
        })
    return out


def sector_boards(kind: str = "01", direction: str = "0", n: int = 30) -> list[dict]:
    """Industry (01) / concept (02) realtime board rank (Tencent, EM fallback)."""
    k = "02" if str(kind) == "02" else "01"
    d = "1" if str(direction) == "1" else "0"
    want = max(5, min(int(n or 30), 200))
    try:
        rows = _tencent_boards(k, d, want)
        if rows:
            return rows
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, KeyError):
        pass
    return _em_boards(k, d, want)


def _tencent_boards(kind: str, direction: str, want: int) -> list[dict]:
    url = (
        "https://ifzq.gtimg.cn/appstock/app/mktHs/rank"
        f"?l={want}&p=1&t={kind}/averatio&o={direction}"
    )
    payload = json.loads(_fetch_text(url, timeout=10))
    rows = []
    for b in payload.get("data") or []:
        if not isinstance(b, dict):
            continue
        raw = str(b.get("bd_code") or "")
        rows.append({
            "code": normalize_board_code(raw) or raw,
            "raw_code": raw,
            "name": b.get("bd_name") or "",
            "price": _num(b.get("bd_zxj")),
            "change": _num(b.get("bd_zd")),
            "pct": _num(b.get("bd_zdf")),
            "lead_code": b.get("nzg_code") or "",
            "lead_name": b.get("nzg_name") or "",
            "lead_pct": _num(b.get("nzg_zdf")),
        })
    return rows


def _em_boards(kind: str, direction: str, want: int) -> list[dict]:
    fs = "m:90+t:3" if kind == "02" else "m:90+t:2"
    po = "0" if direction == "1" else "1"
    params = {
        "pn": "1", "pz": str(want), "po": po, "np": "1",
        "fltt": "2", "invt": "2", "fid": "f3",
        "fs": fs,
        "fields": "f12,f14,f2,f3,f204,f205",
    }
    data: dict = {}
    for host in ("push2delay.eastmoney.com", "push2.eastmoney.com"):
        try:
            r = em_get(
                f"https://{host}/api/qt/clist/get",
                params=params,
                headers={"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"},
                timeout=12,
            )
            data = (r.json() or {}).get("data") or {}
            if data.get("diff"):
                break
        except Exception:
            continue
    items = data.get("diff") or []
    if isinstance(items, dict):
        items = list(items.values())
    rows = []
    for it in items[:want]:
        if not isinstance(it, dict):
            continue
        code = normalize_board_code(str(it.get("f12") or ""))
        rows.append({
            "code": code,
            "raw_code": it.get("f12") or "",
            "name": it.get("f14") or "",
            "price": _num(it.get("f2")),
            "change": 0.0,
            "pct": _num(it.get("f3")),
            "lead_code": str(it.get("f205") or ""),
            "lead_name": str(it.get("f204") or ""),
            "lead_pct": 0.0,
        })
    return rows


def board_stocks(code: str, n: int = 12) -> list[dict]:
    """Board constituents by change pct (Eastmoney clist fs=b:BK####)."""
    bk = normalize_board_code(code)
    if not _BK_RE.fullmatch(bk):
        return []
    want = max(5, min(int(n or 12), 80))
    params = {
        "pn": "1", "pz": str(want), "po": "1", "np": "1",
        "fltt": "2", "invt": "2", "fid": "f3",
        "fs": f"b:{bk}",
        "fields": "f12,f14,f2,f3,f6,f8",
    }
    data: dict = {}
    for host in ("push2delay.eastmoney.com", "push2.eastmoney.com"):
        try:
            r = em_get(
                f"https://{host}/api/qt/clist/get",
                params=params,
                headers={"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"},
                timeout=12,
            )
            data = (r.json() or {}).get("data") or {}
            if data.get("diff"):
                break
        except Exception:
            continue
    items = data.get("diff") or []
    if isinstance(items, dict):
        items = list(items.values())
    rows = []
    for it in items[:want]:
        if not isinstance(it, dict):
            continue
        price = it.get("f2")
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        rows.append({
            "code": it.get("f12") or "",
            "name": it.get("f14") or "",
            "price": price,
            "pct": it.get("f3") if isinstance(it.get("f3"), (int, float)) else 0,
            "amount": it.get("f6") if isinstance(it.get("f6"), (int, float)) else 0,
            "turnover": it.get("f8") if isinstance(it.get("f8"), (int, float)) else 0,
        })
    return rows


def stock_rank(sort: str = "changepercent", asc: int = 0, n: int = 30) -> list[dict]:
    """A-share rank: amount / changepercent. Eastmoney primary, Sina fallback."""
    key = sort if sort in _SINA_RANK_SORT else "changepercent"
    desc = 0 if int(asc or 0) == 1 else 1
    want = max(5, min(int(n or 30), 50))
    try:
        rows = _em_rank(key, desc, want)
        if rows:
            return rows
    except Exception:
        pass
    return _sina_rank(key, 0 if desc else 1, want)


def _em_rank(sort: str, po: int, want: int) -> list[dict]:
    fid = "f6" if sort == "amount" else "f8" if sort == "turnoverratio" else "f3"
    params = {
        "pn": "1", "pz": str(want), "po": str(po), "np": "1",
        "fltt": "2", "invt": "2", "fid": fid,
        "fs": "m:0+t:6,m:0+t:80",
        "fields": "f12,f14,f2,f3,f6,f8,f62,f184",
    }
    data: dict = {}
    for host in ("push2delay.eastmoney.com", "push2.eastmoney.com"):
        try:
            r = em_get(
                f"https://{host}/api/qt/clist/get",
                params=params,
                headers={"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"},
                timeout=12,
            )
            data = (r.json() or {}).get("data") or {}
            if data.get("diff"):
                break
        except Exception:
            continue
    items = data.get("diff") or []
    if isinstance(items, dict):
        items = list(items.values())
    rows = []
    for it in items[:want]:
        if not isinstance(it, dict):
            continue
        price = it.get("f2")
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        code = str(it.get("f12") or "")
        rows.append({
            "symbol": f"{astock.get_prefix(code)}{code}" if code.isdigit() else code,
            "code": code,
            "name": it.get("f14") or "",
            "price": price,
            "pct": it.get("f3") if isinstance(it.get("f3"), (int, float)) else 0,
            "amount": it.get("f6") if isinstance(it.get("f6"), (int, float)) else 0,
            "turnover": it.get("f8") if isinstance(it.get("f8"), (int, float)) else 0,
            "main_net": it.get("f62") if isinstance(it.get("f62"), (int, float)) else 0,
            "main_pct": it.get("f184") if isinstance(it.get("f184"), (int, float)) else 0,
        })
    return rows


def _sina_rank(sort: str, asc: int, want: int) -> list[dict]:
    fetch_n = min(80, max(want * 2, 40))
    url = (
        "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        f"Market_Center.getHQNodeData?page=1&num={fetch_n}&sort={sort}&asc={asc}&node=hs_a"
    )
    arr = json.loads(_fetch_text(url, referer="https://finance.sina.com.cn/", timeout=12))
    if not isinstance(arr, list):
        return []
    rows = []
    for s in arr:
        if not isinstance(s, dict):
            continue
        price = _num(s.get("trade"))
        if price <= 0:
            continue
        rows.append({
            "symbol": s.get("symbol") or "",
            "code": s.get("code") or "",
            "name": s.get("name") or "",
            "price": price,
            "pct": _num(s.get("changepercent")),
            # Sina getHQNodeData amount is yuan, same as Eastmoney f6.
            "amount": _num(s.get("amount")),
            "turnover": _num(s.get("turnoverratio")),
        })
        if len(rows) >= want:
            break
    return rows


def board_flow_intraday(n: int = 20) -> list[dict]:
    """Industry inflow/outflow TOP with minute cumulative main-net (Eastmoney)."""
    half = max(3, min(10, (int(n or 20)) // 2))

    def _pick(po: int) -> list[dict]:
        params = {
            "fid": "f62", "po": str(po), "pz": str(half), "pn": "1", "np": "1",
            "fltt": "2", "invt": "2", "fs": "m:90+t:2",
            "fields": "f12,f14,f62",
        }
        data: dict = {}
        for host in ("push2delay.eastmoney.com", "push2.eastmoney.com"):
            try:
                r = em_get(
                    f"https://{host}/api/qt/clist/get",
                    params=params,
                    headers={"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"},
                    timeout=12,
                )
                data = (r.json() or {}).get("data") or {}
                if data.get("diff"):
                    break
            except Exception:
                continue
        items = data.get("diff") or []
        if isinstance(items, dict):
            items = list(items.values())
        out = []
        for b in items:
            if not isinstance(b, dict):
                continue
            out.append({
                "code": normalize_board_code(str(b.get("f12") or "")),
                "name": b.get("f14") or "",
                "net_in": _num(b.get("f62")),
            })
        return out

    ups = _pick(1)
    downs = _pick(0)
    seen = {u["code"] for u in ups}
    boards = ups + [d for d in downs if d["code"] not in seen]
    out = []
    for b in boards:
        points = _board_fflow_kline_cached(b["code"])
        out.append({**b, "points": points})
    return out


def _board_fflow_kline_cached(code: str) -> list[dict]:
    """Per-board minute curve. Same TTL key as a later full-list refresh."""
    from api_common import _cached

    bk = normalize_board_code(code)
    return _cached(
        "board_fflow_kline",
        bk,
        120,
        lambda: _board_fflow_kline(bk),
        valid=lambda d: isinstance(d, list) and len(d) > 0,
    )


def _board_fflow_kline(code: str) -> list[dict]:
    bk = normalize_board_code(code)
    if not _BK_RE.fullmatch(bk):
        return []
    params = {
        "secid": f"90.{bk}",
        "klt": "1",
        "lmt": "0",
        "fields1": "f1,f2,f3,f7",
        "fields2": "f51,f52",
    }
    for host in ("push2delay.eastmoney.com", "push2.eastmoney.com"):
        try:
            r = em_get(
                f"https://{host}/api/qt/stock/fflow/kline/get",
                params=params,
                headers={"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"},
                timeout=12,
            )
            kl = ((r.json() or {}).get("data") or {}).get("klines") or []
            pts = []
            for s in kl:
                f = str(s).split(",")
                if len(f) < 2:
                    continue
                t = f[0][11:16] if len(f[0]) >= 16 else f[0]
                pts.append({"t": t, "v": _num(f[1])})
            return pts
        except Exception:
            continue
    return []


def _sanitize_future_codes(raw: str) -> list[str]:
    codes = []
    for part in str(raw or DEFAULT_FUTURES).split(","):
        s = part.strip()
        if s == "BTCUSDT" or _HF_RE.fullmatch(s):
            codes.append(s)
        if len(codes) >= 20:
            break
    return codes


def _fetch_btc() -> dict | None:
    try:
        text = _fetch_text(
            "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
            referer="https://www.binance.com/",
            timeout=8,
        )
        j = json.loads(text)
        price = _num(j.get("lastPrice"))
        prev = _num(j.get("prevClosePrice"))
        return {
            "symbol": "BTCUSDT",
            "name": "BTC/USDT",
            "price": price,
            "prev": prev,
            "open": _num(j.get("openPrice")),
            "high": _num(j.get("highPrice")),
            "low": _num(j.get("lowPrice")),
            "change": _num(j.get("priceChange")),
            "pct": _num(j.get("priceChangePercent")),
            "time": "",
        }
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError):
        pass
    try:
        text = _fetch_text(
            "https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT",
            referer="https://www.okx.com/",
            timeout=8,
        )
        d = (json.loads(text).get("data") or [None])[0]
        if not d:
            return None
        price = _num(d.get("last"))
        prev = _num(d.get("open24h"))
        return {
            "symbol": "BTCUSDT",
            "name": "BTC/USDT",
            "price": price,
            "prev": prev,
            "open": prev,
            "high": _num(d.get("high24h")),
            "low": _num(d.get("low24h")),
            "change": _change(price, prev),
            "pct": _pct(price, prev),
            "time": "",
        }
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError):
        return None


def futures_quotes(raw_list: str | None = None) -> dict[str, dict]:
    """Gold / silver / copper / oil / SHFE gold / BTC snapshot."""
    codes = _sanitize_future_codes(raw_list or DEFAULT_FUTURES)
    out: dict[str, dict] = {}
    hf = [c for c in codes if c.startswith("hf_")]
    nf = [c for c in codes if c.startswith("nf_")]
    if hf:
        parsed: dict[str, dict] = {}
        try:
            raw = _fetch_text(
                "https://qt.gtimg.cn/q=" + ",".join(hf),
                encoding="gbk",
                timeout=10,
            )
            parsed = parse_sina_hf(raw.replace("v_", "hq_str_"))
        except (urllib.error.URLError, TimeoutError, OSError):
            parsed = {}
        if len(parsed) < min(2, len(hf)):
            try:
                text = _fetch_text(
                    "https://hq.sinajs.cn/list=" + ",".join(hf),
                    referer="https://finance.sina.com.cn/futures/quotes/CL.shtml",
                    encoding="gbk",
                    timeout=10,
                )
                parsed.update(parse_sina_hf(text))
            except (urllib.error.URLError, TimeoutError, OSError):
                pass
        out.update(parsed)
    if nf:
        try:
            text = _fetch_text(
                "https://hq.sinajs.cn/list=" + ",".join(nf),
                referer="https://finance.sina.com.cn/futures/quotes/AU0.shtml",
                encoding="gbk",
                timeout=10,
            )
            out.update(parse_sina_nf(text))
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
    if "BTCUSDT" in codes:
        btc = _fetch_btc()
        if btc:
            out["BTCUSDT"] = btc
    return out


def future_minute(code: str) -> dict:
    """Intraday minute series for hf_ / nf_ / BTCUSDT."""
    c = (code or "").strip()
    if c == "BTCUSDT":
        return _btc_minute()
    if c.startswith("hf_") and _HF_RE.fullmatch(c):
        return _hf_minute(c)
    if c.startswith("nf_") and _HF_RE.fullmatch(c):
        return _nf_minute(c)
    raise ValueError(f"bad future code: {c}")


def _btc_minute() -> dict:
    klines = json.loads(_fetch_text(
        "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=240",
        referer="https://www.binance.com/",
        timeout=10,
    ))
    ticker = json.loads(_fetch_text(
        "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
        referer="https://www.binance.com/",
        timeout=8,
    ))
    pts = []
    for k in klines:
        ts = int(k[0]) // 1000
        hh = (ts // 3600) % 24
        mm = (ts // 60) % 60
        pts.append({"t": f"{hh:02d}:{mm:02d}", "p": _num(k[4])})
    return {"code": "BTCUSDT", "prec": _num(ticker.get("prevClosePrice")), "points": pts}


def _hf_minute(code: str) -> dict:
    symbol = code[3:]
    text = _fetch_text(
        "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20t=/"
        f"GlobalFuturesService.getGlobalFuturesMinLine?symbol={symbol}",
        referer=f"https://finance.sina.com.cn/futures/quotes/{symbol}.shtml",
        timeout=12,
    )
    arr = (parse_jsonp(text) or {}).get("minLine_1d") or []
    pts = []
    for f in arr:
        if not isinstance(f, (list, tuple)) or len(f) < 2:
            continue
        if ":" not in str(f[0]):
            continue
        pts.append({"t": str(f[0]), "p": _num(f[1])})
    quotes = futures_quotes(code)
    return {"code": code, "prec": (quotes.get(code) or {}).get("prev") or 0, "points": pts}


def _nf_minute(code: str) -> dict:
    symbol = code[3:]
    text = _fetch_text(
        "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20t=/"
        f"InnerFuturesNewService.getMinLine?symbol={symbol}",
        referer=f"https://finance.sina.com.cn/futures/quotes/{symbol}.shtml",
        timeout=12,
    )
    arr = parse_jsonp(text) or []
    pts = []
    for f in arr:
        if not isinstance(f, (list, tuple)) or len(f) < 2:
            continue
        pts.append({"t": str(f[0]), "p": _num(f[1])})
    quotes = futures_quotes(code)
    return {"code": code, "prec": (quotes.get(code) or {}).get("prev") or 0, "points": pts}


def future_minutes(codes: list[str]) -> dict[str, dict | None]:
    out: dict[str, dict | None] = {}
    for c in codes[:12]:
        try:
            out[c] = future_minute(c)
        except Exception:
            out[c] = None
    return out
