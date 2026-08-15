import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/ui/EmptyState";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { PctChip } from "@/components/review/PctChip";
import { yi } from "@/components/review/format";
import type { HotList, IndustryData, TurnoverTop } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  stacked?: boolean;
  updatedLabel: string;
  industry: IndustryData | null;
  hot: HotList | null;
  turnover: TurnoverTop | null;
  extraDone: boolean;
  industryPending: ReactNode;
  hotPending: ReactNode;
  turnoverPending: ReactNode;
  /** Highlight industry row when a board-flow bar is selected. */
  highlightName?: string | null;
}

/** Second-row boards: industry / THS hot / turnover TOP. */
export function ReviewRankRow({
  stacked = false,
  updatedLabel,
  industry,
  hot,
  turnover,
  extraDone,
  industryPending,
  hotPending,
  turnoverPending,
  highlightName,
}: Props) {
  const [tab, setTab] = useState<"industry" | "hot" | "turnover">("industry");
  const matchName = (name: string) => {
    if (!highlightName) return false;
    return name.includes(highlightName) || highlightName.includes(name);
  };

  useEffect(() => {
    if (highlightName) setTab("industry");
  }, [highlightName]);

  const industryBody = (
    <>
      {!industry?.top?.length ? (
        extraDone ? (
          <EmptyState title="暂无行业数据" description="非交易时段或数据源暂时不可用，可点刷新重试" />
        ) : (
          industryPending
        )
      ) : (
        <div className="h-full overflow-auto p-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 px-1 text-[10px] font-medium text-danger">涨幅 Top</p>
              {industry.top.slice(0, 10).map((r) => (
                <div key={r.code || r.name} className={cn("flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-slate-800/40", matchName(r.name) && "bg-cyan-500/10 ring-1 ring-cyan-500/40")}>
                  <span className="w-4 text-muted-foreground/45">{r.rank}</span>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <PctChip pct={r.change_pct} />
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 px-1 text-[10px] font-medium text-success">相对弱势</p>
              {(industry.bottom || []).slice(0, 10).map((r, i) => (
                <div key={r.code || r.name} className={cn("flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-slate-800/40", matchName(r.name) && "bg-cyan-500/10 ring-1 ring-cyan-500/40")}>
                  <span className="w-4 text-muted-foreground/45">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <PctChip pct={r.change_pct} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );

  const hotBody = (
    <>
      {!hot?.rows?.length ? (
        extraDone ? (
          <EmptyState title="暂无热榜数据" description="非交易时段或数据源暂时不可用，可点刷新重试" />
        ) : (
          hotPending
        )
      ) : (
        <div className="h-full space-y-0.5 overflow-auto p-2">
          {hot.rows.slice(0, 20).map((r, i) => (
            <Link
              key={r.code || i}
              to={`/a-share?tab=kline&code=${r.code}`}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-primary/10"
            >
              <span className="w-5 font-mono text-xs text-muted-foreground/45">{r.rank ?? i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              <PctChip pct={r.pct == null ? null : Number(r.pct)} />
              {r.rank_chg != null && (
                <span className={cn(
                  "w-9 shrink-0 text-right font-mono text-[11px]",
                  (r.rank_chg ?? 0) > 0 ? "text-danger" : (r.rank_chg ?? 0) < 0 ? "text-success" : "text-muted-foreground",
                )}>
                  {r.rank_chg > 0 ? `↑${r.rank_chg}` : r.rank_chg < 0 ? `↓${Math.abs(r.rank_chg)}` : "—"}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  );

  const turnoverBody = (
    <>
      {!turnover || turnover.stocks.length === 0 ? (
        turnoverPending
      ) : (
        <div className="h-full overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                {["#", "名称", "涨跌%", "成交额"].map((h) => (
                  <th key={h} className={h !== "名称" ? "num" : ""}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {turnover.stocks.slice(0, 20).map((s, i) => (
                <tr key={s.code}>
                  <td className="num text-muted-foreground/50">{i + 1}</td>
                  <td>
                    <Link to={`/a-share?tab=kline&code=${s.code}`} className="hover:text-primary">
                      <span className="font-medium">{s.name}</span>{" "}
                      <span className="text-muted-foreground/50">{s.code}</span>
                    </Link>
                  </td>
                  <td className="num"><PctChip pct={s.pct} /></td>
                  <td className="num font-mono">{yi(s.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  if (stacked) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-700/40 px-2 py-1">
          <ChipGroup>
            {([
              ["industry", "行业"],
              ["hot", "热榜"],
              ["turnover", "成交额"],
            ] as const).map(([k, label]) => (
              <Chip key={k} active={tab === k} onClick={() => setTab(k)}>{label}</Chip>
            ))}
          </ChipGroup>
          <p className="shrink-0 font-mono text-[10px] tabular-nums text-slate-500">{updatedLabel}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "industry" && industryBody}
          {tab === "hot" && hotBody}
          {tab === "turnover" && turnoverBody}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5 grid gap-3 lg:grid-cols-3">
      <div className="overflow-hidden rounded-md border border-slate-700/40 bg-[#0c1320]/80">
        <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
          <p className="text-sm font-semibold">行业涨跌</p>
          <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">{updatedLabel}</p>
        </div>
        {industryBody}
      </div>
      <div className="overflow-hidden rounded-md border border-slate-700/40 bg-[#0c1320]/80">
        <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
          <p className="text-sm font-semibold">同花顺热榜</p>
          <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">{updatedLabel}</p>
        </div>
        {hotBody}
      </div>
      <div className="overflow-hidden rounded-md border border-slate-700/40 bg-[#0c1320]/80">
        <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
          <p className="text-sm font-semibold">成交额 TOP</p>
          <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">{updatedLabel}</p>
        </div>
        {turnoverBody}
      </div>
    </div>
  );
}
