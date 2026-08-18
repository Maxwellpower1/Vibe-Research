import { useMemo, useState } from "react";
import { api, type ThsKlineBar, type ThsSnapRow } from "@/lib/api";
import { THS_CMD_CODES, THS_CMD_INDICES } from "@/config/thsCmdIndex";
import { usePolling } from "@/hooks/usePolling";
import { nextSort, num, TrendPreviewCell, type PreviewSeries, type SortState } from "@/components/ovlab/shared";
import { tradingDayOf } from "@/lib/derivMinuteAxis";
import { CellEmpty, cmpVal, CtnText, SortableHd } from "./derivShared";

type IdxKey = "label" | "last" | "pct";

/** ms timestamp -> Asia/Shanghai YYYY-MM-DD HH:MM:SS for the session axis. */
export function thsMinuteStamp(ms: number): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
  const p = Object.fromEntries(
    fmt.formatToParts(new Date(ms)).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Keep only the last trading day's prints so two calendar days do not stack on the same clock. */
export function thsSessionPrices(bars: ThsKlineBar[] | null | undefined): Array<[string, number]> {
  const pts: Array<[string, number]> = [];
  for (const b of bars ?? []) {
    if (b.t == null || !Number.isFinite(b.t)) continue;
    const close = num(b.close);
    if (close === null) continue;
    pts.push([thsMinuteStamp(b.t), close]);
  }
  if (pts.length < 2) return pts;
  const td = tradingDayOf(pts[pts.length - 1][0]);
  return pts.filter((p) => tradingDayOf(p[0]) === td);
}

/** 同花顺商品指数: 快照 + 分钟分时. 只在指数 tab 挂载, 走 /api/ths, 不碰 ovlab / 报价中心. */
export function ThsCmdIndexPanel() {
  const [sort, setSort] = useState<SortState<Record<IdxKey, unknown>>>({ key: null, dir: "desc" });

  const snapPoll = usePolling(
    () => api.thsSnapshot(THS_CMD_CODES),
    30_000,
    [THS_CMD_CODES.join(",")],
  );
  const sparkPoll = usePolling(
    () => Promise.all(THS_CMD_CODES.map((c) => api.thsKline(c, "min_1", 600).catch(() => [] as ThsKlineBar[]))),
    60_000,
    [THS_CMD_CODES.join(",")],
  );

  const snaps = useMemo(() => {
    const m: Record<string, ThsSnapRow> = {};
    for (const r of snapPoll.data ?? []) {
      if (r.code) m[r.code] = r;
    }
    return m;
  }, [snapPoll.data]);

  const sparks = useMemo(() => {
    const m: Record<string, PreviewSeries> = {};
    (sparkPoll.data ?? []).forEach((bars, i) => {
      const code = THS_CMD_CODES[i];
      const prices = thsSessionPrices(bars);
      if (prices.length >= 2) m[code] = { prices, volatilities: [] };
    });
    return m;
  }, [sparkPoll.data]);

  const sparkLoading = sparkPoll.data === null && !sparkPoll.error;
  const rows = useMemo(() => {
    const list = THS_CMD_INDICES.map((d) => {
      const s = snaps[d.code];
      return {
        ...d,
        last: num(s?.last),
        prev: num(s?.prev),
        pct: num(s?.pct),
      };
    });
    if (!sort.key) return list;
    const key = sort.key;
    return [...list].sort((a, b) => cmpVal(a[key], b[key], sort.dir));
  }, [snaps, sort]);

  if (snapPoll.error && !snapPoll.data) {
    return <CellEmpty text={snapPoll.error} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1.5 text-[10px] text-slate-300">
        <SortableHd k="label" label="指数" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} className="min-w-0 flex-1 justify-start" />
        <SortableHd k="last" label="最新" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} className="justify-end" />
        <SortableHd k="pct" label="涨跌" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} className="justify-end" />
        <span className="w-[52px] shrink-0">分时</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-1">
        {rows.map((r) => (
          <div
            key={r.code}
            className="flex w-full items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-800/40"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-200">{r.label}</span>
              <span className="text-[12px] font-medium tabular-nums text-slate-200">
                {r.last !== null ? r.last.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "-"}
              </span>
              <CtnText value={r.pct !== null ? r.pct / 100 : null} boldOver={3} />
            </div>
            <TrendPreviewCell
              series={sparks[r.code]}
              loading={sparkLoading && !sparks[r.code]}
              base={r.prev}
              und={r.code}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
