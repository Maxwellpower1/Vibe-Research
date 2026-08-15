import { useFin } from "@/components/fin/FinContext";
import { fmtYiYuan } from "@/components/fin/utils";
import { pctColor } from "@/components/review/format";
import { cn } from "@/lib/utils";

export function FinIndustryPanel() {
  const { board: data, boardError: error } = useFin();
  const rows = data?.industries ?? [];
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.net_profit)), 1);
  const live = new Map((data?.sector_tape?.top ?? []).map((r) => [r.name, r.change_pct]));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-1.5">
      {!data && <p className="py-6 text-center text-[11px] text-slate-600">{error ? "行业榜未接通" : "加载中…"}</p>}
      {rows.map((r) => {
        const w = Math.min(100, (Math.abs(r.net_profit) / maxAbs) * 100);
        const livePct = live.get(r.name);
        return (
          <div key={r.name} className="mb-1">
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate text-[11px] text-slate-300">{r.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-slate-400">
                {fmtYiYuan(r.net_profit)}
                <span className={cn("ml-1", pctColor(r.yoy))}>
                  {r.yoy > 0 ? "+" : ""}{r.yoy.toFixed(1)}%
                </span>
                {livePct != null && (
                  <span className={cn("ml-1", pctColor(livePct))}>今{livePct > 0 ? "+" : ""}{livePct.toFixed(1)}%</span>
                )}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-slate-800">
              <div
                className={cn("h-1.5 rounded-full", r.yoy >= 0 ? "bg-rose-400/70" : "bg-emerald-400/50")}
                style={{ width: `${w}%`, opacity: r.yoy >= 0 ? 1 : 0.55 }}
              />
            </div>
            <p className="text-[9px] text-slate-600">{r.count} 家</p>
          </div>
        );
      })}
    </div>
  );
}
