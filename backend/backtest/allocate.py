"""Score to target weights. Cap and industry demean, no cvxpy."""

from __future__ import annotations

import numpy as np

from backtest.rules import digits6


def industry_of(symbol: str, lookup: dict[str, str] | None = None) -> str:
    """Last-level Tonghuashun industry. Empty if unknown. Lookup is injectable."""
    code = digits6(symbol)
    if lookup is not None:
        return str(lookup.get(symbol) or lookup.get(code) or "")
    try:
        import ths_ext

        row = ths_ext.profile(code)
    except Exception:
        return ""
    inds = row.get("industries") or []
    if not isinstance(inds, list) or not inds:
        return ""
    return str(inds[-1] or "").strip()


def industry_labels(symbols: list[str], lookup: dict[str, str] | None = None) -> list[str]:
    return [industry_of(s, lookup) for s in symbols]


def neutralize(scores: np.ndarray, labels: list[str]) -> np.ndarray:
    """Subtract industry mean. Missing industry is its own group, not faked."""
    out = np.array(scores, dtype=float, copy=True)
    n = out.size
    if n == 0 or len(labels) != n:
        return out
    groups: dict[str, list[int]] = {}
    for j, lab in enumerate(labels):
        key = lab if lab else "_none"
        groups.setdefault(key, []).append(j)
    for idxs in groups.values():
        vals = out[idxs]
        ok = np.isfinite(vals)
        if int(ok.sum()) < 1:
            continue
        mu = float(np.mean(vals[ok]))
        for j in idxs:
            if np.isfinite(out[j]):
                out[j] = out[j] - mu
    return out


def scores_to_weights(
    scores: np.ndarray,
    *,
    top_k: int,
    max_weight: float = 0.0,
    industry_neutral: bool = False,
    exposure: float = 1.0,
    weight: str = "equal",
    industries: list[str] | None = None,
) -> tuple[np.ndarray, dict]:
    """Turn a 1-d score row into portfolio weights. Sum <= exposure."""
    x = np.asarray(scores, dtype=float)
    n = int(x.size)
    w = np.zeros(n, dtype=float)
    notes = {"missing_industry": 0, "picked": 0}
    if n < 1 or top_k < 1:
        return w, notes
    if industries:
        notes["missing_industry"] = sum(1 for lab in industries if not lab)
    work = neutralize(x, industries) if industry_neutral and industries else x
    order = np.argsort(-np.where(np.isfinite(work), work, -np.inf), kind="mergesort")
    picks = [int(j) for j in order if np.isfinite(work[int(j)])][:top_k]
    notes["picked"] = len(picks)
    if not picks:
        return w, notes
    raw = np.zeros(len(picks), dtype=float)
    if weight == "factor_weight":
        raw = np.abs(np.array([work[j] for j in picks], dtype=float))
        raw = np.where(np.isfinite(raw), raw, 0.0)
        if float(raw.sum()) <= 0:
            raw = np.ones(len(picks), dtype=float)
    else:
        raw = np.ones(len(picks), dtype=float)
    raw = raw / float(raw.sum())
    cap = float(max_weight) if max_weight and max_weight > 0 else 0.0
    if cap > 0:
        raw = np.minimum(raw, cap)
        total = float(raw.sum())
        if total > 1e-12:
            raw = raw / total
            raw = np.minimum(raw, cap)
    expo = min(max(float(exposure), 0.0), 1.0)
    raw = raw * expo
    for k, j in enumerate(picks):
        w[j] = float(raw[k])
    return w, notes
