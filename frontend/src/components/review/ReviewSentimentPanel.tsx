import { type ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { pctColor } from "@/components/review/format";
import type { IndustryRow, MarketSentiment } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  sentiment: MarketSentiment | undefined;
  ovDone: boolean;
  updatedLabel: string;
  indTop?: IndustryRow;
  indBot?: IndustryRow;
  pending: ReactNode;
}

/** Breadth / speculation / up-down bar + industry extremes. */
export function ReviewSentimentPanel({
  sentiment,
  ovDone,
  updatedLabel,
  indTop,
  indBot,
  pending,
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
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-border/60 bg-muted/15 p-3 sm:p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">盘面一眼 · 市场情绪</p>
        <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65" title="与顶部复盘一眼同步">
          {updatedLabel}
        </p>
      </div>

      {!sentiment?.breadth && !ovDone ? (
        pending
      ) : !sentiment?.breadth ? (
        <EmptyState
          title="市场情绪暂不可用"
          description="可点刷新重试；非交易时段或数据源限流时属正常。"
        />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { k: "大盘宽度", v: sentiment.breadth, hint: "冰点 / 偏弱 / 中性 / 偏强 / 普涨" },
              { k: "题材投机", v: sentiment.speculation, hint: "冰点 / 普通 / 活跃 / 亢奋" },
            ].map((m) => (
              <div key={m.k} className="rounded-xl border border-border/40 bg-gradient-to-br from-primary/10 to-muted/20 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">{m.k}</p>
                <p className="mt-0.5 text-2xl font-bold tracking-tight text-primary">{m.v}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground/55">{m.hint}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 rounded-xl border border-border/40 bg-card/40 px-3 py-2.5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 text-left">
                <p className="text-xs text-muted-foreground">上涨家数</p>
                <p className="font-mono text-xl font-bold tabular-nums text-danger">{sentiment.up}</p>
                <p className="text-[11px] text-danger/80">{(upShare * 100).toFixed(1)}%</p>
              </div>
              <div className="min-w-0 text-center">
                <p className="text-xs text-muted-foreground">平盘</p>
                <p className="font-mono text-sm font-semibold tabular-nums text-muted-foreground">{sentiment.flat}</p>
                <p className="text-[11px] text-muted-foreground/70">{(flatShare * 100).toFixed(1)}%</p>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-xs text-muted-foreground">下跌家数</p>
                <p className="font-mono text-xl font-bold tabular-nums text-success">{sentiment.down}</p>
                <p className="text-[11px] text-success/80">{(downShare * 100).toFixed(1)}%</p>
              </div>
            </div>
            <div
              className="mt-2.5 flex h-3.5 overflow-hidden rounded-full bg-muted/40"
              title={`上涨 ${sentiment.up} · 平盘 ${sentiment.flat} · 下跌 ${sentiment.down}`}
            >
              <div className="bg-danger transition-[width] duration-500 ease-out" style={{ width: `${upShare * 100}%` }} />
              <div className="bg-muted-foreground/35 transition-[width] duration-500 ease-out" style={{ width: `${flatShare * 100}%` }} />
              <div className="bg-success transition-[width] duration-500 ease-out" style={{ width: `${downShare * 100}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground/60">
              <span>红涨占比</span>
              <span className="font-mono tabular-nums">
                {sentiment.up}:{sentiment.down}
                {sentiment.up + sentiment.down > 0
                  ? ` · 涨跌比 ${(sentiment.up / Math.max(1, sentiment.down)).toFixed(2)}`
                  : ""}
              </span>
              <span>绿跌占比</span>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {sentCells.map((c) => (
              <div key={c.k} className="min-w-0 rounded-xl border border-border/40 bg-card/40 px-2 py-2 text-center">
                <p className="truncate text-xs text-muted-foreground">{c.k}</p>
                <p className={cn(
                  "mt-0.5 truncate font-mono text-base font-bold tabular-nums",
                  c.up === null ? "text-foreground" : c.up ? "text-danger" : "text-success",
                )}>{c.v}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {indTop && (
              <div className="min-w-0 rounded-xl border border-border/40 bg-card/40 px-2.5 py-2">
                <p className="text-xs text-muted-foreground">行业强</p>
                <p className={cn("mt-0.5 truncate text-base font-bold", pctColor(indTop.change_pct))}>{indTop.name}</p>
                <p className="text-xs text-muted-foreground/70">
                  {indTop.change_pct > 0 ? "+" : ""}{indTop.change_pct}%
                </p>
              </div>
            )}
            {indBot && (
              <div className="min-w-0 rounded-xl border border-border/40 bg-card/40 px-2.5 py-2">
                <p className="text-xs text-muted-foreground">行业弱</p>
                <p className={cn("mt-0.5 truncate text-base font-bold", pctColor(indBot.change_pct))}>{indBot.name}</p>
                <p className="text-xs text-muted-foreground/70">
                  {indBot.change_pct > 0 ? "+" : ""}{indBot.change_pct}%
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
