"""Tradable mask: ST / delist-by-name, and 次新 from first bar.

Not Omicron. Names are today's names (lookahead). 次新 uses the first
finite bar on this panel, not a second IPO table. Short panels skip 次新.
"""

from __future__ import annotations

import numpy as np

from backtest.panel import Panel

DEFAULT_EXCLUDE_ST = True
DEFAULT_MIN_LIST_DAYS = 60


def parse_screen(body: dict | None) -> tuple[bool, int]:
    raw = body or {}
    exclude_st = DEFAULT_EXCLUDE_ST if "exclude_st" not in raw else bool(raw.get("exclude_st"))
    try:
        days = int(raw["min_list_days"]) if "min_list_days" in raw else DEFAULT_MIN_LIST_DAYS
    except (TypeError, ValueError):
        days = DEFAULT_MIN_LIST_DAYS
    return exclude_st, max(0, days)


def name_blocked(name: str) -> bool:
    """ST / *ST / 退市整理 by the current display name."""
    if not name:
        return False
    return "ST" in name.upper() or "退" in name


def _code6(sym: str) -> str:
    digits = "".join(c for c in (sym or "") if c.isdigit())
    return digits[-6:] if len(digits) >= 6 else digits


def _lookup_name(sym: str, names: dict[str, str]) -> str:
    return names.get(sym) or names.get(_code6(sym)) or ""


def _first_bar(panel: Panel, j: int) -> int:
    for i in range(panel.T):
        if np.isfinite(panel.close[i, j]) and np.isfinite(panel.open[i, j]):
            return i
    return -1


def _merge_names(panel: Panel, names: dict[str, str] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        import universe

        out.update(universe.read_names(fresh_only=False))
    except Exception:
        pass
    if names:
        out.update(names)
    out.update(panel.names or {})
    return out


def build_mask(
    panel: Panel,
    *,
    exclude_st: bool = DEFAULT_EXCLUDE_ST,
    min_list_days: int = DEFAULT_MIN_LIST_DAYS,
    names: dict[str, str] | None = None,
) -> tuple[np.ndarray | None, list[str]]:
    """T x S tradable. None means do not change the existing mask."""
    notes: list[str] = []
    skip_new = min_list_days <= 0 or panel.T <= min_list_days
    if skip_new and min_list_days > 0 and panel.T <= min_list_days:
        notes.append(f"日 K 只有 {panel.T} 根, 次新 {min_list_days} 日未启用")
    if not exclude_st and skip_new:
        return None, notes

    merged = _merge_names(panel, names)
    mask = np.ones((panel.T, panel.S), dtype=bool)
    st_n = 0
    new_n = 0
    for j, sym in enumerate(panel.symbols):
        if exclude_st and name_blocked(_lookup_name(sym, merged)):
            mask[:, j] = False
            st_n += 1
            continue
        if skip_new:
            continue
        first = _first_bar(panel, j)
        if first < 0:
            mask[:, j] = False
            continue
        cut = first + min_list_days
        if cut > 0:
            mask[: min(cut, panel.T), j] = False
            if first + min_list_days > 0:
                new_n += 1
    if exclude_st:
        notes.append(
            f"已剔除名称含 ST / 退 的标的 {st_n} 只 (用今天的名字, 有前视)"
            if st_n
            else "已按名称剔 ST / 退 (用今天的名字, 有前视); 这批没有"
        )
    if not skip_new:
        notes.append(
            f"次新按本面板第一根 bar 计, 上市未满 {min_list_days} 个交易日不买 ({new_n} 只前段被挡)"
        )
    if not mask.any():
        notes.append("可交易掩码是空的: ST / 次新把截面滤光了")
    if mask.all():
        return None, notes
    return mask, notes


def apply_from_body(
    panel: Panel,
    body: dict | None,
    member_mask: np.ndarray | None = None,
) -> tuple[np.ndarray | None, list[str]]:
    exclude_st, min_list_days = parse_screen(body)
    extra, notes = build_mask(
        panel,
        exclude_st=exclude_st,
        min_list_days=min_list_days,
    )
    if extra is None:
        return member_mask, notes
    if member_mask is None:
        return extra, notes
    return member_mask & extra, notes
