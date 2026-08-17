"""Index member history: CSI adjustment notices -> daily snapshots.

Writes the existing members/ hive. Not a second catalog.
Regular reviews are PDFs; ad-hoc mergers are xlsx. Form import still
writes today's list; pass history=1 or POST /store/members to fill PIT.
"""

from __future__ import annotations

import io
import logging
import re
from datetime import date, timedelta
from typing import Callable

import astock
from backtest.market import last_closed_iso, members_asof, members_covers, write_members
from backtest.panel import norm_date

log = logging.getLogger(__name__)

_CSI_SEARCH = "https://www.csindex.com.cn/csindex-home/search/search-content"
_CSI_ANN = "https://www.csindex.com.cn/csindex-home/announcement/queryAnnouncementById"
_QUERIES = ("关于沪深300、中证500", "关于调整沪深300等指数样本")
_SKIP = ("精明", "方案", "规则", "样本空间", "选取方法")
_HEAD = re.compile(
    r"(沪深\s*300|中证\s*500|中证\s*1000|科创\s*50)\s*指数样本调整名单"
)
_DATE = re.compile(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")
_CODE = re.compile(r"\b(\d{6})\b")
_LABEL = {
    "000300": ("沪深300", "沪深 300"),
    "000905": ("中证500", "中证 500"),
    "000688": ("科创50", "科创 50"),
}


def _digits(raw: object) -> str:
    if raw is None:
        return ""
    try:
        if isinstance(raw, float) and raw != raw:
            return ""
    except Exception:
        return ""
    text = str(raw).strip()
    if text in ("", "-", "None", "nan"):
        return ""
    if text.endswith(".0") and text[:-2].isdigit():
        text = text[:-2]
    nums = "".join(c for c in text if c.isdigit())
    return nums.zfill(6) if len(nums) >= 6 else (nums.zfill(6) if nums.isdigit() and nums else "")


def _resolve(raw: str) -> str:
    return astock.resolve_symbol(raw) or ""


def _resolve_all(raw: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        sym = _resolve(str(item))
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def _keep_title(title: str) -> bool:
    text = (title or "").replace("<b>", "").replace("</b>", "")
    if any(tok in text for tok in _SKIP):
        return False
    return "调整" in text and any(tok in text for tok in ("沪深300", "中证500", "科创50"))


def _effective_date(html: str, publish: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    found = _DATE.findall(text)
    if not found:
        return norm_date(publish)
    year, month, day = (int(x) for x in found[0])
    try:
        when = date(year, month, day)
    except ValueError:
        return norm_date(publish)
    if "收市后" in text or "市后" in text:
        when = when + timedelta(days=1)
    return when.isoformat()


def parse_adjust_pdf(text: str, csi_code: str) -> tuple[list[str], list[str]]:
    """Side-by-side 调出/调入 blocks in a CSI regular-review PDF."""
    labels = _LABEL.get(csi_code) or (csi_code,)
    starts = list(_HEAD.finditer(text or ""))
    block = ""
    for i, hit in enumerate(starts):
        name = re.sub(r"\s+", "", hit.group(1))
        if not any(re.sub(r"\s+", "", lab) == name for lab in labels):
            continue
        end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
        block = text[hit.end() : end]
        break
    if not block:
        return [], []
    added: list[str] = []
    removed: list[str] = []
    for line in block.splitlines():
        codes = _CODE.findall(line)
        if len(codes) >= 2:
            removed.append(codes[0])
            added.append(codes[1])
    return added, removed


def parse_adjust_xlsx(raw: bytes, csi_code: str) -> tuple[list[str], list[str]]:
    import pandas as pd

    xl = pd.ExcelFile(io.BytesIO(raw))
    added: list[str] = []
    removed: list[str] = []
    want = csi_code.zfill(6)
    for sheet in xl.sheet_names:
        df = xl.parse(sheet, header=None)
        if df.empty:
            continue
        for row in df.itertuples(index=False):
            cells = [_digits(v) for v in row]
            if want not in cells:
                continue
            idx = cells.index(want)
            rest = [_digits(v) for v in row[idx + 1 :]]
            codes = [c for c in rest if c and c != want]
            if not codes:
                continue
            removed.append(codes[0])
            if len(codes) >= 2:
                added.append(codes[1])
    return added, removed


def merge_changes(rows: list[dict]) -> list[dict]:
    by_day: dict[str, dict[str, set[str]]] = {}
    for row in rows:
        day = norm_date(row.get("date"))
        if not day:
            continue
        slot = by_day.setdefault(day, {"added": set(), "removed": set()})
        slot["added"].update(_resolve_all([str(x) for x in (row.get("added") or [])]))
        slot["removed"].update(_resolve_all([str(x) for x in (row.get("removed") or [])]))
    return [
        {"date": day, "added": sorted(v["added"]), "removed": sorted(v["removed"])}
        for day, v in sorted(by_day.items())
        if v["added"] or v["removed"]
    ]


def rebuild_snapshots(
    current: list[str],
    asof: str,
    changes: list[dict],
    *,
    since: str | None = None,
) -> dict[str, list[str]]:
    """Walk current members backward through change dates.

    `date` on a change is the first day of the new set.
    """
    day0 = norm_date(asof)
    pool = set(_resolve_all(current))
    snaps: dict[str, list[str]] = {day0: sorted(pool)}
    ordered = [c for c in merge_changes(changes) if c["date"] <= day0]
    ordered.sort(key=lambda c: c["date"], reverse=True)
    for ch in ordered:
        snaps[ch["date"]] = sorted(pool)
        pool = (pool - set(ch["added"])) | set(ch["removed"])
    if ordered:
        first = min(c["date"] for c in ordered)
        before = (date.fromisoformat(first) - timedelta(days=1)).isoformat()
        carry = since if since and since < first else before
        snaps[norm_date(carry) or before] = sorted(pool)
    return snaps


def _search(query: str) -> list[dict]:
    try:
        d = astock.em_get(
            _CSI_SEARCH,
            params={
                "lang": "cn",
                "searchInput": query,
                "pageNum": "1",
                "pageSize": "20",
                "sortField": "date",
                "dateRange": "all",
                "contentType": "announcement",
            },
            timeout=18,
        ).json()
    except Exception as e:  # noqa: BLE001
        log.info("csi search %s failed: %s", query, e)
        return []
    rows = (d or {}).get("data") or []
    return [r for r in rows if isinstance(r, dict)]


def _announcement(aid: int) -> dict:
    try:
        d = astock.em_get(f"{_CSI_ANN}?id={aid}", timeout=18).json()
    except Exception as e:  # noqa: BLE001
        log.info("csi announcement %s failed: %s", aid, e)
        return {}
    data = (d or {}).get("data") or {}
    return data if isinstance(data, dict) else {}


def _pdf_text(raw: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    try:
        reader = PdfReader(io.BytesIO(raw))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as e:  # noqa: BLE001
        log.info("csi pdf parse failed: %s", e)
        return ""


def _download(url: str) -> bytes:
    r = astock.em_get(url, timeout=20)
    return r.content or b""


def fetch_csi_changes(csi_code: str, since: str) -> list[dict]:
    """Public CSI notices. Injectable in tests via persist()."""
    cutoff = (date.fromisoformat(since) - timedelta(days=120)).isoformat() if since else ""
    seen: set[int] = set()
    notices: list[dict] = []
    for query in _QUERIES:
        for row in _search(query):
            try:
                aid = int(row.get("id"))
            except (TypeError, ValueError):
                continue
            if aid in seen:
                continue
            title = str(row.get("headline") or row.get("title") or "")
            if not _keep_title(title):
                continue
            pub = norm_date(row.get("itemDate") or row.get("publishDate"))
            if cutoff and pub and pub < cutoff:
                continue
            seen.add(aid)
            notices.append({"id": aid, "title": title, "publish": pub})

    out: list[dict] = []
    for item in notices:
        data = _announcement(item["id"])
        if not data:
            continue
        day = _effective_date(str(data.get("content") or ""), item["publish"] or "")
        added: list[str] = []
        removed: list[str] = []
        for enc in data.get("enclosureList") or []:
            if not isinstance(enc, dict):
                continue
            url = str(enc.get("fileUrl") or "")
            name = str(enc.get("fileName") or url).lower()
            if not url:
                continue
            try:
                blob = _download(url)
            except Exception as e:  # noqa: BLE001
                log.info("csi file %s failed: %s", url, e)
                continue
            if name.endswith(".pdf") or url.lower().endswith(".pdf"):
                a, b = parse_adjust_pdf(_pdf_text(blob), csi_code)
            elif name.endswith(".xlsx") or name.endswith(".xls") or "xls" in name:
                try:
                    a, b = parse_adjust_xlsx(blob, csi_code)
                except Exception as e:  # noqa: BLE001
                    log.info("csi xlsx %s failed: %s", url, e)
                    a, b = [], []
            else:
                a, b = [], []
            added.extend(a)
            removed.extend(b)
        if added or removed:
            out.append({"date": day, "added": added, "removed": removed})
    return merge_changes(out)


def persist_member_history(
    index_id: str,
    current: list[str],
    asof: str,
    changes: list[dict],
    *,
    since: str | None = None,
) -> dict:
    """Write today's list plus reconstructed change-date snapshots."""
    day = norm_date(asof) or last_closed_iso()
    now = _resolve_all(current)
    write_members(index_id, day, now)
    snaps = rebuild_snapshots(now, day, changes, since=since)
    for snap_day, syms in snaps.items():
        write_members(index_id, snap_day, syms)
    first = min(snaps) if snaps else day
    last = max(snaps) if snaps else day
    return {
        "id": index_id,
        "asof": day,
        "n": len(now),
        "snapshots": len(snaps),
        "from": first,
        "to": last,
        "stored": True,
    }


def ensure_member_history(
    index_id: str,
    *,
    since: str | None = None,
    refresh: bool = False,
    current_fn: Callable[[str], list[str]] | None = None,
    changes_fn: Callable[[], list[dict]] | None = None,
    csi_code: str = "",
) -> dict:
    """Fill members/ for one index. Skip CSI when a snapshot already covers since."""
    from backtest.index_pool import fetch_members
    from backtest.service import BacktestError

    asof = last_closed_iso()
    start = since or (date.fromisoformat(asof) - timedelta(days=800)).isoformat()
    if not refresh and members_covers(index_id, start):
        day, syms = members_asof(index_id, asof)
        return {
            "id": index_id,
            "asof": day,
            "n": len(syms),
            "snapshots": 0,
            "source": "cache",
            "stored": True,
            "note": f"已有 {day} 及更早的按日快照",
        }
    getter = current_fn or fetch_members
    try:
        current = getter(index_id) or []
    except Exception as e:  # noqa: BLE001
        raise BacktestError(f"{index_id} 最新成分没取到: {e}") from e
    current = _resolve_all([str(x) for x in current])
    if not current:
        raise BacktestError(f"{index_id} 最新成分没取到")
    if changes_fn is not None:
        changes = changes_fn() or []
    elif csi_code:
        changes = fetch_csi_changes(csi_code, start)
    else:
        changes = []
    out = persist_member_history(index_id, current, asof, changes, since=start)
    out["source"] = "live"
    out["changes"] = len(changes)
    if len(changes) < 1:
        out["note"] = "只写下了今天的名单, 没有取到调整公告, 这段不能当按日 PIT"
    else:
        out["note"] = f"按变动日写入 {out['snapshots']} 张快照"
    return out
