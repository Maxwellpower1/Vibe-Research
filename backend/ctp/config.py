"""CTP credential loading and status."""
from __future__ import annotations

import json
import os
from typing import Any

from ctp.constants import CACHE_DIR, CTP_CFG_FILE, CTP_FLOW_DIR
from ctp.state import _is_logged_in_unlocked, _lock, _logging_in, _session

def load_config() -> dict[str, str] | None:
    env_keys = {
        "host": os.environ.get("CTP_HOST", "").strip(),
        "broker": os.environ.get("CTP_BROKER", "").strip(),
        "user": os.environ.get("CTP_USER", "").strip(),
        "password": os.environ.get("CTP_PASSWORD", "").strip(),
        "appid": os.environ.get("CTP_APPID", "").strip(),
        "authcode": os.environ.get("CTP_AUTHCODE", "").strip(),
    }
    if all(env_keys.values()):
        return env_keys

    try:
        with open(CTP_CFG_FILE, encoding="utf-8-sig") as f:
            raw = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        raw = {}

    cfg = {
        "host": (env_keys["host"] or str(raw.get("host", ""))).strip(),
        "broker": (env_keys["broker"] or str(raw.get("broker", ""))).strip(),
        "user": (env_keys["user"] or str(raw.get("user", ""))).strip(),
        "password": (env_keys["password"] or str(raw.get("password", ""))).strip(),
        "appid": (env_keys["appid"] or str(raw.get("appid", ""))).strip(),
        "authcode": (env_keys["authcode"] or str(raw.get("authcode", ""))).strip(),
    }
    if not all(cfg.values()):
        return None
    return cfg


def _mask_user(user: str) -> str:
    return user[:2] + "***" + user[-2:] if len(user) > 4 else "***"


def config_status() -> dict[str, Any]:
    cfg = load_config()
    try:
        import openctp_ctp  # noqa: F401

        dep_ok = True
        dep_msg = ""
    except ImportError:
        dep_ok = False
        dep_msg = "未安装 openctp-ctp, 请执行: pip install openctp-ctp"

    with _lock:
        logged_in = _is_logged_in_unlocked()
        logging_in = _logging_in
        trading_day = getattr(_session, "trading_day", "") if _session else ""
        user_masked = _mask_user(cfg["user"]) if cfg else ""

    return {
        "configured": cfg is not None,
        "dependency_ok": dep_ok,
        "dependency_msg": dep_msg,
        "config_path": CTP_CFG_FILE,
        "user_masked": user_masked,
        "ready": cfg is not None and dep_ok,
        "logged_in": logged_in,
        "logging_in": logging_in,
        "trading_day": trading_day,
        "host": (cfg or {}).get("host", ""),
    }

