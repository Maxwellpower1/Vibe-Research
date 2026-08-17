"""Immutable experiment folders: runs/<id>/. Write once, never rewrite."""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from backtest.market import data_root

RUN_FILES = ("config.json", "trades.json", "equity.json", "factor.json", "meta.json")


class RunLocked(RuntimeError):
    """A finished run cannot be changed."""


def runs_root() -> Path:
    return data_root() / "backtest" / "runs"


def new_run_id(now: datetime | None = None) -> str:
    ts = (now or datetime.now(timezone.utc)).strftime("%Y%m%d-%H%M%S")
    return f"{ts}-{uuid4().hex[:6]}"


def run_dir(run_id: str) -> Path:
    safe = "".join(c for c in run_id if c.isalnum() or c in ("-", "_"))
    return runs_root() / safe


def _dump(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_files(run_id: str, files: dict[str, object]) -> Path:
    dest = run_dir(run_id)
    if dest.exists():
        raise RunLocked(f"实验 {run_id} 已写完, 不能改")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f".tmp-{dest.name}-{uuid4().hex[:4]}")
    if tmp.exists():
        shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    try:
        for name, payload in files.items():
            _dump(tmp / name, payload)
        os.replace(tmp, dest)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return dest


def write_run(run_id: str, *, config: dict, trades: list, equity: dict, meta: dict) -> Path:
    packed = dict(meta)
    packed.setdefault("kind", "account")
    return _write_files(run_id, {
        "config.json": config,
        "trades.json": trades,
        "equity.json": equity,
        "meta.json": packed,
    })


def write_factor_run(run_id: str, *, config: dict, result: dict, meta: dict) -> Path:
    packed = dict(meta)
    packed["kind"] = "factor"
    return _write_files(run_id, {
        "config.json": config,
        "factor.json": result,
        "meta.json": packed,
    })


def read_run(run_id: str) -> dict | None:
    dest = run_dir(run_id)
    if not dest.is_dir():
        return None
    out: dict = {"id": run_id}
    for name in RUN_FILES:
        path = dest / name
        if not path.is_file():
            continue
        try:
            out[name.replace(".json", "")] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
    return out if "meta" in out else None


def list_runs(limit: int = 40, kind: str | None = None) -> list[dict]:
    root = runs_root()
    if not root.is_dir():
        return []
    want = (kind or "").strip().lower() or None
    rows: list[dict] = []
    for child in root.iterdir():
        if not child.is_dir() or child.name.startswith("."):
            continue
        meta_path = child / "meta.json"
        if not meta_path.is_file():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(meta, dict):
            continue
        row_kind = str(meta.get("kind") or "account")
        if want and row_kind != want:
            continue
        factor = meta.get("factor") if isinstance(meta.get("factor"), dict) else {}
        rows.append({
            "id": child.name,
            "kind": row_kind,
            "created": meta.get("created"),
            "data_hash": meta.get("data_hash"),
            "strategy": meta.get("strategy"),
            "factor": factor.get("id") or meta.get("factor_id"),
            "factor_label": factor.get("label"),
            "symbols": meta.get("symbols") or [],
            "start": meta.get("start"),
            "end": meta.get("end"),
            "total_return": (meta.get("stats") or {}).get("total_return"),
            "sharpe": (meta.get("stats") or {}).get("sharpe"),
            "excess_return": (meta.get("stats") or {}).get("excess_return"),
            "ic_mean": meta.get("ic_mean"),
        })
    rows.sort(key=lambda r: str(r.get("created") or r["id"]), reverse=True)
    return rows[: max(1, min(int(limit), 100))]


def delete_run(run_id: str) -> bool:
    dest = run_dir(run_id)
    if not dest.is_dir():
        return False
    shutil.rmtree(dest)
    return True


HASH_SYMBOL_CAP = 40


def _data_hash_check(
    pack: dict, *, skip: bool = False
) -> tuple[object, object | None, bool | None, list[str]]:
    """Compare stored hash to local parquet. Skip when the panel is too wide."""
    meta = pack.get("meta") or {}
    stored = meta.get("data_hash")
    extra: list[str] = []
    if skip:
        return stored, None, None, extra
    symbols = meta.get("symbols") or (pack.get("config") or {}).get("codes") or []
    start = meta.get("start")
    end = meta.get("end")
    if not (isinstance(symbols, list) and symbols and start and end):
        return stored, None, None, extra
    if len(symbols) > HASH_SYMBOL_CAP:
        extra.append(f"回看未重算行情哈希, {len(symbols)} 只超过 {HASH_SYMBOL_CAP}, 打开不再扫库存")
        return stored, None, None, extra
    now = None
    match = None
    try:
        from backtest.store import panel_hash

        now = panel_hash(list(symbols), str(start), str(end))
        if now is not None and stored:
            match = now == stored
    except Exception:
        match = None
    if match is False:
        extra.append(f"本机行情已变, 实验哈希 {stored}, 现在 {now}")
    return stored, now, match, extra


def _rollup_trades(trades: object) -> list[dict]:
    from backtest.matcher import rollup_trades

    return rollup_trades(trades if isinstance(trades, list) else [])


def _tearsheet(curve: object) -> dict:
    from backtest.matcher import tearsheet

    return tearsheet(curve if isinstance(curve, list) else [])


def result_from_factor(pack: dict) -> dict:
    """Rebuild a factor research payload from an immutable run."""
    meta = pack.get("meta") or {}
    out = dict(pack.get("factor") or {})
    stored, now, match, extra = _data_hash_check(pack, skip=True)
    warnings = list(out.get("warnings") or meta.get("warnings") or [])
    warnings.extend(extra)
    out.update({
        "run_id": pack.get("id") or meta.get("id"),
        "created": meta.get("created"),
        "data_hash": stored,
        "data_hash_now": now,
        "data_hash_match": match,
        "config": pack.get("config") or out.get("config") or {},
        "warnings": warnings,
    })
    return out


def result_from_run(pack: dict) -> dict:
    """Rebuild the API payload from an immutable run."""
    meta = pack.get("meta") or {}
    if str(meta.get("kind") or "") == "factor" or pack.get("factor"):
        return result_from_factor(pack)
    equity = pack.get("equity") or {}
    stored, now, match, extra = _data_hash_check(pack)
    warnings = list(meta.get("warnings") or [])
    warnings.extend(extra)
    return {
        "run_id": pack.get("id") or meta.get("id"),
        "data_hash": stored,
        "data_hash_now": now,
        "data_hash_match": match,
        "created": meta.get("created"),
        "equity_curve": equity.get("equity_curve") or [],
        "drawdown_curve": equity.get("drawdown_curve") or [],
        "benchmark": equity.get("benchmark"),
        "trades": pack.get("trades") or [],
        "by_symbol": _rollup_trades(pack.get("trades") or []),
        "stats": meta.get("stats") or {},
        "execution": meta.get("execution") or {},
        "universe": meta.get("universe") or {},
        "strategy": meta.get("strategy") or {},
        "warnings": warnings,
        "disclaimer": meta.get("disclaimer") or "",
        "config": pack.get("config") or {},
        "closed_end": meta.get("closed_end"),
        "oos": meta.get("oos"),
        "walk_forward": meta.get("walk_forward"),
        "tearsheet": _tearsheet(equity.get("equity_curve") or []),
    }
