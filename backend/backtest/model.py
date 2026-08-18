"""Train a daily score on the same panel, then feed top_k.

LightGBM is optional. Grid only sees the IS cut. Not a live trainer.
"""

from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from backtest.factor import FACTORS, factor_matrix, spearman
from backtest.labels import forward_returns
from backtest.panel import Panel

FEATURE_IDS = [fid for fid, spec in FACTORS.items() if spec.get("kind") != "pit"]
GRID = (
    {"num_leaves": 15, "learning_rate": 0.05, "n_estimators": 60},
    {"num_leaves": 31, "learning_rate": 0.05, "n_estimators": 60},
    {"num_leaves": 15, "learning_rate": 0.1, "n_estimators": 60},
)
DISCLAIMER = (
    "模型研究, 分数进同一套账户撮合, 不接券商。"
    "网格只在切点前选. 没装 lightgbm 时接口会说明。"
    "宇宙仍 <=600, 不是每天重选全 A。"
)


def _lgb():
    try:
        import lightgbm as lgb
    except ImportError:
        return None
    return lgb


def feature_cube(panel: Panel, ids: list[str] | None = None) -> tuple[np.ndarray, list[str]]:
    use = ids or FEATURE_IDS
    mats = [factor_matrix(panel, fid) for fid in use]
    return np.stack(mats, axis=2), use


def flatten_xy(
    cube: np.ndarray,
    labels: np.ndarray,
    t0: int,
    t1: int,
) -> tuple[np.ndarray, np.ndarray]:
    rows: list[np.ndarray] = []
    ys: list[float] = []
    for i in range(t0, t1):
        for j in range(cube.shape[1]):
            feat = cube[i, j]
            y = labels[i, j]
            if np.isfinite(y) and np.isfinite(feat).all():
                rows.append(feat)
                ys.append(float(y))
    if not rows:
        return np.zeros((0, cube.shape[2])), np.zeros(0)
    return np.vstack(rows), np.asarray(ys, dtype=float)


def predict_scores(cube: np.ndarray, booster) -> np.ndarray:
    t, s, f = cube.shape
    out = np.full((t, s), np.nan)
    flat = cube.reshape(t * s, f)
    ok = np.isfinite(flat).all(axis=1)
    if not ok.any():
        return out
    pred = booster.predict(flat[ok])
    filled = np.full(t * s, np.nan)
    filled[ok] = pred
    return filled.reshape(t, s)


def _psi(a: np.ndarray, b: np.ndarray, bins: int = 10) -> float | None:
    aa = a[np.isfinite(a)]
    bb = b[np.isfinite(b)]
    if aa.size < 10 or bb.size < 10:
        return None
    edges = np.unique(np.quantile(aa, np.linspace(0, 1, bins + 1)))
    if edges.size < 3:
        return 0.0
    e = np.clip(np.histogram(aa, edges)[0] / aa.size, 1e-6, None)
    n = np.clip(np.histogram(bb, edges)[0] / bb.size, 1e-6, None)
    return float(np.sum((n - e) * np.log(n / e)))


def _ks(a: np.ndarray, b: np.ndarray) -> float | None:
    aa = np.sort(a[np.isfinite(a)])
    bb = np.sort(b[np.isfinite(b)])
    if aa.size < 5 or bb.size < 5:
        return None
    i = j = 0
    fa = fb = 0.0
    d = 0.0
    na, nb = aa.size, bb.size
    while i < na and j < nb:
        if aa[i] <= bb[j]:
            i += 1
            fa = i / na
        else:
            j += 1
            fb = j / nb
        d = max(d, abs(fa - fb))
    return float(d)


def drift_summary(cube: np.ndarray, names: list[str], split_idx: int) -> list[dict]:
    rows: list[dict] = []
    for k, name in enumerate(names):
        is_v = cube[:split_idx, :, k].ravel()
        oos_v = cube[split_idx:, :, k].ravel()
        rows.append({
            "feature": name,
            "psi": None if (p := _psi(is_v, oos_v)) is None else round(p, 4),
            "ks": None if (kstat := _ks(is_v, oos_v)) is None else round(kstat, 4),
        })
    return rows


def _ic_of(pred: np.ndarray, labels: np.ndarray, t0: int, t1: int) -> float | None:
    ics: list[float] = []
    for i in range(t0, t1):
        ok = np.isfinite(pred[i]) & np.isfinite(labels[i])
        if int(ok.sum()) < 8:
            continue
        val = spearman(pred[i][ok], labels[i][ok])
        if np.isfinite(val):
            ics.append(float(val))
    if not ics:
        return None
    return float(np.mean(ics))


def fit_predict(
    panel: Panel,
    split_idx: int,
    horizon: int = 5,
    *,
    tune: bool = False,
    feature_ids: list[str] | None = None,
) -> tuple[np.ndarray, dict]:
    lgb = _lgb()
    if lgb is None:
        from backtest.service import BacktestError

        raise BacktestError("没装 lightgbm, pip install lightgbm 后再跑模型页")
    cube, names = feature_cube(panel, feature_ids)
    labels = forward_returns(panel, horizon)
    train_end = max(0, split_idx - horizon)
    x, y = flatten_xy(cube, labels, 0, train_end)
    if x.shape[0] < 40:
        from backtest.service import BacktestError

        raise BacktestError("样本内有效训练点不够, 加长区间或减少前瞻")
    candidates = list(GRID) if tune else [GRID[0]]
    best: tuple[float, dict, object] | None = None
    grid_rows: list[dict] = []
    for params in candidates:
        booster = lgb.LGBMRegressor(
            n_estimators=int(params["n_estimators"]),
            num_leaves=int(params["num_leaves"]),
            learning_rate=float(params["learning_rate"]),
            verbosity=-1,
        )
        booster.fit(x, y)
        pred = predict_scores(cube, booster)
        ic = _ic_of(pred, labels, 0, train_end)
        row = {**params, "is_ic": None if ic is None else round(ic, 4)}
        grid_rows.append(row)
        score = ic if ic is not None else -999.0
        if best is None or score > best[0]:
            best = (score, params, booster)
    assert best is not None
    scores = predict_scores(cube, best[2])
    return scores, {
        "backend": "lightgbm",
        "features": names,
        "horizon": horizon,
        "split": panel.dates[split_idx] if 0 <= split_idx < panel.T else None,
        "n_train": int(x.shape[0]),
        "params": best[1],
        "is_ic": None if best[0] < -100 else round(best[0], 4),
        "oos_ic": _ic_of(scores, labels, split_idx, max(split_idx, panel.T - horizon)),
        "grid": grid_rows if tune else [],
        "drift": drift_summary(cube, names, split_idx),
        "n_features": len(names),
    }


def run_model(body: dict, *, bars_by_symbol: dict[str, list[dict]] | None = None, fetch_fn=None, score_matrix=None) -> dict:
    from backtest.archive import new_run_id, write_model_run
    from backtest.matcher import run_match, tearsheet
    from backtest.oos import OosError, oos_fresh, resolve_split
    from backtest.progress import begin, finish, mark
    from backtest.service import BacktestError, _cfg_from_body, lookback_range, load_panel, resolve_codes
    from backtest.signals import build_signals
    import trading_calendar as tc

    start, end = lookback_range(body.get("lookback"), body.get("start"), body.get("end"))
    symbols = resolve_codes(body.get("codes") or [])
    if len(symbols) < 2:
        raise BacktestError("模型至少需要 2 只")
    horizon = int(body.get("horizon") or 5)
    if horizon < 1 or horizon > 60:
        raise BacktestError("horizon 要在 1 到 60")
    tune = bool(body.get("tune") or body.get("tune_ma"))
    cfg = _cfg_from_body(body)
    begin(kind="model", step="load", total=len(symbols), note=f"{len(symbols)} 只")
    try:
        panel, warnings, _names, src = load_panel(
            symbols,
            start,
            end,
            bars_by_symbol=bars_by_symbol,
            fetch_fn=fetch_fn,
            use_cache=bars_by_symbol is None,
        )
        mark(step="train")
        try:
            split_idx = resolve_split(
                panel.dates,
                oos_frac=float(body["oos_frac"]) if body.get("oos_frac") not in (None, "") else 0.3,
                oos_date=str(body["oos_date"]) if body.get("oos_date") else None,
            )
        except OosError as e:
            raise BacktestError(str(e)) from e
        if score_matrix is None:
            scores, info = fit_predict(panel, split_idx, horizon, tune=tune)
        else:
            scores = np.asarray(score_matrix, dtype=float)
            if scores.shape != (panel.T, panel.S):
                raise BacktestError("注入的分数矩阵形状要和面板一致")
            info = {"backend": "injected", "features": [], "horizon": horizon, "drift": []}
        industries = None
        if cfg.industry_neutral:
            from backtest.allocate import industry_labels

            industries = industry_labels(panel.symbols)
            missing = sum(1 for lab in industries if not lab)
            if missing:
                warnings.append(f"行业中性: {missing} 只没有板块归属, 单独一组, 不假装中性")
        from backtest.screen import apply_from_body, parse_screen

        member_mask, screen_notes = apply_from_body(panel, body, None)
        warnings.extend(screen_notes)
        exclude_st, min_list_days = parse_screen(body)
        mark(step="match")
        entries, exits, notes, targets = build_signals(
            panel,
            "top_k",
            mom_win=int(body.get("mom_win") or 20),
            rebalance=int(body.get("rebalance") or 20),
            top_k=cfg.max_positions,
            member_mask=member_mask,
            score_matrix=scores,
            max_weight=cfg.max_weight,
            industry_neutral=cfg.industry_neutral,
            exposure=cfg.exposure,
            industries=industries,
        )
        warnings.extend(notes)
        out = run_match(panel, entries, exits, cfg, targets=targets)
        out["tearsheet"] = tearsheet(out.get("equity_curve") or [])
        fresh = oos_fresh(
            panel,
            split_idx,
            "top_k",
            cfg,
            mom_win=int(body.get("mom_win") or 20),
            rebalance=int(body.get("rebalance") or 20),
            top_k=cfg.max_positions,
            member_mask=member_mask,
            score_matrix=scores,
            max_weight=cfg.max_weight,
            industry_neutral=cfg.industry_neutral,
            exposure=cfg.exposure,
            industries=industries,
        )
        split_date = panel.dates[split_idx]
        out["oos"] = {
            "split": split_date,
            "is_bars": split_idx,
            "oos_bars": panel.T - split_idx,
            "stats_oos_fresh": fresh["stats"],
            "note": "模型在切点前训练; stats_oos_fresh 是切点后新开的一笔钱.",
        }
        out["stats"]["oos_fresh_return"] = fresh["stats"].get("total_return")
        out["stats"]["oos_fresh_sharpe"] = fresh["stats"].get("sharpe")
        if info.get("oos_ic") is not None:
            info["oos_ic"] = None if info["oos_ic"] is None else round(float(info["oos_ic"]), 4)
        out["model"] = info
        out["strategy"] = {
            "name": "model",
            "horizon": horizon,
            "rebalance": int(body.get("rebalance") or 20),
            "top_k": cfg.max_positions,
            "tuned": tune,
        }
        out["universe"] = {
            "symbols": panel.symbols,
            "names": panel.names,
            "start": panel.dates[0],
            "end": panel.dates[-1],
            "bars": panel.T,
            "from_store": src["from_store"],
            "fetched": src["fetched"],
        }
        warnings.append("模型分数进 Top-K 目标权重, 同一套 T+1 / 整手 / 次日开盘")
        out["warnings"] = warnings
        out["disclaimer"] = DISCLAIMER
        out["data_hash"] = panel.data_hash()
        run_id = new_run_id()
        cfg_payload = {
            "codes": symbols,
            "start": start,
            "end": end,
            "strategy": "model",
            "horizon": horizon,
            "rebalance": int(body.get("rebalance") or 20),
            "mom_win": int(body.get("mom_win") or 20),
            "tune": tune,
            "matcher": {
                "initial_capital": cfg.initial_capital,
                "max_positions": cfg.max_positions,
                "max_weight": cfg.max_weight,
                "industry_neutral": cfg.industry_neutral,
            },
            "exclude_st": exclude_st,
            "min_list_days": min_list_days,
        }
        out["config"] = cfg_payload
        mark(step="write")
        write_model_run(
            run_id,
            config=cfg_payload,
            result={k: v for k, v in info.items()},
            trades=out.get("trades") or [],
            equity={
                "equity_curve": out.get("equity_curve") or [],
                "drawdown_curve": out.get("drawdown_curve") or [],
            },
            meta={
                "id": run_id,
                "kind": "model",
                "created": datetime.now(timezone.utc).isoformat(),
                "data_hash": out["data_hash"],
                "closed_end": tc.last_closed_session().isoformat(),
                "strategy": out.get("strategy"),
                "symbols": panel.symbols,
                "start": panel.dates[0],
                "end": panel.dates[-1],
                "stats": out.get("stats"),
                "execution": out.get("execution"),
                "universe": out.get("universe"),
                "warnings": warnings,
                "disclaimer": DISCLAIMER,
                "oos": out.get("oos"),
                "model": info,
            },
        )
        out["run_id"] = run_id
        return out
    finally:
        finish()
