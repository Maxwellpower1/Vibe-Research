import { useMemo, useState } from "react";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { useFin } from "@/components/fin/FinContext";
import { quarterLabel } from "@/components/fin/utils";
import { usePolling } from "@/hooks/usePolling";
import { api, type FinCalendarItem, type GlobalEarningsRow } from "@/lib/api";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;
const dateKey = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function FinCalendarPanel() {
  const { period, select } = useFin();
  const [tab, setTab] = useState<"cn" | "us">("cn");
  const { data, error } = usePolling(() => api.finBoard(period), 3600_000, [period]);
  const { data: us } = usePolling(
    () => api.globalEarningsCalendar({ days: 14 }),
    3600_000,
    [tab],
  );

  const view = useMemo(() => {
    const cal = data?.calendar ?? [];
    const counts = new Map<string, number>();
    for (const it of cal) counts.set(it.date, (counts.get(it.date) ?? 0) + 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 21 }, (_, i) => {
      const offset = i - 7;
      const key = dateKey(today.getTime() + offset * DAY);
      return { key, offset, count: counts.get(key) ?? 0 };
    });
    const todayKey = days[7].key;
    const peak = Math.max(...days.map((d) => d.count), 0);
    const byDate = new Map<string, FinCalendarItem[]>();
    for (const it of cal) {
      const arr = byDate.get(it.date) ?? [];
      arr.push(it);
      byDate.set(it.date, arr);
    }
    let listDate = todayKey;
    let listLabel = "今日披露";
    if (!byDate.has(todayKey)) {
      const tmr = dateKey(today.getTime() + DAY);
      if (byDate.has(tmr)) {
        listDate = tmr;
        listLabel = "明日披露";
      } else {
        listDate = cal[0]?.date ?? todayKey;
        listLabel = listDate ? `${listDate.slice(5)} 披露` : "披露";
      }
    }
    return {
      days, todayKey, peak, todayCount: counts.get(todayKey) ?? 0,
      list: byDate.get(listDate) ?? [], listLabel,
      heavy: new Set((data?.stocks ?? []).slice(0, 50).map((s) => s.code)),
    };
  }, [data]);

  const usRows: GlobalEarningsRow[] = us?.rows ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-700/40 px-1.5 py-1">
        <ChipGroup>
          <Chip active={tab === "cn"} onClick={() => setTab("cn")}>A股</Chip>
          <Chip active={tab === "us"} onClick={() => setTab("us")}>美股</Chip>
        </ChipGroup>
        <span className="font-mono text-[10px] text-slate-500">
          {tab === "cn" ? `已披露 ${data?.disclosed ?? "—"}` : `区间 ${us?.total ?? usRows.length} 家`}
        </span>
      </div>
      {tab === "cn" ? (
        <div className="flex min-h-0 flex-1 flex-col p-1.5">
          <div className="flex h-10 shrink-0 items-end gap-px">
            {view.days.map((d) => {
              const h = view.peak > 0 ? (d.count / view.peak) * 28 : 0;
              const today = d.key === view.todayKey;
              return (
                <div key={d.key} className="flex flex-1 flex-col items-center justify-end" title={`${d.key} ${d.count}家`}>
                  <div
                    className={cn(
                      "w-full max-w-[8px] rounded-t",
                      today ? "bg-amber-400" : d.offset < 0 ? "bg-slate-600" : "bg-cyan-400/50",
                    )}
                    style={{ height: Math.max(h, d.count ? 2 : 1) }}
                  />
                </div>
              );
            })}
          </div>
          <p className="mt-1 shrink-0 text-[10px] text-slate-500">
            今日 <span className="font-semibold text-amber-300">{view.todayCount}</span> 家 · 峰值 {view.peak} 家
          </p>
          <p className="mt-1 shrink-0 text-[10px] text-amber-300/80">{view.listLabel}</p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!data && <p className="py-6 text-center text-[11px] text-slate-600">{error ? "日历未接通" : "加载中…"}</p>}
            {view.list.map((it) => (
              <button
                key={`${it.code}-${it.date}`}
                type="button"
                onClick={() => select(it.code, it.name)}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-800/40"
              >
                <span className="w-10 shrink-0 font-mono text-[10px] text-slate-500">{it.date.slice(5)}</span>
                <span className="min-w-0 truncate text-[12px] text-slate-200">{it.name}</span>
                <span className="shrink-0 text-[10px] text-slate-600">{quarterLabel(it.period || it.date)}</span>
                {view.heavy.has(it.code) && <span className="text-[10px] text-amber-300">★</span>}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {!us && <p className="py-6 text-center text-[11px] text-slate-600">美股财报日历加载中…</p>}
          {usRows.slice(0, 40).map((r, i) => (
            <div key={`${r.symbol}-${r.date}-${i}`} className="flex items-center gap-2 px-1 py-0.5">
              <span className="w-16 shrink-0 font-mono text-[10px] text-slate-500">{(r.date || "").slice(5)}</span>
              <span className="w-14 shrink-0 font-mono text-[11px] text-cyan-300">{r.symbol}</span>
              <span className="min-w-0 truncate text-[12px] text-slate-200">{r.name || "—"}</span>
              <span className="shrink-0 text-[10px] text-slate-500">{r.time || ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
