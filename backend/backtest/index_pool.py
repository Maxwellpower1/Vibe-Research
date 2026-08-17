"""Latest index constituents for the backtest form.

Fills the static pool. Not daily PIT replay, not a second cockpit catalog.
Eastmoney clist first; Sina node list if push2 is blocked.
"""

from __future__ import annotations

import logging
from typing import Callable

import astock
from backtest.market import last_closed_iso, members_asof, write_members

log = logging.getLogger(__name__)

# Use index_catalog codes only. 上证50 is not in the cockpit list.
POOLS: tuple[dict[str, str], ...] = (
    {"id": "sh000300", "label": "沪深300", "fs": "b:1.000300", "sina": "hs300"},
    {"id": "sh000905", "label": "中证500", "fs": "b:1.000905", "sina": "zhishu_000905"},
    {"id": "sh000688", "label": "科创50", "fs": "b:1.000688", "sina": "zhishu_000688"},
    {"id": "sz399006", "label": "创业板指", "fs": "b:0.399006", "sina": "zhishu_399006"},
)

NOTE = "今天的成分快照, 不是按日 PIT. 填进表单后仍是静态池, 有幸存者偏差."

_SINA_LIST = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"
_SINA_COUNT = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount"
_EM_UT = "bd1d9ddb04089700cf9c27f6f7426281"


def pool_meta() -> list[dict[str, str]]:
    return [{"id": p["id"], "label": p["label"]} for p in POOLS]


def _spec(index_id: str) -> dict[str, str] | None:
    want = (index_id or "").strip().lower()
    return next((p for p in POOLS if p["id"] == want), None)


def _digits(sym: str) -> str:
    resolved = astock.resolve_symbol(sym)
    if resolved:
        return resolved[-6:]
    raw = (sym or "").strip()
    return raw[-6:] if len(raw) >= 6 and raw[-6:].isdigit() else ""


def _resolve_all(raw: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        sym = astock.resolve_symbol(str(item))
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def _codes_from_maps(rows: list, key: str) -> list[str]:
    codes: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw = str(row.get(key) or "").strip()
        if not raw:
            continue
        code = raw.zfill(6)
        if len(code) == 6 and code.isdigit() and code != "000000":
            codes.append(code)
    return codes


def fetch_eastmoney(index_id: str) -> list[str]:
    """Eastmoney push2 clist. Delay host first: live push2 is often reset."""
    spec = _spec(index_id)
    if not spec:
        return []
    headers = {"User-Agent": astock.UA, "Referer": "https://quote.eastmoney.com/"}
    for host in ("push2delay.eastmoney.com", "push2.eastmoney.com"):
        collected: list[str] = []
        for pn in range(1, 7):
            params = {
                "pn": str(pn), "pz": "100", "po": "0", "np": "1",
                "fltt": "2", "invt": "2", "fid": "f12",
                "fs": spec["fs"], "fields": "f12,f14", "ut": _EM_UT,
            }
            try:
                d = astock.em_get(
                    f"https://{host}/api/qt/clist/get",
                    params=params, headers=headers, timeout=12,
                ).json()
            except Exception:
                break
            raw = (d.get("data") or {}).get("diff") or []
            if isinstance(raw, dict):
                raw = list(raw.values())
            page = _codes_from_maps(raw, "f12")
            if not page:
                break
            collected.extend(page)
            if len(page) < 100:
                break
        if collected:
            return collected
    return []


def fetch_sina(index_id: str) -> list[str]:
    """Sina quote-center node. Works when Eastmoney push2 is blocked."""
    spec = _spec(index_id)
    if not spec:
        return []
    node = spec["sina"]
    headers = {"User-Agent": astock.UA, "Referer": "https://vip.stock.finance.sina.com.cn/"}
    total = 0
    try:
        raw = astock.em_get(_SINA_COUNT, params={"node": node}, headers=headers, timeout=12).json()
        if raw not in (None, [], ""):
            total = int(raw)
    except Exception:
        total = 0
    out: list[str] = []
    for page in range(1, 9):
        try:
            rows = astock.em_get(
                _SINA_LIST,
                params={"page": str(page), "num": "80", "sort": "symbol", "asc": "1", "node": node},
                headers=headers,
                timeout=12,
            ).json()
        except Exception:
            break
        if not isinstance(rows, list) or not rows:
            break
        out.extend(_codes_from_maps(rows, "code"))
        if total and len(out) >= total:
            break
        if len(rows) < 80:
            break
    return out


def fetch_members(index_id: str) -> list[str]:
    """Eastmoney first, Sina if that list is empty."""
    got = fetch_eastmoney(index_id)
    if got:
        return got
    log.info("index pool %s eastmoney empty, try sina", index_id)
    return fetch_sina(index_id)


def _pack(
    spec: dict[str, str],
    asof: str,
    symbols: list[str],
    *,
    source: str,
    extra: str = "",
) -> dict:
    codes = [c for c in (_digits(s) for s in symbols) if c]
    note = NOTE if not extra else f"{NOTE} {extra}"
    return {
        "id": spec["id"],
        "label": spec["label"],
        "asof": asof,
        "codes": codes,
        "n": len(codes),
        "stored": True,
        "source": source,
        "note": note,
    }


def load_index_pool(
    index_id: str,
    *,
    refresh: bool = False,
    fetch_fn: Callable[[str], list[str]] | None = None,
) -> dict:
    """Latest constituents. Cache when today's snapshot exists."""
    from backtest.service import BacktestError

    spec = _spec(index_id)
    if not spec:
        raise BacktestError(f"不支持的指数: {index_id or '(空)'}")
    asof = last_closed_iso()
    snap_day, cached = members_asof(spec["id"], asof)
    if cached and not refresh and snap_day == asof:
        return _pack(spec, snap_day, cached, source="cache")

    getter = fetch_fn or fetch_members
    try:
        raw = getter(spec["id"]) or []
    except Exception as e:  # noqa: BLE001
        if cached:
            return _pack(spec, snap_day, cached, source="cache", extra=f"现拉失败, 用 {snap_day} 快照")
        raise BacktestError(f"{spec['label']} 成分没取到: {e}") from e

    symbols = _resolve_all([str(x) for x in raw])
    if not symbols:
        if cached:
            return _pack(spec, snap_day, cached, source="cache", extra="现拉为空, 用已存快照")
        raise BacktestError(f"{spec['label']} 成分没取到")

    write_members(spec["id"], asof, symbols)
    return _pack(spec, asof, symbols, source="live")
