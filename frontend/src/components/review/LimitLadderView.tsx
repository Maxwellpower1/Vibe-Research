import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { reviewPending } from "@/components/review/reviewPending";
import type { LianbanStock, ShortTermEmotion } from "@/lib/api";
import { cn } from "@/lib/utils";

type Side = "up" | "down";

function tierLabel(n: number, plus: boolean, side: Side): string {
  if (side === "down") {
    if (n <= 1) return "首跌";
    return plus ? `${n}跌+` : `${n}跌`;
  }
  if (n <= 1) return "首板";
  return plus ? `${n}板+` : `${n}板`;
}

function tierBorder(n: number, side: Side): string {
  if (side === "down") {
    if (n >= 5) return "border-success";
    if (n >= 3) return "border-emerald-500/60";
    if (n >= 2) return "border-emerald-500/40";
    return "border-slate-600/50";
  }
  if (n >= 5) return "border-danger";
  if (n >= 3) return "border-orange-500/60";
  if (n >= 2) return "border-yellow-500/50";
  return "border-slate-600/50";
}

function tierText(n: number, side: Side): string {
  if (side === "down") {
    if (n >= 5) return "text-success";
    if (n >= 3) return "text-emerald-400";
    if (n >= 2) return "text-emerald-300";
    return "text-slate-400";
  }
  if (n >= 5) return "text-danger";
  if (n >= 3) return "text-orange-400";
  if (n >= 2) return "text-yellow-400";
  return "text-slate-400";
}

function boardTag(code: string): { label: string; cls: string } | null {
  if (/^(300|301)/.test(code)) return { label: "创", cls: "text-orange-400" };
  if (/^688/.test(code)) return { label: "科", cls: "text-cyan-400" };
  if (/^(8|4)\d{5}$/.test(code)) return { label: "北", cls: "text-violet-400" };
  return null;
}

interface Tier {
  boards: number;
  plus: boolean;
  stocks: LianbanStock[];
}

export function LimitLadderView({
  emotion,
  emoDone,
  side = "up",
}: {
  emotion: ShortTermEmotion | null;
  emoDone: boolean;
  side?: Side;
}) {
  const stocks = side === "down"
    ? (emotion?.dt_stocks ?? [])
    : (emotion?.zt_stocks?.length ? emotion.zt_stocks : (emotion?.lianban_stocks ?? []));
  const tiers = useMemo<Tier[]>(() => {
    const map = new Map<number, LianbanStock[]>();
    for (const s of stocks) {
      const b = Math.min(Math.max(s.boards || 1, 1), 5);
      const list = map.get(b) ?? [];
      list.push(s);
      map.set(b, list);
    }
    return [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([boards, rows]) => ({ boards, plus: boards >= 5, stocks: rows }));
  }, [stocks]);

  const countReady = side === "down" ? emotion?.dt_count : emotion?.zt_count;
  if (!emotion || countReady === undefined) {
    return <div className="p-5">{reviewPending(emoDone)}</div>;
  }
  if (!tiers.length) {
    return (
      <p className="px-3 py-6 text-center text-xs text-slate-600">
        {side === "down" ? "今日暂无跌停" : "今日暂无涨停"}
      </p>
    );
  }

  const maxN = Math.max(...tiers.map((t) => t.stocks.length), 1);
  const barCls = side === "down" ? "bg-emerald-400/40" : "bg-cyan-400/40";

  return (
    <div>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/80 bg-card/90 px-2 py-1.5 text-[11px] backdrop-blur">
        {tiers.map((t) => (
          <span key={t.boards} className="inline-flex items-center gap-1">
            <span className={cn("font-medium", tierText(t.boards, side))}>{tierLabel(t.boards, t.plus, side)}</span>
            <span
              className={cn("inline-block h-1.5 rounded-sm", barCls)}
              style={{ width: `${Math.max(8, (t.stocks.length / maxN) * 40)}px` }}
            />
            <span className="font-mono tabular-nums text-slate-500">{t.stocks.length}</span>
          </span>
        ))}
        {side === "up" && emotion.seal_rate != null && (
          <span className="ml-auto font-mono text-[10px] text-slate-500">
            封 {(emotion.seal_rate * 100).toFixed(0)}%
            {emotion.break_rate != null ? ` · 炸 ${(emotion.break_rate * 100).toFixed(0)}%` : ""}
          </span>
        )}
      </div>
      <div className="space-y-1.5 px-1.5 py-1.5">
        {tiers.map((t) => (
          <TierBlock key={t.boards} tier={t} side={side} defaultOpen={t.boards >= 2 || t.stocks.length <= 10} />
        ))}
      </div>
    </div>
  );
}

function TierBlock({ tier, side, defaultOpen }: { tier: Tier; side: Side; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("rounded-r border-l-2 bg-slate-900/40", tierBorder(tier.boards, side))}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-800/40"
      >
        <span className={cn("text-xs font-bold tabular-nums", tierText(tier.boards, side))}>
          {tierLabel(tier.boards, tier.plus, side)}
          <span className="mx-1 text-slate-600">·</span>
          {tier.stocks.length}
        </span>
        <ChevronDown className={cn("ml-auto h-3.5 w-3.5 text-slate-600 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1 px-2 pb-2">
          {tier.stocks.map((s) => {
            const tag = boardTag(s.code);
            return (
              <Link
                key={s.code || s.name}
                to={`/a-share?tab=kline&code=${s.code}`}
                className="rounded border border-slate-700/40 px-1.5 py-1 hover:border-cyan-500/40 hover:bg-slate-800/50"
              >
                <p className="flex items-center gap-1 truncate text-[11px] font-medium text-slate-200">
                  <span className="truncate">{s.name}</span>
                  {tag && <span className={cn("shrink-0 text-[9px]", tag.cls)}>{tag.label}</span>}
                </p>
                <p className="truncate text-[10px] text-slate-500">
                  {s.industry || s.code || "—"}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
