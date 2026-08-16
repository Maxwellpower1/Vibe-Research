"""Daily Review BFF: paint / top / full payloads share the same TTL keys.

scope=paint is Tencent + overview only (no Eastmoney). top adds emotion +
industry strength. full then fills dragon-tiger.
Eastmoney calls run in parallel (no em_get launch gap).
"""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import review_jobs
import review_warmup

_errors_lock = threading.Lock()

BEIJING = timezone(timedelta(hours=8))


def _grab(name: str, fn: Callable[[], Any], bucket: dict[str, Any], errors: list[dict]) -> None:
    try:
        bucket[name] = fn()
    except Exception as e:
        bucket[name] = None
        with _errors_lock:
            errors.append({"name": name, "error": str(e)[:160]})


def _run_parallel(
    jobs: list[tuple[str, Callable[[], Any]]],
    bucket: dict[str, Any],
    errors: list[dict],
    workers: int = 5,
) -> None:
    if not jobs:
        return
    with ThreadPoolExecutor(max_workers=min(workers, len(jobs))) as pool:
        futs = [pool.submit(_grab, name, fn, bucket, errors) for name, fn in jobs]
        for fut in futs:
            fut.result()


def _fill_from_jobs(jobs: list, bucket: dict[str, Any], errors: list[dict]) -> None:
    _run_parallel(jobs, bucket, errors)


def _fill_tencent(bucket: dict[str, Any], errors: list[dict]) -> None:
    _fill_from_jobs(review_jobs.tencent_jobs(), bucket, errors)


def _fill_overview(bucket: dict[str, Any], errors: list[dict]) -> None:
    _fill_from_jobs(review_jobs.overview_jobs(), bucket, errors)


def _fill_em_top(bucket: dict[str, Any], errors: list[dict]) -> None:
    """Eastmoney-backed top rows used by the emotion panel."""
    _fill_from_jobs(review_jobs.em_top_jobs(), bucket, errors)


def _fill_em_extra(bucket: dict[str, Any], errors: list[dict]) -> None:
    _fill_from_jobs(review_jobs.em_extra_jobs(), bucket, errors)


def build_review_snapshot(*, scope: str = "full") -> dict[str, Any]:
    """Assemble Daily Review payload. paint < top < full."""
    scope = (scope or "full").strip().lower()
    if scope not in ("paint", "top", "full"):
        scope = "full"

    top: dict[str, Any] = {}
    extra: dict[str, Any] = {"lhb": None}
    errors: list[dict] = []

    with review_warmup.user_fetch():
        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = [
                pool.submit(_fill_tencent, top, errors),
                pool.submit(_fill_overview, top, errors),
            ]
            if scope != "paint":
                futs.append(pool.submit(_fill_em_top, top, errors))
            for fut in futs:
                fut.result()
        if scope == "full":
            _fill_em_extra(extra, errors)

    return {
        "scope": scope,
        "indices": top.get("indices"),
        "overview": top.get("overview"),
        "emotion": top.get("emotion"),
        "industry": top.get("industry"),
        "lhb": extra.get("lhb"),
        "hsgt": top.get("hsgt"),
        "errors": errors,
        "updated": datetime.now(BEIJING).strftime("%Y-%m-%d %H:%M:%S"),
    }


def collect_review_bundle(
    *,
    sector_kind: str = "01",
    news_source: str = "cls",
    watch_codes: list[str] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Full 复盘快照 plus live panels. Mail and 问 AI share this."""
    snap = build_review_snapshot(scope="full")
    bucket: dict[str, Any] = {}
    errors: list[str] = []
    if isinstance(snap, dict):
        for key in ("indices", "overview", "emotion", "industry", "lhb", "hsgt"):
            bucket[key] = snap.get(key)
        for err in snap.get("errors") or []:
            if isinstance(err, dict):
                errors.append(f"{err.get('name')}: {err.get('error')}"[:160])
            else:
                errors.append(str(err)[:160])

    review_jobs.run_jobs(
        review_jobs.live_jobs(sector_kind=sector_kind, news_source=news_source),
        bucket,
        errors,
    )
    money = bucket.pop("money", None)
    if isinstance(money, dict):
        bucket["money_rows"] = money.get("rows")
    elif isinstance(money, list):
        bucket["money_rows"] = money
    bucket["watch"] = review_jobs.watch_quotes(watch_codes)
    return bucket, errors
