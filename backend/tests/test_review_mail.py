"""review_mail + mailer + review_context (no network)."""
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr

import mailer
import review_context as rc
import review_mail as rm

BEIJING = timezone(timedelta(hours=8))


def test_parse_hhmm_default():
    assert rm.parse_hhmm("") == (16, 10)
    assert rm.parse_hhmm("bad") == (16, 10)
    assert rm.parse_hhmm("25:00") == (16, 10)
    assert rm.parse_hhmm("16:10") == (16, 10)
    assert rm.parse_hhmm("9:05") == (9, 5)


def test_due_weekday_after_time():
    t = datetime(2026, 8, 17, 16, 10, tzinfo=BEIJING)  # Monday
    assert rm.due(t, None, 16, 10) is True
    assert rm.due(t, "2026-08-17", 16, 10) is False
    assert rm.due(t.replace(hour=16, minute=9), None, 16, 10) is False


def test_due_weekend_false():
    sat = datetime(2026, 8, 15, 17, 0, tzinfo=BEIJING)
    assert rm.due(sat, None, 16, 10) is False


def test_fmt_yi_and_signed_pct():
    assert rc.fmt_yi(2.5e8) == "2.50亿"
    assert rc.fmt_yi(-3.2e4) == "-3万"
    assert rc.fmt_yi(0) == "—"
    assert rc.fmt_signed_pct(1.2) == "+1.20%"
    assert rc.fmt_signed_pct(-0.5) == "-0.50%"
    assert rc.fmt_signed_pct(None) == "—"


def test_pack_includes_watch():
    text = rc.pack_review_context({
        "watch": [{"name": "贵州茅台", "price": 1400, "pct": 1.2}],
    })
    assert "【自选】" in text
    assert "贵州茅台" in text
    assert "自选" not in rc.missing_panels(text)


def test_pack_lists_missing_and_keeps_sections():
    text = rc.pack_review_context({
        "world": [{"name": "上证指数", "price": 3200, "change_pct": 0.85}],
        "emotion": {"zt_count": 40, "dt_count": 2, "zb_count": 8, "yzt_count": 30,
                    "max_boards": 5, "lianban_count": 12},
    })
    assert "【全球指数】" in text
    assert "上证指数" in text
    assert "+0.85%" in text
    assert "【涨跌停】" in text
    assert "【未取到】" in text
    assert "板块热点" in text
    assert rc.missing_panels(text)


def test_build_user_prompt_reuses_web_task():
    prompt = rc.build_user_prompt("SNAP")
    assert "SNAP" in prompt
    assert "不推荐任何标的" in prompt
    assert prompt.startswith("以下是今天复盘驾驶舱的客观快照")


def test_mailer_html_escapes():
    html = mailer.text_to_html("<script>x</script>")
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_mailer_renders_markdown_table():
    md = (
        "## 指数\n"
        "\n"
        "| 名称 | 涨跌 |\n"
        "| --- | --- |\n"
        "| 上证指数 | +0.85% |\n"
        "| 深证成指 | **-1.20%** |\n"
    )
    html = mailer.text_to_html(md)
    assert "<table" in html
    assert "<th" in html
    assert "上证指数" in html
    assert "+0.85%" in html
    assert "<b>-1.20%</b>" in html
    assert "<h2" in html
    assert "|" not in html.split("<tbody>", 1)[1].split("</tbody>", 1)[0]


def test_status_hides_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SMTP_USER", "you@qq.com")
    monkeypatch.setenv("SMTP_PASS", "secret-auth-code")
    monkeypatch.setenv("VR_REVIEW_LLM_API_KEY", "sk-secret")
    monkeypatch.setenv("VR_REVIEW_LLM_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("VR_REVIEW_LLM_MODEL", "deepseek-chat")
    monkeypatch.setenv("NOTIFY_EMAIL", "you@qq.com")
    st = rm.status()
    blob = str(st)
    assert "secret-auth-code" not in blob
    assert "sk-secret" not in blob
    assert st["smtp_ready"] is True
    assert st["llm_ready"] is True
    assert st["to"] == "you@qq.com"
    assert st["llm_model"] == "deepseek-chat"


def test_run_once_missing_config(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("VR_REVIEW_LLM_MODEL", raising=False)
    monkeypatch.delenv("VR_REVIEW_LLM_API_KEY", raising=False)
    monkeypatch.delenv("VR_REVIEW_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("VR_REVIEW_LLM_PROVIDER", raising=False)
    out = rm.run_once(force=True)
    assert out["ok"] is False
    assert "VR_REVIEW_LLM" in out["error"]


def test_prefs_override_env(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("VR_REVIEW_MAIL", "0")
    monkeypatch.setenv("VR_REVIEW_MAIL_AT", "16:10")
    monkeypatch.setenv("NOTIFY_EMAIL", "env@qq.com")
    assert rm.resolved()["enabled"] is False
    assert rm.resolved()["to"] == "env@qq.com"
    rm.save_prefs({"enabled": True, "at": "17:30", "to": "ui@qq.com"})
    cfg = rm.resolved()
    assert cfg["enabled"] is True
    assert cfg["at"] == "17:30"
    assert cfg["to"] == "ui@qq.com"
    rm.save_prefs({"to": ""})
    assert rm.resolved()["to"] == "env@qq.com"


def test_save_prefs_rejects_bad_time(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    try:
        rm.save_prefs({"at": "25:00"})
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "HH:MM" in str(e)


def test_run_once_missing_smtp(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("VR_REVIEW_LLM_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("VR_REVIEW_LLM_API_KEY", "sk-x")
    monkeypatch.setenv("VR_REVIEW_LLM_MODEL", "deepseek-chat")
    monkeypatch.setenv("NOTIFY_EMAIL", "you@qq.com")
    monkeypatch.delenv("SMTP_USER", raising=False)
    monkeypatch.delenv("SMTP_PASS", raising=False)
    out = rm.run_once(force=True)
    assert out["ok"] is False
    assert "SMTP" in out["error"]


def test_from_header_keeps_addr():
    name, addr = parseaddr("Vibe-Research <a@b.com>")
    assert addr == "a@b.com"


def test_cooldown_after_fail():
    prev = dict(rm._STATE)
    try:
        rm._STATE["last_ok"] = False
        rm._STATE["last_finished"] = datetime(2026, 8, 17, 16, 11, tzinfo=BEIJING).isoformat(timespec="seconds")
        now = datetime(2026, 8, 17, 16, 12, tzinfo=BEIJING)
        assert rm._cooldown_ok(now) is False
        later = datetime(2026, 8, 17, 16, 27, tzinfo=BEIJING)
        assert rm._cooldown_ok(later) is True
        rm._STATE["last_ok"] = True
        assert rm._cooldown_ok(now) is True
    finally:
        rm._STATE.clear()
        rm._STATE.update(prev)
