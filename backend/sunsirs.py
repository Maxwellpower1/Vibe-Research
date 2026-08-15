"""Sunsirs (100ppi.com) spot vs futures basis + chemical spot.

Ported from marketingdashboard sunsirs.cjs. Public HTML only.
History lives under VR_DATA_DIR / spot-history.json (default ~/.vibe-research).
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import astock

_UA = astock.UA
_BJ = timezone(timedelta(hours=8))
_BAD_KEYS = frozenset({"__proto__", "constructor", "prototype"})
_MAX_NAMES = 500
_MAX_POINTS = 400


def _bj_today() -> str:
    return datetime.now(_BJ).strftime("%Y-%m-%d")


def _history_path() -> Path:
    root = Path(os.environ.get("VR_DATA_DIR") or Path.home() / ".vibe-research")
    return root / "spot-history.json"


def _num(v: Any) -> float:
    if v is None or v == "" or v == "-":
        return 0.0
    try:
        return float(str(v).replace(",", "").replace("%", ""))
    except (TypeError, ValueError):
        return 0.0


def fetch_sunsir(url: str, timeout: int = 15) -> str:
    """GET HTML. Retry once with HW_CHECK cookie when the WAF challenge page appears."""
    import requests

    headers = {"User-Agent": _UA, "Accept": "text/html"}
    r = requests.get(url, headers=headers, timeout=timeout)
    text = r.text or ""
    if len(text) < 4000 and "HW_CHECK" in text:
        m = re.search(r'=\s*"([0-9a-f]{16,})"', text)
        if m:
            r = requests.get(
                url,
                headers={**headers, "Cookie": f"HW_CHECK={m.group(1)}"},
                timeout=timeout,
            )
            text = r.text or ""
    if "HW_CHECK" in text and len(text) < 4000:
        raise RuntimeError("sunsir waf challenge failed")
    return text


def parse_sf_table(html: str) -> list[dict]:
    """Parse https://www.100ppi.com/sf/ exchange blocks into basis rows."""
    parts = re.split(r'<td colspan="8"[^>]*>([^<]+)</td>', html, flags=re.I)
    rows: list[dict] = []
    for i in range(1, len(parts), 2):
        exchange = (parts[i] or "").strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        chunks = re.split(r'<tr[^>]*bgcolor="#fafdff"[^>]*>', body, flags=re.I)
        for chunk in chunks[1:]:
            fonts = [m.group(1) for m in re.finditer(r"<font[^>]*>(-?[\d.,]+%?)</font>", chunk)]
            chunk = re.sub(r"<table[\s\S]*?</table>", "", chunk, flags=re.I)
            cells = [
                re.sub(r"<[^>]+>", "", m.group(1)).replace("&nbsp;", "").strip()
                for m in re.finditer(r"<td[^>]*>([\s\S]*?)</td>", chunk)
            ]
            cells = [c for c in cells if c]
            if len(cells) < 4 or not cells[0]:
                continue
            basis_pct = _num(fonts[1]) if len(fonts) > 1 else 0.0
            rows.append({
                "exchange": exchange,
                "name": cells[0],
                "spot": _num(cells[1]),
                "contract": cells[2] or "",
                "futures": _num(cells[3]),
                "basis": _num(fonts[0]) if fonts else 0.0,
                "basis_pct": basis_pct,
            })
    return rows


def parse_chem_quotes(html: str) -> tuple[list[float], list[float], str]:
    """Return (market_prices, all_prices, date)."""
    market: list[float] = []
    all_p: list[float] = []
    for m in re.finditer(r"<tr[^>]*>([\s\S]*?)</tr>", html, flags=re.I):
        row = m.group(1)
        pm = re.search(r">\s*([\d.]+)\s*元/吨\s*<", row)
        if not pm or "p-name" not in row:
            continue
        p = _num(pm.group(1))
        all_p.append(p)
        if "市场价" in row:
            market.append(p)
    dm = re.search(r">(20\d{2}-\d{2}-\d{2})<", html)
    return market, all_p, dm.group(1) if dm else ""


def _median(vals: list[float]) -> float:
    xs = sorted(vals)
    n = len(xs)
    if n == 0:
        return 0.0
    mid = n // 2
    if n % 2:
        return xs[mid]
    return round((xs[mid - 1] + xs[mid]) / 2, 2)


def _read_history() -> dict[str, list[dict]]:
    p = _history_path()
    if not p.is_file():
        return {}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def _write_history(data: dict[str, list[dict]]) -> None:
    p = _history_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(p)


def _append_spot(history: dict[str, list[dict]], name: str, price: float) -> list[dict] | None:
    if not name or name in _BAD_KEYS or not price:
        return None
    arr = history.get(name)
    if arr is None:
        if len(history) >= _MAX_NAMES:
            return None
        arr = []
        history[name] = arr
    today = _bj_today()
    if arr and arr[-1].get("t") == today:
        arr[-1]["p"] = price
    else:
        arr.append({"t": today, "p": price})
    if len(arr) > _MAX_POINTS:
        del arr[: len(arr) - _MAX_POINTS]
    return arr


def spot_table() -> dict:
    html = fetch_sunsir("https://www.100ppi.com/sf/")
    dm = re.search(r"20\d{2}年\d{1,2}月\d{1,2}日", html)
    if dm:
        date = dm.group(0).replace("年", "-").replace("月", "-").replace("日", "")
    else:
        date = _bj_today()
    rows = parse_sf_table(html)
    if not rows:
        raise RuntimeError("sunsir sf table parse empty")
    history = _read_history()
    for r in rows:
        _append_spot(history, r["name"], r["spot"])
    _write_history(history)
    return {"date": date, "source": "sunsirs", "rows": rows, "history": history}


def chem_spot(cid: str, name: str = "") -> dict:
    if not re.fullmatch(r"\d{1,10}", str(cid or "")):
        raise ValueError("chem id must be digits")
    label = str(name or cid)[:40]
    if label in _BAD_KEYS:
        raise ValueError("invalid name")
    html = fetch_sunsir(f"https://www.100ppi.com/mprice/plist-1-{cid}-1.html")
    market, all_p, date = parse_chem_quotes(html)
    if not all_p:
        raise RuntimeError("chem spot parse empty")
    pool = market or all_p
    price = _median(pool)
    history = _read_history()
    arr = _append_spot(history, label, price)
    if arr is not None:
        _write_history(history)
    return {
        "id": cid,
        "name": label,
        "price": price,
        "quotes": len(all_p),
        "date": date or _bj_today(),
        "source": "sunsirs",
        "history": arr or [],
    }
