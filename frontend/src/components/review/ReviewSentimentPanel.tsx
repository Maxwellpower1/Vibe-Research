import { type ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { pctColor } from "@/components/review/format";
import type { MarketBreadth, MarketSentiment } from "@/lib/api";
import { cn } from "@/lib/utils";

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

interface Props {
  sentiment: MarketSentiment | undefined;
  ovDone: boolean;
  pending: ReactNode;
  breadth?: MarketBreadth | null;
}

/** TickFlow-style up/down distribution + market breadth. */
export function ReviewSentimentPanel({
  sentiment,
  ovDone,
  pending,
  breadth,
}: Props) {
  const up = breadth?.up ?? sentiment?.up ?? 0;
  const down = breadth?.down ?? sentiment?.down ?? 0;
  const flat = breadth?.flat ?? sentiment?.flat ?? 0;
  const total = Math.max(1, up + down + flat);
  const upShare = up / total;
  const downShare = down / total;
  const flatShare = flat / total;
  const hasCounts = (up + down + flat) > 0;
  const hasHist = !!(breadth && breadth.n > 0 && breadth.histogram?.length);
  const ready = hasCounts || hasHist;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto px-2 py-1.5">
      {!ready && !ovDone ? (
        pending
      ) : !ready ? (
        <EmptyState
          title="涨跌分布暂不可用"
          description="可点刷新重试；非交易时段或数据源限流时属正常。"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {hasHist && (
            <div className="grid min-h-[7rem] flex-1 grid-cols-8 items-end gap-1 pt-1">
              {breadth!.histogram!.map((h, i) => {
                const max = Math.max(...breadth!.histogram!.map((x) => x.count), 1);
                const upSide = i >= 4;
                return (
                  <div key={h.label} className="flex h-full min-w-0 flex-col items-center justify-end gap-0.5">
                    <div className="font-mono text-[9px] tabular-nums text-slate-500">
                      {h.count || ""}
                    </div>
                    <div
                      className={cn(
                        "w-2.5 rounded-full",
                        upSide
                          ? "bg-gradient-to-t from-danger/45 to-danger/90"
                          : "bg-gradient-to-t from-success/45 to-success/90",
                      )}
                      style={{ height: `${Math.max(6, (h.count / max) * 86)}%` }}
                      title={`${h.label}: ${h.count} 只`}
                    />
                    <span className="truncate text-[9px] text-slate-600">{h.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {hasCounts && (
            <div className="shrink-0 space-y-1.5">
              <div
                className="flex h-2.5 overflow-hidden rounded-full bg-slate-800"
                title={`上涨 ${up} · 平盘 ${flat} · 下跌 ${down}`}
              >
                <div className="bg-danger/85 transition-[width] duration-500 ease-out" style={{ width: `${upShare * 100}%` }} />
                <div className="bg-slate-500/45 transition-[width] duration-500 ease-out" style={{ width: `${flatShare * 100}%` }} />
                <div className="bg-success/85 transition-[width] duration-500 ease-out" style={{ width: `${downShare * 100}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                <div className="rounded bg-danger/10 px-2 py-1 text-danger">
                  涨 <span className="font-mono tabular-nums">{up}</span>
                  <span className="ml-1 text-[10px] text-danger/70">{(upShare * 100).toFixed(1)}%</span>
                </div>
                <div className="rounded bg-slate-800/70 px-2 py-1 text-slate-400">
                  平 <span className="font-mono tabular-nums">{flat}</span>
                </div>
                <div className="rounded bg-success/10 px-2 py-1 text-success">
                  跌 <span className="font-mono tabular-nums">{down}</span>
                  <span className="ml-1 text-[10px] text-success/70">{(downShare * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          )}

          {hasHist && (
            <div className="grid shrink-0 grid-cols-3 gap-1.5">
              <div className="rounded-md border border-slate-700/40 bg-slate-900/40 px-2 py-1.5">
                <p className="text-[10px] text-slate-500">平均涨跌</p>
                <p className={cn("mt-0.5 font-mono text-sm font-semibold tabular-nums", pctColor(breadth!.avg ?? 0))}>
                  {fmtPct(breadth!.avg)}
                </p>
              </div>
              <div className="rounded-md border border-slate-700/40 bg-slate-900/40 px-2 py-1.5">
                <p className="text-[10px] text-slate-500">中位涨跌</p>
                <p className={cn("mt-0.5 font-mono text-sm font-semibold tabular-nums", pctColor(breadth!.p50 ?? 0))}>
                  {fmtPct(breadth!.p50)}
                </p>
              </div>
              <div className="rounded-md border border-slate-700/40 bg-slate-900/40 px-2 py-1.5">
                <p className="text-[10px] text-slate-500">家数</p>
                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-200">
                  {breadth!.n}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
