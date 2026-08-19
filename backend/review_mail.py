"""Scheduled Daily Review: snapshot -> existing AI prompt -> SMTP.

Web「问 AI」still uses the browser key. This job needs its own model
config in backend/.env because it runs after the browser is closed.

Opt-in: VR_REVIEW_MAIL=1. A-share trading days, Asia/Shanghai, default 16:10.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr
from pathlib import Path
from typing import Any

import mailer
import review_context
import trading_calendar

BEIJING = timezone(timedelta(hours=8))
log = logging.getLogger("review_mail")

_STATE: dict[str, Any] = {
    "enabled": False,
    "running": False,
    "last_started": None,
    "last_finished": None,
    "last_ok": False,
    "last_error": None,
    "last_sent_date": None,
    "last_to": None,
    "next_at": None,
}
_RUN_LOCK = threading.Lock()


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _env_flag(name: str, default: bool = False) -> bool:
    raw = _env(name).lower()
    if not raw:
        return default
    return raw not in ("0", "false", "no", "off")


def data_dir() -> Path:
    root = Path(_env("VR_DATA_DIR") or (Path.home() / ".vibe-research"))
    d = root / "review-mail"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _prefs_path() -> Path:
    return data_dir() / "prefs.json"


def load_prefs() -> dict[str, Any]:
    p = _prefs_path()
    if not p.is_file():
        return {}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def resolved() -> dict[str, Any]:
    """UI prefs override env. Empty to falls back to VR_REVIEW_MAIL_TO / NOTIFY_EMAIL."""
    p = load_prefs()
    enabled = bool(p["enabled"]) if "enabled" in p else _env_flag("VR_REVIEW_MAIL", False)
    at_raw = str(p.get("at") or "").strip() or _env("VR_REVIEW_MAIL_AT", "16:10")
    hour, minute = parse_hhmm(at_raw)
    to_addr = str(p.get("to") or "").strip() or mailer.mail_to()
    return {
        "enabled": enabled,
        "at": f"{hour:02d}:{minute:02d}",
        "to": to_addr,
    }


def save_prefs(patch: dict[str, Any]) -> dict[str, Any]:
    """Persist enabled / at / to. Does not store SMTP password or API keys."""
    cur = load_prefs()
    if "enabled" in patch and patch["enabled"] is not None:
        cur["enabled"] = bool(patch["enabled"])
    if "at" in patch and patch["at"] is not None:
        hh, mm = parse_hhmm(str(patch["at"]), default=(-1, -1))
        if hh < 0:
            raise ValueError("时间格式应为 HH:MM")
        cur["at"] = f"{hh:02d}:{mm:02d}"
    if "to" in patch and patch["to"] is not None:
        to_addr = str(patch["to"]).strip()
        if to_addr and "@" not in parseaddr(to_addr)[1]:
            raise ValueError("收件邮箱无效")
        cur["to"] = to_addr
    tmp = _prefs_path().with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cur, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(_prefs_path())
    cfg = resolved()
    _STATE["enabled"] = cfg["enabled"]
    _STATE["next_at"] = cfg["at"]
    return cfg


def parse_hhmm(raw: str, default: tuple[int, int] = (16, 10)) -> tuple[int, int]:
    text = (raw or "").strip()
    if not text:
        return default
    try:
        hh_s, mm_s = text.split(":", 1)
        hh, mm = int(hh_s), int(mm_s)
    except (ValueError, TypeError):
        return default
    if not (0 <= hh <= 23 and 0 <= mm <= 59):
        return default
    return hh, mm


def due(now: datetime, last_sent: str | None, hour: int, minute: int) -> bool:
    """True once on an A-share trading day after HH:MM if that day was not sent."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=BEIJING)
    else:
        now = now.astimezone(BEIJING)
    if not trading_calendar.is_cn_trading_day(now):
        return False
    if last_sent == now.date().isoformat():
        return False
    return (now.hour, now.minute) >= (hour, minute)


def llm_cfg() -> dict[str, str] | None:
    provider = _env("VR_REVIEW_LLM_PROVIDER")
    model = _env("VR_REVIEW_LLM_MODEL")
    if provider.startswith("cli-"):
        return {"provider": provider, "baseURL": "", "apiKey": "", "model": model or provider} if model or provider else None
    base = _env("VR_REVIEW_LLM_BASE_URL")
    key = _env("VR_REVIEW_LLM_API_KEY")
    if model and base and key:
        return {"provider": provider or "openai-compatible", "baseURL": base, "apiKey": key, "model": model}
    return None


def llm_ready() -> bool:
    cfg = llm_cfg()
    if not cfg:
        return False
    if str(cfg.get("provider") or "").startswith("cli-"):
        import cli_runtime
        kind = cfg["provider"][4:]
        return bool(cli_runtime.detect_cli(kind))
    return True


def _load_disk_state() -> dict[str, Any]:
    p = data_dir() / "state.json"
    if not p.is_file():
        return {}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_disk_state(patch: dict[str, Any]) -> None:
    cur = _load_disk_state()
    cur.update(patch)
    p = data_dir() / "state.json"
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cur, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)


def _archive(day: str, snap: str, content: str) -> None:
    payload = {
        "date": day,
        "content": content,
        "snap_chars": len(snap),
        "saved_at": datetime.now(BEIJING).isoformat(timespec="seconds"),
    }
    p = data_dir() / f"{day}.json"
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)
    (data_dir() / "latest.md").write_text(content, encoding="utf-8")


def collect_review_data() -> tuple[dict[str, Any], list[str]]:
    """Same bundle as 问 AI. One miss does not abort."""
    import review_snapshot

    return review_snapshot.collect_review_bundle()


def _run_llm(cfg: dict[str, str], prompt: str, snap: str) -> str:
    import chat as chat_layer

    messages = [{"role": "user", "content": prompt}]
    if str(cfg.get("provider") or "").startswith("cli-"):
        out = chat_layer.run_chat_cli(cfg, messages, snap)
    else:
        out = chat_layer.run_chat(cfg, messages, snap)
    text = (out.get("content") or "").strip()
    if not text:
        raise RuntimeError("模型返回空正文")
    return text


def run_once(*, force: bool = False) -> dict[str, Any]:
    """Collect snapshot, ask the configured model, email the result.

    force=True skips the trading-day/once-per-day gate (manual test).
    """
    pref = resolved()
    hour, minute = parse_hhmm(pref["at"])
    to_addr = pref["to"]
    cfg = llm_cfg()
    now = datetime.now(BEIJING)
    day = now.date().isoformat()

    if not cfg:
        return {"ok": False, "error": "未配置 VR_REVIEW_LLM_MODEL / BASE_URL / API_KEY (或 cli provider)"}
    if not llm_ready():
        return {"ok": False, "error": "定时复盘的模型不可用 (检查 CLI 是否已安装登录)"}
    if not mailer.mail_ready():
        return {"ok": False, "error": "未配置 SMTP_USER / SMTP_PASS"}
    if not to_addr:
        return {"ok": False, "error": "未配置收件人 (接入 AI 页或 VR_REVIEW_MAIL_TO / NOTIFY_EMAIL)"}
    if not force and not pref["enabled"]:
        return {"ok": False, "skipped": True, "error": "定时已关闭"}
    if not force and not due(now, _load_disk_state().get("last_sent_date"), hour, minute):
        return {"ok": False, "skipped": True, "error": "未到发送时间, 或今天已经发过"}

    if not _RUN_LOCK.acquire(blocking=False):
        return {"ok": False, "error": "复盘邮件正在发送"}
    try:
        _STATE["running"] = True
        _STATE["last_started"] = now.isoformat(timespec="seconds")
        _STATE["last_error"] = None
        data, collect_errors = collect_review_data()
        snap = review_context.pack_review_context(data)
        review_context.save_archive(snap)
        prompt = review_context.build_user_prompt(snap)
        content = _run_llm(cfg, prompt, snap)
        subject = f"Vibe-Research 复盘 {day}"
        mailer.send_mail(to_addr, subject, content)
        _archive(day, snap, content)
        _save_disk_state({
            "last_sent_date": day,
            "last_to": to_addr,
            "last_ok": True,
            "last_error": None,
            "collect_errors": collect_errors[-8:],
        })
        _STATE["last_ok"] = True
        _STATE["last_sent_date"] = day
        _STATE["last_to"] = to_addr
        _STATE["last_finished"] = datetime.now(BEIJING).isoformat(timespec="seconds")
        log.info("review mail sent to %s (%s chars)", to_addr, len(content))
        return {
            "ok": True,
            "date": day,
            "to": to_addr,
            "chars": len(content),
            "collect_errors": collect_errors,
        }
    except Exception as e:
        err = str(e)[:240]
        _STATE["last_ok"] = False
        _STATE["last_error"] = err
        _STATE["last_finished"] = datetime.now(BEIJING).isoformat(timespec="seconds")
        _save_disk_state({"last_ok": False, "last_error": err})
        log.exception("review mail failed")
        return {"ok": False, "error": err}
    finally:
        _STATE["running"] = False
        _RUN_LOCK.release()


def status() -> dict[str, Any]:
    pref = resolved()
    disk = _load_disk_state()
    cfg = llm_cfg()
    return {
        **_STATE,
        "enabled": pref["enabled"],
        "at": pref["at"],
        "to": pref["to"] or None,
        "smtp_ready": mailer.mail_ready(),
        "llm_ready": llm_ready(),
        "llm_model": (cfg or {}).get("model") if cfg else None,
        "llm_provider": (cfg or {}).get("provider") if cfg else None,
        "last_sent_date": _STATE.get("last_sent_date") or disk.get("last_sent_date"),
        "last_error": _STATE.get("last_error") or disk.get("last_error"),
        "weekday": datetime.now(BEIJING).weekday() < 5,
        "trading_day": trading_calendar.is_cn_trading_day(),
        "calendar": trading_calendar.status(),
    }


_FAIL_COOLDOWN_SEC = 900


def _cooldown_ok(now: datetime) -> bool:
    """After a failed send, wait 15 min before the scheduler retries (saves LLM tokens)."""
    finished = _STATE.get("last_finished")
    if _STATE.get("last_ok") or not finished:
        return True
    try:
        last_f = datetime.fromisoformat(str(finished))
    except ValueError:
        return True
    if last_f.tzinfo is None:
        last_f = last_f.replace(tzinfo=BEIJING)
    return (now - last_f).total_seconds() >= _FAIL_COOLDOWN_SEC


def start_scheduler(poll_sec: float = 30.0) -> None:
    """Daemon always runs so the UI can toggle without restarting the backend."""
    pref = resolved()
    _STATE["enabled"] = pref["enabled"]
    _STATE["next_at"] = pref["at"]

    def loop() -> None:
        time.sleep(2.0)
        while True:
            try:
                now = datetime.now(BEIJING)
                cfg = resolved()
                _STATE["enabled"] = cfg["enabled"]
                _STATE["next_at"] = cfg["at"]
                hour, minute = parse_hhmm(cfg["at"])
                last = _load_disk_state().get("last_sent_date")
                if cfg["enabled"] and due(now, last, hour, minute) and _cooldown_ok(now):
                    run_once(force=False)
            except Exception:
                log.exception("review mail scheduler tick failed")
            time.sleep(max(10.0, poll_sec))

    threading.Thread(target=loop, name="review-mail", daemon=True).start()
    log.info("review mail scheduler started (toggle in Settings; default %s)", pref["at"])
