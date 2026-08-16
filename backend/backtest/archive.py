"""Immutable experiment folders: runs/<id>/. Write once, never rewrite."""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from backtest.market import data_root

RUN_FILES = ("config.json", "trades.json", "equity.json", "meta.json")


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


def write_run(run_id: str, *, config: dict, trades: list, equity: dict, meta: dict) -> Path:
    dest = run_dir(run_id)
    if dest.exists():
        raise RunLocked(f"实验 {run_id} 已写完, 不能改")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f".tmp-{dest.name}-{uuid4().hex[:4]}")
    if tmp.exists():
        shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    try:
        _dump(tmp / "config.json", config)
        _dump(tmp / "trades.json", trades)
        _dump(tmp / "equity.json", equity)
        _dump(tmp / "meta.json", meta)
        os.replace(tmp, dest)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return dest


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


def list_runs(limit: int = 40) -> list[dict]:
    root = runs_root()
    if not root.is_dir():
        return []
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
        rows.append({
            "id": child.name,
            "created": meta.get("created"),
            "data_hash": meta.get("data_hash"),
            "strategy": meta.get("strategy"),
            "symbols": meta.get("symbols") or [],
            "start": meta.get("start"),
            "end": meta.get("end"),
            "total_return": (meta.get("stats") or {}).get("total_return"),
            "sharpe": (meta.get("stats") or {}).get("sharpe"),
            "excess_return": (meta.get("stats") or {}).get("excess_return"),
        })
    rows.sort(key=lambda r: str(r.get("created") or r["id"]), reverse=True)
    return rows[: max(1, min(int(limit), 100))]


def delete_run(run_id: str) -> bool:
    dest = run_dir(run_id)
    if not dest.is_dir():
        return False
    shutil.rmtree(dest)
    return True


def result_from_run(pack: dict) -> dict:
    """Rebuild the API payload from an immutable run."""
    meta = pack.get("meta") or {}
    equity = pack.get("equity") or {}
    stored = meta.get("data_hash")
    warnings = list(meta.get("warnings") or [])
    now = None
    match = None
    symbols = meta.get("symbols") or (pack.get("config") or {}).get("codes") or []
    start = meta.get("start")
    end = meta.get("end")
    if symbols and start and end:
        try:
            from backtest.store import panel_hash

            now = panel_hash(list(symbols), str(start), str(end))
            if now is not None and stored:
                match = now == stored
        except Exception:
            match = None
    if match is False:
        warnings.append(f"本机行情已变, 实验哈希 {stored}, 现在 {now}")
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
    }
