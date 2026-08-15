import { type ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { pctColor } from "@/components/review/format";
import { HsgtStrip } from "@/components/review/HsgtStrip";
import type { HsgtLive, IndustryRow, MarketBreadth, MarketSentiment } from "@/lib/api";
import { cn } from "@/lib/utils";

const cell = "min-w-0 rounded-md border border-slate-700/40 bg-slate-900/40 px-2 py-1.5";

function breadthSourceLabel(src?: string): string {
  if (!src || src === "none") return "截面";
  if (src.startsWith("sina")) return "新浪截面";
  if (src.startsWith("tencent")) return "腾讯行情";
  if (src.includes("eastmoney")) return "东财截面";
  return src;
}

interface Props {
  sentiment: MarketSentiment | undefined;
  ovDone: boolean;
  updatedLabel: string;
  indTop?: IndustryRow;
  indBot?: IndustryRow;
  pending: ReactNode;
  hsgt?: HsgtLive | null;
  breadth?: MarketBreadth | null;
}

/** Breadth / speculation / up-down bar + industry extremes. */
export function ReviewSentimentPanel({
  sentiment,
  ovDone,
  updatedLabel,
  indTop,
  indBot,
  pending,
  hsgt,
  breadth,
}: Props) {
  const sentCells = sentiment ? [
    { k: "涨停", v: sentiment.zt, up: true as boolean | null },
    { k: "真实涨停", v: sentiment.zt_real, up: true as boolean | null },
    { k: "跌停", v: sentiment.dt, up: false as boolean | null },
    { k: "真实跌停", v: sentiment.dt_real, up: false as boolean | null },
    { k: "活跃度", v: sentiment.active, up: null as boolean | null },
  ] : [];
  const breadthTotal = sentiment
    ? Math.max(1, (sentiment.up || 0) + (sentiment.down || 0) + (sentiment.flat || 0))
    : 1;
  const upShare = sentiment ? (sentiment.up || 0) / breadthTotal : 0;
  const downShare = sentiment ? (sentiment.down || 0) / breadthTotal : 0;
  const flatShare = sentiment ? (sentiment.flat || 0) / breadthTotal : 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      {hsgt !== undefined && <HsgtStrip data={hsgt ?? null} />}
      <p className="mb-1 shrink-0 px-2 pt-1 font-mono text-[10px] tabular-nums text-slate-500">{updatedLabel}</p>

      {!sentiment?.breadth && !ovDone ? (
        pending
      ) : !sentiment?.breadth ? (
        <EmptyState
          title="市场情绪暂不可用"
          description="可点刷新重试；非交易时段或数据源限流时属正常。"
        />
      ) : (
        <div className="px-2 pb-2">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {[
              { k: "大盘宽度", v: sentiment.breadth, hint: "冰点 / 偏弱 / 中性 / 偏强 / 普涨" },
              { k: "题材投机", v: sentiment.speculation, hint: "冰点 / 普通 / 活跃 / 亢奋" },
            ].map((m) => (
              <div key={m.k} className={cn(cell, "border-cyan-500/20")}>
                <p className="text-[10px] text-slate-500">{m.k}</p>
                <p className="mt-0.5 text-lg font-bold tracking-tight text-cyan-300">{m.v}</p>
                <p className="truncate text-[10px] text-slate-600">{m.hint}</p>
              </div>
            ))}
          </div>
          <div className={cn(cell, "mt-1.5")}>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 text-left">
                <p className="text-[10px] text-slate-500">上涨</p>
                <p className="font-mono text-lg font-bold tabular-nums text-danger">{sentiment.up}</p>
                <p className="text-[10px] text-danger/80">{(upShare * 100).toFixed(1)}%</p>
              </div>
              <div className="min-w-0 text-center">
                <p className="text-[10px] text-slate-500">平盘</p>
                <p className="font-mono text-sm font-semibold tabular-nums text-slate-400">{sentiment.flat}</p>
                <p className="text-[10px] text-slate-600">{(flatShare * 100).toFixed(1)}%</p>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-[10px] text-slate-500">下跌</p>
                <p className="font-mono text-lg font-bold tabular-nums text-success">{sentiment.down}</p>
                <p className="text-[10px] text-success/80">{(downShare * 100).toFixed(1)}%</p>
              </div>
            </div>
            <div
              className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-slate-800"
              title={`上涨 ${sentiment.up} · 平盘 ${sentiment.flat} · 下跌 ${sentiment.down}`}
            >
              <div className="bg-danger transition-[width] duration-500 ease-out" style={{ width: `${upShare * 100}%` }} />
              <div className="bg-slate-500/50 transition-[width] duration-500 ease-out" style={{ width: `${flatShare * 100}%` }} />
              <div className="bg-success transition-[width] duration-500 ease-out" style={{ width: `${downShare * 100}%` }} />
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-600">
              <span>红涨</span>
              <span className="font-mono tabular-nums">
                {sentiment.up}:{sentiment.down}
                {sentiment.up + sentiment.down > 0
                  ? ` · 涨跌比 ${(sentiment.up / Math.max(1, sentiment.down)).toFixed(2)}`
                  : ""}
              </span>
              <span>绿跌</span>
            </div>
          </div>
          {breadth && breadth.n > 0 && (
            <div className={cn(cell, "mt-1.5")}>
              <p className="text-[10px] text-slate-500">
                全市场涨跌分位 · {breadth.n} 只 · {breadthSourceLabel(breadth.source)}
              </p>
              <div className="mt-1 grid grid-cols-5 gap-1 font-mono text-[11px] tabular-nums">
                {([
                  ["p10", breadth.p10],
                  ["p25", breadth.p25],
                  ["中位", breadth.p50],
                  ["p75", breadth.p75],
                  ["p90", breadth.p90],
                ] as const).map(([k, v]) => (
                  <div key={k} className="text-center">
                    <p className="text-[9px] text-slate-600">{k}</p>
                    <p className={cn("font-semibold", pctColor(v ?? 0))}>
                      {v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
                    </p>
                  </div>
                ))}
              </div>
              {!!breadth.histogram?.length && (
                <div className="mt-1.5 grid h-14 grid-cols-8 items-end gap-0.5">
                  {breadth.histogram.map((h, i) => {
                    const max = Math.max(...breadth.histogram!.map((x) => x.count), 1);
                    return (
                      <div key={h.label} className="flex h-full min-w-0 flex-col items-center justify-end gap-0.5">
                        <div
                          className={cn(
                            "w-full max-w-[10px] rounded-sm",
                            i >= 4 ? "bg-danger/80" : "bg-success/80",
                          )}
                          style={{ height: `${Math.max(8, (h.count / max) * 100)}%` }}
                          title={`${h.label}: ${h.count}`}
                        />
                        <span className="truncate text-[8px] text-slate-600">{h.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="mt-1.5 grid grid-cols-3 gap-1 sm:grid-cols-5">
            {sentCells.map((c) => (
              <div key={c.k} className={cn(cell, "text-center")}>
                <p className="truncate text-[10px] text-slate-500">{c.k}</p>
                <p className={cn(
                  "mt-0.5 truncate font-mono text-sm font-bold tabular-nums",
                  c.up === null ? "text-slate-100" : c.up ? "text-danger" : "text-success",
                )}>{c.v}</p>
              </div>
            ))}
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {indTop && (
              <div className={cell}>
                <p className="text-[10px] text-slate-500">行业强</p>
                <p className={cn("mt-0.5 truncate text-sm font-bold", pctColor(indTop.change_pct))}>{indTop.name}</p>
                <p className="text-[10px] text-slate-500">
                  {indTop.change_pct > 0 ? "+" : ""}{indTop.change_pct}%
                </p>
              </div>
            )}
            {indBot && (
              <div className={cell}>
                <p className="text-[10px] text-slate-500">行业弱</p>
                <p className={cn("mt-0.5 truncate text-sm font-bold", pctColor(indBot.change_pct))}>{indBot.name}</p>
                <p className="text-[10px] text-slate-500">
                  {indBot.change_pct > 0 ? "+" : ""}{indBot.change_pct}%
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
