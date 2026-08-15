"""Persist AI-watch snapshots under ~/.vibe-research/ai-watch/."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.environ.get("VR_DATA_DIR") or Path.home() / ".vibe-research") / "ai-watch"


def _path(name: str) -> Path:
    return DATA_DIR / name


def read_json(name: str, default: Any = None) -> Any:
    p = _path(name)
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return default


def write_json(name: str, data: Any) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    p = _path(name)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)
