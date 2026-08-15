import { useState } from "react";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { useFin } from "@/components/fin/FinContext";
import { fmtYiYuan } from "@/components/fin/utils";
import { pctColor } from "@/components/review/format";
import { cn } from "@/lib/utils";

export function FinStockRankPanel() {
  const { select, company, board: data, boardError: error } = useFin();
  const [mode, setMode] = useState<"amt" | "yoy">("amt");
  const rows = [...(data?.stocks ?? [])];
  if (mode === "yoy") {
    rows.sort((a, b) => b.profit_yoy - a.profit_yoy);
  }
  const top = rows.slice(0, 30);
  const max = Math.max(...top.map((r) => (mode === "amt" ? Math.abs(r.net_profit) : Math.abs(r.profit_yoy))), 1);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 justify-end border-b border-slate-700/40 px-1.5 py-1">
        <ChipGroup>
          <Chip active={mode === "amt"} onClick={() => setMode("amt")}>净利额</Chip>
          <Chip active={mode === "yoy"} onClick={() => setMode("yoy")}>增速</Chip>
        </ChipGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {!data && <p className="py-6 text-center text-[11px] text-slate-600">{error ? "盈利榜未接通" : "加载中…"}</p>}
        {top.map((r, i) => {
          const val = mode === "amt" ? Math.abs(r.net_profit) : Math.abs(r.profit_yoy);
          const w = Math.min(100, (val / max) * 100);
          return (
            <button
              key={r.code}
              type="button"
              onClick={() => select(r.code, r.name)}
              className={cn(
                "relative mb-0.5 grid w-full grid-cols-[18px_1fr_56px_48px_40px] items-center gap-1 rounded px-1 py-0.5 text-left",
                company.code === r.code ? "ring-1 ring-cyan-500/40" : "hover:bg-slate-800/40",
              )}
            >
              <span
                className="absolute inset-y-0 left-0 rounded bg-rose-400/10"
                style={{ width: `${w}%` }}
              />
              <span className="relative font-mono text-[10px] text-slate-600">{i + 1}</span>
              <span className="relative truncate text-[12px] text-slate-200">{r.name}</span>
              <span className="relative text-right font-mono text-[11px] text-slate-300">{fmtYiYuan(r.net_profit)}</span>
              <span className={cn("relative text-right font-mono text-[10px]", pctColor(r.profit_yoy))}>
                {r.profit_yoy > 0 ? "+" : ""}{r.profit_yoy.toFixed(1)}%
              </span>
              <span className="relative text-right font-mono text-[10px] text-slate-500">{r.roe.toFixed(1)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
