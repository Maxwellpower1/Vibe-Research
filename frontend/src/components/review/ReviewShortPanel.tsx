import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Flame } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ShortTermEmotion } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  emotion: ShortTermEmotion | null;
  emoDone: boolean;
  updatedLabel: string;
  pending: ReactNode;
}

/** Short-term limit-up ladder + lianban list. */
export function ReviewShortPanel({ emotion, emoDone, updatedLabel, pending }: Props) {
  return (
    <GlassCard className="!mb-0 !p-0 overflow-hidden lg:col-span-2 xl:col-span-1">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Flame className="h-3.5 w-3.5 text-primary/80" /> 短线
        </p>
        <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">{updatedLabel}</p>
      </div>
      {!emotion || emotion.zt_count === undefined ? (
        emoDone ? (
          <EmptyState title="暂无短线数据" description="非交易时段或数据源暂时不可用，可点刷新重试" />
        ) : (
          pending
        )
      ) : (
        <div className="grid max-h-[22rem] grid-cols-[9.5rem_minmax(0,1fr)]">
          <div className="space-y-0.5 overflow-auto border-r border-border/40 p-2">
            {[
              { k: "涨停", v: `${emotion.zt_count}`, cls: "text-danger" },
              { k: "跌停", v: `${emotion.dt_count}`, cls: "text-success" },
              { k: "最高板", v: `${emotion.max_boards}`, cls: "text-primary" },
              { k: "连板+", v: `${emotion.lianban_count}`, cls: "text-primary" },
              {
                k: "封板率",
                v: emotion.seal_rate == null ? "—" : `${(emotion.seal_rate * 100).toFixed(1)}%`,
                cls: "text-danger",
              },
              {
                k: "炸板率",
                v: emotion.break_rate == null ? "—" : `${(emotion.break_rate * 100).toFixed(1)}%`,
                cls: "text-success",
              },
              {
                k: "晋级率",
                v: emotion.promotion_rate == null ? "—" : `${(emotion.promotion_rate * 100).toFixed(1)}%`,
                cls: "text-danger",
              },
            ].map((c) => (
              <div key={c.k} className="flex items-baseline justify-between gap-2 rounded-md px-1.5 py-1.5">
                <p className="shrink-0 text-xs text-muted-foreground">{c.k}</p>
                <p className={cn("text-right font-mono text-lg font-bold tabular-nums leading-tight", c.cls)}>{c.v}</p>
              </div>
            ))}
          </div>
          <div className="min-w-0 overflow-auto">
            <p className="sticky top-0 z-10 border-b border-border/40 bg-card/90 px-2.5 py-1.5 text-[10px] text-muted-foreground/70 backdrop-blur">
              连板股 · 非推荐
            </p>
            {emotion.lianban_stocks.length === 0 ? (
              <p className="px-3 py-6 text-xs text-muted-foreground/50">今日无 2 板以上</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    {["名称", "连板", "涨停%", "行业"].map((h) => (
                      <th key={h} className={h === "连板" || h === "涨停%" ? "num" : ""}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {emotion.lianban_stocks.slice(0, 12).map((s) => (
                    <tr key={s.code}>
                      <td>
                        <Link to={`/a-share?tab=kline&code=${s.code}`} className="hover:text-primary">
                          <span className="font-medium">{s.name}</span>{" "}
                          <span className="text-muted-foreground/50">{s.code}</span>
                        </Link>
                      </td>
                      <td className="num font-bold text-primary">{s.boards}</td>
                      <td className="num"><span className="pct-chip up">+{s.pct}%</span></td>
                      <td className="max-w-[5.5rem] truncate text-muted-foreground" title={s.industry || undefined}>
                        {s.industry || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </GlassCard>
  );
}
