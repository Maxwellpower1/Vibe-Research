"""SMTP mailer. Same env names as deploy/README.md (QQ SMTP defaults).

Secrets stay in backend/.env. This module never logs passwords.
"""
from __future__ import annotations

import html
import os
import re
import smtplib
import ssl
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, parseaddr

_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$")
_HEADING = re.compile(r"^(#{1,3})\s+(.+)$")
_UL = re.compile(r"^[-*+]\s+(.+)$")
_OL = re.compile(r"^\d+[.)]\s+(.+)$")
_BOLD = re.compile(r"\*\*(.+?)\*\*|__(.+?)__")
_CODE = re.compile(r"`([^`]+)`")
_CELL = (
    "border:1px solid #d0d7de;padding:6px 10px;text-align:left;"
    "vertical-align:top;font-size:13px;"
)


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def smtp_config() -> dict[str, str | int]:
    user = _env("SMTP_USER")
    return {
        "host": _env("SMTP_HOST", "smtp.qq.com"),
        "port": int(_env("SMTP_PORT", "465") or "465"),
        "user": user,
        "password": _env("SMTP_PASS"),
        "from_addr": _env("SMTP_FROM") or user,
        "from_name": _env("SMTP_FROM_NAME", "Vibe-Research"),
    }


def mail_ready() -> bool:
    cfg = smtp_config()
    return bool(cfg["user"] and cfg["password"] and cfg["from_addr"])


def mail_to() -> str:
    return _env("VR_REVIEW_MAIL_TO") or _env("NOTIFY_EMAIL")


def _format_from(cfg: dict[str, str | int]) -> str:
    name = str(cfg["from_name"] or "Vibe-Research")
    addr = str(cfg["from_addr"])
    return formataddr((str(Header(name, "utf-8")), addr))


def _inline(text: str) -> str:
    escaped = html.escape(text or "", quote=False)

    def _code(m: re.Match[str]) -> str:
        return (
            "<code style=\"font-size:12px;background:#f6f8fa;padding:1px 4px;"
            f"border-radius:3px;\">{m.group(1)}</code>"
        )

    def _bold(m: re.Match[str]) -> str:
        return f"<b>{m.group(1) or m.group(2)}</b>"

    escaped = _CODE.sub(_code, escaped)
    return _BOLD.sub(_bold, escaped)


def _split_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def _is_table_row(line: str) -> bool:
    s = line.strip()
    return s.startswith("|") and s.count("|") >= 2


def _table_html(header: list[str], rows: list[list[str]]) -> str:
    n = max(len(header), 1)
    th = "".join(
        f'<th style="{_CELL}background:#f6f8fa;font-weight:600;">{_inline(c)}</th>'
        for c in header
    )
    body: list[str] = []
    for i, row in enumerate(rows):
        cells = (row + [""] * n)[:n]
        bg = "background:#fafafa;" if i % 2 else ""
        tds = "".join(f'<td style="{_CELL}{bg}">{_inline(c)}</td>' for c in cells)
        body.append(f"<tr>{tds}</tr>")
    return (
        '<table role="presentation" style="border-collapse:collapse;width:100%;'
        'margin:12px 0;font-size:13px;">'
        f"<thead><tr>{th}</tr></thead><tbody>{''.join(body)}</tbody></table>"
    )


def _consume_table(lines: list[str], i: int) -> tuple[str, int]:
    header = _split_row(lines[i])
    i += 1
    if i < len(lines) and _TABLE_SEP.match(lines[i] or ""):
        i += 1
    rows: list[list[str]] = []
    while i < len(lines) and _is_table_row(lines[i]):
        if _TABLE_SEP.match(lines[i]):
            i += 1
            continue
        rows.append(_split_row(lines[i]))
        i += 1
    return _table_html(header, rows), i


def md_to_html(body: str) -> str:
    """Small markdown subset for email: tables, headings, lists, bold, code.

    No extra dependency. Unknown markup stays escaped text.
    """
    lines = (body or "").replace("\r\n", "\n").split("\n")
    out: list[str] = []
    i = 0
    para: list[str] = []
    list_kind = ""
    list_items: list[str] = []

    def flush_para() -> None:
        if not para:
            return
        out.append("<p style=\"margin:0 0 10px;\">" + "<br>".join(_inline(p) for p in para) + "</p>")
        para.clear()

    def flush_list() -> None:
        nonlocal list_kind
        if not list_items:
            list_kind = ""
            return
        tag = "ol" if list_kind == "ol" else "ul"
        items = "".join(f'<li style="margin:2px 0;">{x}</li>' for x in list_items)
        out.append(f'<{tag} style="margin:0 0 10px;padding-left:1.4em;">{items}</{tag}>')
        list_items.clear()
        list_kind = ""

    while i < len(lines):
        raw = lines[i]
        s = raw.strip()
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""

        if s.startswith("```"):
            flush_para()
            flush_list()
            i += 1
            chunk: list[str] = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                chunk.append(html.escape(lines[i], quote=False))
                i += 1
            if i < len(lines):
                i += 1
            out.append(
                "<pre style=\"white-space:pre-wrap;word-break:break-word;"
                "background:#f6f8fa;padding:10px;border-radius:6px;"
                f"font-size:12px;margin:0 0 10px;\">{chr(10).join(chunk)}</pre>"
            )
            continue

        if _is_table_row(s) and ( _TABLE_SEP.match(nxt) or _is_table_row(nxt) ):
            flush_para()
            flush_list()
            block, i = _consume_table(lines, i)
            out.append(block)
            continue

        if not s:
            flush_para()
            flush_list()
            i += 1
            continue

        hm = _HEADING.match(s)
        if hm:
            flush_para()
            flush_list()
            level = min(len(hm.group(1)), 3)
            size = {1: "20px", 2: "17px", 3: "15px"}[level]
            out.append(
                f'<h{level} style="font-size:{size};margin:16px 0 8px;'
                f'border-bottom:1px solid #eee;padding-bottom:4px;">'
                f"{_inline(hm.group(2))}</h{level}>"
            )
            i += 1
            continue

        um = _UL.match(s)
        om = _OL.match(s)
        if um or om:
            flush_para()
            kind = "ul" if um else "ol"
            if list_kind and list_kind != kind:
                flush_list()
            list_kind = kind
            list_items.append(_inline((um or om).group(1)))
            i += 1
            continue

        flush_list()
        para.append(s)
        i += 1

    flush_para()
    flush_list()
    return "".join(out) or "<p></p>"


def text_to_html(body: str) -> str:
    """HTML alternative for clients that skip text/plain. Renders markdown tables."""
    inner = md_to_html(body)
    return (
        "<!DOCTYPE html><html><body style=\"font-family:ui-sans-serif,system-ui,"
        "sans-serif;line-height:1.55;color:#111;max-width:720px;margin:0 auto;"
        "padding:16px;\">"
        f"{inner}"
        "<p style=\"margin-top:24px;font-size:12px;color:#666;\">"
        "Vibe-Research 复盘邮件. 只做客观陈述, 不构成投资建议.</p>"
        "</body></html>"
    )


def send_mail(to_addr: str, subject: str, body: str) -> None:
    """Send one UTF-8 email. Raises on config/SMTP errors."""
    to_addr = (to_addr or "").strip()
    if not to_addr or "@" not in parseaddr(to_addr)[1]:
        raise RuntimeError("收件邮箱无效")
    if not mail_ready():
        raise RuntimeError("未配置 SMTP_USER / SMTP_PASS")

    cfg = smtp_config()
    msg = MIMEMultipart("alternative")
    msg["From"] = _format_from(cfg)
    msg["To"] = to_addr
    msg["Subject"] = Header(subject, "utf-8")
    msg.attach(MIMEText(body, "plain", "utf-8"))
    msg.attach(MIMEText(text_to_html(body), "html", "utf-8"))

    host = str(cfg["host"])
    port = int(cfg["port"])
    user = str(cfg["user"])
    password = str(cfg["password"])
    ctx = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
        return
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ctx)
        smtp.login(user, password)
        smtp.send_message(msg)
