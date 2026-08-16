"""ETF share history: SSE / SZSE daily shares + Eastmoney quarterly subscribe/redeem.

SSE TOT_VOL is 万份 (divide by 1e4 -> 亿份).
SZSE 基金规模 is 份 (divide by 1e8 -> 亿份).
Objective public data only; no recommendation.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import astock

_UA = astock.UA
_BJ = timezone(timedelta(hours=8))
_SSE = "https://query.sse.com.cn/commonQuery.do"
_SSE_SQL = "COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L"
_SZSE = "https://www.szse.cn/api/report/ShowReport"
_GMBD = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx"
_ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.S)
_CELL_RE = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S)
_TAG_RE = re.compile(r"<[^>]+>")
_CODE_RE = re.compile(r"^\d{6}$")

DEFAULT_CODES = ("510050", "510300", "510500", "588000", "159915", "159919")
SSE_WATCH = ("510050", "510300", "510500", "588000")
SZSE_WATCH = ("159915", "159919")
_NOTES = {
    "sse": "日线=上交所ETF规模 TOT_VOL(万份/1e4); 季报申购赎回=东财基金档案。客观公开数据, 非推荐。",
    "szse": "日线=深交所基金规模(份/1e8); 季报申购赎回=东财基金档案。客观公开数据, 非推荐。",
}


def _num(v: Any) -> float | None:
    if v is None or v == "" or v == "-":
        return None
    try:
        return float(str(v).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None


def _fund_code(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    return s


def exchange_of(code: str) -> str:
    """SSE: 5xxxxx. SZSE: 15/16/18xxxxx."""
    raw = (code or "").strip()
    if raw.startswith(("15", "16", "18")):
        return "szse"
    return "sse"


def _data_dir() -> Path:
    root = Path(os.environ.get("VR_DATA_DIR") or Path.home() / ".vibe-research")
    return root / "etf-shares"


def _cache_path(code: str) -> Path:
    return _data_dir() / f"{code}.json"


def _sse_snap_path(day: str) -> Path:
    return _data_dir() / "sse" / f"{day}.json"


def _load_cache(code: str) -> dict[str, Any]:
    p = _cache_path(code)
    if not p.is_file():
        return {"code": code, "days": {}}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"code": code, "days": {}}
    days = raw.get("days") if isinstance(raw, dict) else None
    if not isinstance(days, dict):
        days = {}
    return {"code": code, "name": raw.get("name") or "", "days": days}


def _save_cache(code: str, cache: dict[str, Any]) -> None:
    p = _cache_path(code)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")
    tmp.replace(p)


def _save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=0), encoding="utf-8")
    tmp.replace(path)


def parse_gmbd(html: str) -> list[dict]:
    """Parse Eastmoney FundArchivesDatas type=gmbd table."""
    out: list[dict] = []
    for raw in _ROW_RE.findall(html or ""):
        cells = [_TAG_RE.sub("", c).replace("&nbsp;", " ").strip() for c in _CELL_RE.findall(raw)]
        if len(cells) < 5 or not re.match(r"\d{4}-\d{2}-\d{2}", cells[0] or ""):
            continue
        buy = _num(cells[1])
        redeem = _num(cells[2])
        shares = _num(cells[3])
        nav = _num(cells[4])
        net = None
        if buy is not None and redeem is not None:
            net = round(buy - redeem, 4)
        out.append({
            "date": cells[0],
            "subscribe_yi": buy,
            "redeem_yi": redeem,
            "net_yi": net,
            "shares_yi": shares,
            "nav_yi": nav,
            "nav_chg": cells[5] if len(cells) > 5 else "",
        })
    return out


def parse_sse_day_map(payload: Any, codes: set[str]) -> dict[str, dict[str, Any] | None]:
    """Pick several ETFs from one SSE daily snapshot. TOT_VOL is 万份."""
    found: dict[str, dict[str, Any] | None] = {c: None for c in codes}
    rows: list[Any] = []
    if isinstance(payload, dict):
        rows = payload.get("result") or (payload.get("pageHelp") or {}).get("data") or []
    if not isinstance(rows, list):
        return found
    for r in rows:
        if not isinstance(r, dict):
            continue
        code = str(r.get("SEC_CODE") or "").strip()
        if code not in found:
            continue
        wan = _num(r.get("TOT_VOL"))
        if wan is None:
            continue
        found[code] = {
            "date": str(r.get("STAT_DATE") or "")[:10],
            "name": str(r.get("SEC_NAME") or "").strip(),
            "shares_wan": wan,
            "shares_yi": round(wan / 1e4, 4),
        }
    return found


def parse_sse_day(payload: Any, code: str) -> dict[str, Any] | None:
    """Pick one ETF from an SSE daily snapshot. TOT_VOL is 万份."""
    return parse_sse_day_map(payload, {code}).get(code)


def parse_szse_records(rows: list[dict], codes: set[str] | None = None) -> dict[str, dict[str, dict]]:
    """Normalize SZSE fund-size rows. shares_fen is 份; store 万份 and 亿份."""
    out: dict[str, dict[str, dict]] = {}
    for r in rows:
        code = _fund_code(r.get("code"))
        if not code or (codes is not None and code not in codes):
            continue
        fen = _num(r.get("shares_fen"))
        if fen is None:
            continue
        day = str(r.get("date") or "")[:10]
        if not re.match(r"\d{4}-\d{2}-\d{2}", day):
            continue
        out.setdefault(code, {})[day] = {
            "date": day,
            "name": str(r.get("name") or "").strip(),
            "shares_wan": round(fen / 1e4, 4),
            "shares_yi": round(fen / 1e8, 4),
        }
    return out


def _sse_get(params: dict[str, str], timeout: int = 10) -> dict:
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(
        f"{_SSE}?{q}",
        headers={"User-Agent": _UA, "Referer": "https://www.sse.com.cn/"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def sse_latest_date() -> str:
    payload = _sse_get({
        "isPagination": "true",
        "pageHelp.pageSize": "5",
        "pageHelp.pageNo": "1",
        "sqlId": _SSE_SQL,
    })
    rows = payload.get("result") or []
    if rows and isinstance(rows[0], dict):
        d = str(rows[0].get("STAT_DATE") or "")[:10]
        if re.match(r"\d{4}-\d{2}-\d{2}", d):
            return d
    return datetime.now(_BJ).strftime("%Y-%m-%d")


def _latest_trade_date() -> str:
    try:
        return sse_latest_date()
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, KeyError):
        return datetime.now(_BJ).strftime("%Y-%m-%d")


def sse_day_map(codes: set[str], day: str) -> dict[str, Any]:
    """One SSE daily snapshot, cached on disk so sibling codes reuse the same day."""
    want = set(SSE_WATCH) | set(codes)
    p = _sse_snap_path(day)
    if p.is_file():
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and all(c in raw for c in want):
                return raw
        except (OSError, json.JSONDecodeError):
            pass
    payload = _sse_get({
        "isPagination": "true",
        "pageHelp.pageSize": "10000",
        "pageHelp.pageNo": "1",
        "sqlId": _SSE_SQL,
        "STAT_DATE": day,
    })
    mapped = parse_sse_day_map(payload, want)
    try:
        _save_json(p, mapped)
    except OSError:
        pass
    return mapped


def sse_day_row(code: str, day: str) -> dict[str, Any] | None:
    row = sse_day_map({code}, day).get(code)
    return row if isinstance(row, dict) else None


def _weekday_back(start: str, n: int) -> list[str]:
    d = datetime.strptime(start, "%Y-%m-%d").date()
    out: list[str] = []
    guard = 0
    while len(out) < n and guard < n * 3:
        guard += 1
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return out


def _date_chunks(start: str, end: str, max_days: int) -> list[tuple[str, str]]:
    a = datetime.strptime(start, "%Y-%m-%d").date()
    b = datetime.strptime(end, "%Y-%m-%d").date()
    if a > b:
        a, b = b, a
    out: list[tuple[str, str]] = []
    while a <= b:
        nxt = min(a + timedelta(days=max_days - 1), b)
        out.append((a.isoformat(), nxt.isoformat()))
        a = nxt + timedelta(days=1)
    return out


def _daily_from_cache(code: str, n: int, latest: str) -> tuple[str, list[dict]]:
    cache = _load_cache(code)
    days: dict[str, Any] = cache.get("days") or {}
    name = str(cache.get("name") or "")
    want = _weekday_back(latest, max(n + 8, n))
    rows: list[dict] = []
    for day in sorted(want):
        row = days.get(day)
        if isinstance(row, dict) and row.get("shares_yi") is not None:
            rows.append({
                "date": day,
                "name": row.get("name") or name,
                "shares_wan": row.get("shares_wan"),
                "shares_yi": row.get("shares_yi"),
            })
    return name, rows[-n:]


def _merge_day_caches(
    caches: dict[str, dict[str, Any]],
    day: str,
    mapped: dict[str, Any],
) -> None:
    for code, cache in caches.items():
        days = cache.setdefault("days", {})
        row = mapped.get(code)
        days[day] = row if isinstance(row, dict) else None
        if isinstance(row, dict) and row.get("name"):
            cache["name"] = str(row["name"])


def _fill_sse(codes: list[str], n: int, latest: str) -> None:
    codes = list(dict.fromkeys(codes))
    write_codes = list(dict.fromkeys([*codes, *SSE_WATCH]))
    caches = {c: _load_cache(c) for c in write_codes}
    want = _weekday_back(latest, max(n + 8, n))
    missing = [d for d in want if any(d not in (caches[c].get("days") or {}) for c in codes)]

    def fetch_one(day: str) -> tuple[str, dict[str, Any], bool]:
        try:
            return day, sse_day_map(set(write_codes), day), True
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, KeyError):
            return day, {}, False

    if missing:
        with ThreadPoolExecutor(max_workers=6) as pool:
            for day, mapped, ok in pool.map(fetch_one, missing):
                if not ok:
                    continue
                _merge_day_caches(caches, day, mapped)
        for c in write_codes:
            try:
                _save_cache(c, caches[c])
            except OSError:
                pass


def _szse_xlsx(start: str, end: str) -> bytes:
    q = urllib.parse.urlencode({
        "SHOWTYPE": "xlsx",
        "CATALOGID": "scsj_fund_jjgm",
        "TABKEY": "tab1",
        "txtStart": start,
        "txtEnd": end,
        "jjlb": "ETF",
    })
    req = urllib.request.Request(
        f"{_SZSE}?{q}",
        headers={
            "User-Agent": _UA,
            "Referer": "https://www.szse.cn/market/fund/volume/etf/index.html",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def _xlsx_to_records(content: bytes) -> list[dict]:
    import io
    import warnings

    import pandas as pd

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        df = pd.read_excel(io.BytesIO(content))
    recs: list[dict] = []
    for rec in df.to_dict("records"):
        recs.append({
            "date": str(rec.get("日期") or "")[:10],
            "code": _fund_code(rec.get("基金代码")),
            "name": str(rec.get("基金简称") or "").strip(),
            "shares_fen": rec.get("基金规模(份)"),
        })
    return recs


def _fill_szse(codes: list[str], n: int, latest: str) -> None:
    codes = list(dict.fromkeys(codes))
    write_codes = list(dict.fromkeys([*codes, *SZSE_WATCH]))
    caches = {c: _load_cache(c) for c in write_codes}
    want = _weekday_back(latest, max(n + 8, n))
    missing = [d for d in want if any(d not in (caches[c].get("days") or {}) for c in codes)]
    if not missing:
        return

    start, end = min(want), max(want)
    merged: dict[str, dict[str, dict]] = {c: {} for c in write_codes}
    fetched = False
    for a, b in _date_chunks(start, end, 170):
        try:
            recs = _xlsx_to_records(_szse_xlsx(a, b))
            parsed = parse_szse_records(recs, set(write_codes))
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, ImportError, KeyError):
            continue
        fetched = True
        for c, by_day in parsed.items():
            merged.setdefault(c, {}).update(by_day)
    if not fetched:
        return

    for c in write_codes:
        days = caches[c].setdefault("days", {})
        for day in want:
            row = merged.get(c, {}).get(day)
            if isinstance(row, dict):
                days[day] = row
                if row.get("name"):
                    caches[c]["name"] = str(row["name"])
            elif day not in days:
                days[day] = None
        try:
            _save_cache(c, caches[c])
        except OSError:
            pass


def etf_gmbd(code: str) -> list[dict]:
    """Eastmoney quarterly subscribe / redeem / ending shares (亿份)."""
    try:
        r = astock.em_get(
            _GMBD,
            params={"type": "gmbd", "code": code},
            headers={"Referer": "https://fundf10.eastmoney.com/"},
            timeout=12,
        )
        text = r.text if hasattr(r, "text") else r.content.decode("utf-8", "replace")
    except Exception:
        return []
    return parse_gmbd(text)


def _chg(daily: list[dict]) -> tuple[float | None, float | None]:
    latest = daily[-1] if daily else None
    prev = daily[-2] if len(daily) >= 2 else None
    if not latest or not prev:
        return None, None
    if latest.get("shares_yi") is None or prev.get("shares_yi") is None:
        return None, None
    chg = round(float(latest["shares_yi"]) - float(prev["shares_yi"]), 4)
    chg_pct = None
    if float(prev["shares_yi"]):
        chg_pct = round(chg / float(prev["shares_yi"]) * 100, 2)
    return chg, chg_pct


def _pack(code: str, n: int, latest: str) -> dict[str, Any]:
    name, daily = _daily_from_cache(code, n, latest)
    periods = etf_gmbd(code)
    last = daily[-1] if daily else None
    chg, chg_pct = _chg(daily)
    ex = exchange_of(code)
    return {
        "code": code,
        "name": name or (last or {}).get("name") or "",
        "source": f"{ex}+eastmoney",
        "unit": "亿份",
        "latest": last,
        "chg_yi": chg,
        "chg_pct": chg_pct,
        "daily": daily,
        "periods": periods,
        "note": _NOTES[ex],
    }


def _norm_codes(codes: list[str] | None) -> list[str]:
    raws: list[str] = []
    for c in (codes or list(DEFAULT_CODES)):
        raw = (c or "").strip()
        if not _CODE_RE.fullmatch(raw):
            raise ValueError("code must be 6 digits")
        if raw not in raws:
            raws.append(raw)
    if not raws:
        raws = list(DEFAULT_CODES)
    if len(raws) > 8:
        raise ValueError("too many codes")
    return raws


def _fill_exchanges(codes: list[str], n: int, latest: str) -> None:
    sse = [c for c in codes if exchange_of(c) == "sse"]
    szse = [c for c in codes if exchange_of(c) == "szse"]
    jobs: list[tuple[Any, tuple]] = []
    if sse:
        jobs.append((_fill_sse, (sse, n, latest)))
    if szse:
        jobs.append((_fill_szse, (szse, n, latest)))
    if not jobs:
        return
    if len(jobs) == 1:
        fn, args = jobs[0]
        fn(*args)
        return
    with ThreadPoolExecutor(max_workers=2) as pool:
        futs = [pool.submit(fn, *args) for fn, args in jobs]
        for f in futs:
            f.result()


def etf_shares(code: str = "510300", n: int = 80) -> dict[str, Any]:
    """Daily exchange shares + quarterly Eastmoney gmbd for one ETF."""
    raw = (code or "").strip()
    if not _CODE_RE.fullmatch(raw):
        raise ValueError("code must be 6 digits")
    days_n = max(20, min(int(n or 80), 250))
    latest = _latest_trade_date()
    _fill_exchanges([raw], days_n, latest)
    return _pack(raw, days_n, latest)


def etf_shares_many(codes: list[str] | None = None, n: int = 80) -> dict[str, Any]:
    """Fill SSE/SZSE once, then pack each code with its own gmbd."""
    raws = _norm_codes(codes)
    days_n = max(20, min(int(n or 80), 250))
    latest = _latest_trade_date()
    _fill_exchanges(raws, days_n, latest)
    with ThreadPoolExecutor(max_workers=4) as pool:
        items = list(pool.map(lambda c: _pack(c, days_n, latest), raws))
    return {"items": items}
