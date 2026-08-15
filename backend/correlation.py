"""Cross-asset daily-return correlation (Pearson). No scipy."""
from __future__ import annotations

from typing import Any

import ext_feeds

_MAX_CODES = 12
_MIN_OVERLAP = 20


def pearson(xs: list[float], ys: list[float]) -> float | None:
    """Pearson r for two equal-length series. None if too short or zero variance."""
    n = len(xs)
    if n < 5 or n != len(ys):
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = sum((x - mx) ** 2 for x in xs) ** 0.5
    dy = sum((y - my) ** 2 for y in ys) ** 0.5
    if dx == 0 or dy == 0:
        return None
    return round(num / (dx * dy), 4)


def _returns(bars: list[dict], window: int) -> dict[str, float]:
    """date -> pct change, last `window` closes."""
    closes: list[tuple[str, float]] = []
    for b in bars or []:
        try:
            dt = str(b.get("date") or b.get("datetime") or "")[:10]
            c = float(b["close"])
        except (TypeError, ValueError, KeyError):
            continue
        if dt and c > 0:
            closes.append((dt, c))
    closes.sort(key=lambda x: x[0])
    closes = closes[-(window + 1):]
    out: dict[str, float] = {}
    for i in range(1, len(closes)):
        prev = closes[i - 1][1]
        if prev:
            out[closes[i][0]] = (closes[i][1] - prev) / prev
    return out


def correlation_matrix(codes: list[str], window: int = 60) -> dict[str, Any]:
    """Fetch daily bars and return a Pearson matrix on overlapping returns."""
    raw = [c.strip() for c in codes if str(c).strip()]
    seen: set[str] = set()
    uniq: list[str] = []
    for c in raw:
        key = c.upper()
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
        if len(uniq) >= _MAX_CODES:
            break
    if len(uniq) < 2:
        return {"error": "至少需要 2 个代码, 最多 12 个"}

    win = max(20, min(int(window or 60), 250))
    series: dict[str, dict[str, float]] = {}
    meta: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for code in uniq:
        try:
            kl = ext_feeds.fetch_kline(code, num=win + 40, source="auto")
        except Exception as exc:  # noqa: BLE001 - one symbol must not abort the matrix
            errors.append({"code": code, "error": str(exc)})
            continue
        if kl.get("error"):
            errors.append({"code": code, "error": str(kl["error"])})
            continue
        rets = _returns(kl.get("bars") or [], win)
        if len(rets) < _MIN_OVERLAP:
            errors.append({"code": code, "error": "有效收益序列不足 20 日"})
            continue
        series[code] = rets
        meta.append({
            "code": kl.get("code") or code,
            "input": code,
            "name": kl.get("name") or code,
            "market": kl.get("market"),
            "source": kl.get("source"),
            "bars": len(kl.get("bars") or []),
            "returns": len(rets),
        })

    labels = list(series.keys())
    if len(labels) < 2:
        return {"error": "有效序列不足 2 条, 无法计算相关", "errors": errors, "series": meta}

    matrix: list[list[float | None]] = []
    for a in labels:
        row: list[float | None] = []
        for b in labels:
            if a == b:
                row.append(1.0)
                continue
            dates = sorted(set(series[a]) & set(series[b]))
            if len(dates) < _MIN_OVERLAP:
                row.append(None)
                continue
            row.append(pearson([series[a][d] for d in dates], [series[b][d] for d in dates]))
        matrix.append(row)

    return {
        "window": win,
        "codes": labels,
        "series": meta,
        "matrix": matrix,
        "errors": errors,
        "note": "Pearson on overlapping daily pct_change. Not a forecast.",
    }
