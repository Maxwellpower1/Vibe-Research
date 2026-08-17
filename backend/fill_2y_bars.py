"""CLI: fill last 2y closed daily bars into VR_DATA_DIR/market/.

Same path as the data-page button. Already-covered symbols are skipped.
Does not compute TickFlow enriched. Does not wipe the store.

Usage (from repo root or backend/):
  python backend/fill_2y_bars.py
  python backend/fill_2y_bars.py --index sh000905
  python backend/fill_2y_bars.py 600519 000858
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backtest.index_pool import POOLS, load_index_pool
from backtest.universe_sync import portrait, run_sync, window


def _parse(argv: list[str] | None = None) -> argparse.Namespace:
    ids = ", ".join(p["id"] for p in POOLS)
    p = argparse.ArgumentParser(description="Fill last 2y closed daily bars (skip if covered).")
    p.add_argument("codes", nargs="*", help="6-digit codes. Empty = full A-share universe file.")
    p.add_argument("--index", default="", help=f"Index snapshot instead of universe. {ids}")
    p.add_argument("--workers", type=int, default=2, help="Fetch threads. Default 2 (Tencent rate).")
    p.add_argument(
        "--include-bj",
        action="store_true",
        help="Also fetch 920/8 Beijing names. Tencent usually has no 2y history.",
    )
    return p.parse_args(argv)


def _drop_bj(codes: list[str]) -> list[str]:
    return [c for c in codes if not str(c).startswith(("8", "920"))]


def _codes(ns: argparse.Namespace) -> list[str] | None:
    if ns.index:
        pack = load_index_pool(ns.index.strip())
        codes = list(pack.get("codes") or [])
        print(
            f"index {pack.get('id')} {pack.get('label')} asof={pack.get('asof')} "
            f"n={len(codes)} source={pack.get('source')}",
            flush=True,
        )
    elif ns.codes:
        codes = [str(c) for c in ns.codes]
    else:
        import universe

        codes = universe.read_codes(fresh_only=False)
    if codes is None:
        return None
    if not ns.include_bj:
        kept = _drop_bj(codes)
        dropped = len(codes) - len(kept)
        if dropped:
            print(f"drop {dropped} bj (Tencent 2y empty). --include-bj to keep", flush=True)
        codes = kept
    return codes


def _tick(st: dict) -> None:
    done = int(st.get("done") or 0)
    total = int(st.get("universe") or 0)
    if done % 10 != 0 and done != total:
        return
    print(
        f"{done}/{total} ok={st.get('ok')} skip={st.get('skip')} fail={st.get('fail')} {st.get('current')}",
        flush=True,
    )


def main(argv: list[str] | None = None) -> int:
    ns = _parse(argv)
    start, end = window()
    snap = portrait()
    print(
        f"window {start}..{end} universe={snap.get('codes')} on_disk={snap.get('on_disk')}",
        flush=True,
    )
    try:
        codes = _codes(ns)
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    out = run_sync(codes=codes, workers=ns.workers, on_tick=_tick)
    print(
        f"{out.get('state')} done={out.get('done')} ok={out.get('ok')} "
        f"skip={out.get('skip')} fail={out.get('fail')} {out.get('error') or ''}".rstrip(),
        flush=True,
    )
    return 0 if out.get("state") == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
