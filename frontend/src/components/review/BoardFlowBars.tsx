import { Link } from "react-router-dom";
import type { BoardFlowRow } from "@/lib/api";
import { fmt, pctColor } from "@/components/review/format";
import { cn } from "@/lib/utils";

interface Props {
  rows: BoardFlowRow[];
  selected?: string | null;
  onSelect?: (row: BoardFlowRow | null) => void;
}

function yi(n: number) {
  return `${n > 0 ? "+" : ""}${fmt(n / 1e8)}`;
}

/** Bidirectional board money-flow bars (inflow / outflow). */
export function BoardFlowBars({ rows, selected, onSelect }: Props) {
  const inflow = rows.filter((r) => r.main_net > 0).slice(0, 8);
  const outflow = [...rows].filter((r) => r.main_net < 0).sort((a, b) => a.main_net - b.main_net).slice(0, 8);
  const maxAbs = Math.max(
    ...inflow.map((r) => Math.abs(r.main_net)),
    ...outflow.map((r) => Math.abs(r.main_net)),
    1,
  );

  const render = (list: BoardFlowRow[], side: "in" | "out") => (
    <div className="min-w-0 space-y-0.5">
      <p className={cn("px-1 text-[10px]", side === "in" ? "text-red-400/80" : "text-emerald-400/80")}>
        {side === "in" ? "流入 Top" : "流出 Top"}
      </p>
      {list.map((r) => {
        const w = Math.min(100, (Math.abs(r.main_net) / maxAbs) * 100);
        const active = selected === r.code;
        return (
          <button
            key={`${r.code}-${r.name}`}
            type="button"
            onClick={() => onSelect?.(active ? null : r)}
            className={cn(
              "grid w-full grid-cols-[1fr_56px] items-center gap-1 rounded px-1 py-0.5 text-left",
              active ? "bg-cyan-500/10 ring-1 ring-cyan-500/40" : "hover:bg-slate-800/50",
            )}
          >
            <span className="min-w-0">
              <span className="flex items-baseline gap-1.5">
                <span className="truncate text-[11px] text-slate-200">{r.name}</span>
                <span className={cn("shrink-0 font-mono text-[10px]", pctColor(r.change_pct))}>
                  {r.change_pct > 0 ? "+" : ""}{r.change_pct.toFixed(1)}%
                </span>
              </span>
              <span className="mt-0.5 block h-1 rounded-full bg-slate-800">
                <span
                  className={cn("block h-1 rounded-full", side === "in" ? "bg-red-400/80" : "bg-emerald-400/70")}
                  style={{ width: `${w}%` }}
                />
              </span>
              {r.leader ? (
                <span className="truncate text-[10px] text-slate-500">
                  领涨 {r.leader}
                </span>
              ) : null}
            </span>
            <span className={cn("text-right font-mono text-[10px] tabular-nums", pctColor(r.main_net))}>
              {yi(r.main_net)}亿
            </span>
          </button>
        );
      })}
    </div>
  );

  if (!rows.length) return null;

  return (
    <div className="grid h-full min-h-0 grid-cols-2 gap-2 overflow-auto p-1">
      {render(inflow, "in")}
      {render(outflow, "out")}
    </div>
  );
}

export function StockFlowList({
  rows,
  title,
}: {
  rows: Array<{
    code: string; name: string; price: number; change_pct: number;
    main_net: number; main_pct: number; amount?: number;
  }>;
  title?: string;
}) {
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.main_net)), 1);
  return (
    <div className="space-y-0.5">
      {title && <p className="px-1 text-[10px] text-slate-500">{title}</p>}
      {rows.map((r) => {
        const w = Math.min(100, (Math.abs(r.main_net) / maxAbs) * 100);
        return (
          <Link
            key={r.code}
            to={`/a-share?tab=kline&code=${r.code}`}
            className="grid grid-cols-[1fr_64px] items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-800/50"
          >
            <span className="min-w-0">
              <span className="flex items-baseline gap-1.5">
                <span className="truncate text-[11px] text-slate-200">{r.name}</span>
                <span className="font-mono text-[10px] text-slate-500">{r.code}</span>
                <span className={cn("shrink-0 font-mono text-[10px]", pctColor(r.change_pct))}>
                  {r.change_pct > 0 ? "+" : ""}{r.change_pct.toFixed(2)}%
                </span>
              </span>
              <span className="mt-0.5 block h-1 rounded-full bg-slate-800">
                <span
                  className={cn("block h-1 rounded-full", r.main_net >= 0 ? "bg-red-400/80" : "bg-emerald-400/70")}
                  style={{ width: `${w}%` }}
                />
              </span>
            </span>
            <span className={cn("text-right font-mono text-[10px] tabular-nums", pctColor(r.main_net))}>
              {yi(r.main_net)}亿
            </span>
          </Link>
        );
      })}
    </div>
  );
}
