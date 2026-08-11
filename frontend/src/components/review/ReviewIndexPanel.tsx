import { Link } from "react-router-dom";
import { GlassCard } from "@/components/ui/GlassCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChipGroup, Chip } from "@/components/ui/SectionHeader";
import { PctChip } from "@/components/review/PctChip";
import { MinuteSpark } from "@/components/review/MinuteSpark";
import { fmt, pctColor } from "@/components/review/format";
import { WATCH_MINUTE_MAX, type IdxPanel } from "@/components/review/constants";
import type { AShareSession } from "@/lib/ashareSession";
import type { AShareLightKline, GlobalIndex, IndexQuote, Quote } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  idxPanel: IdxPanel;
  onIdxPanel: (p: IdxPanel) => void;
  updatedLabel: string;
  session: AShareSession;
  indices: IndexQuote[];
  idxErr: boolean;
  idxMinute: Record<string, AShareLightKline | null>;
  idxMinuteDone: boolean;
  globalIdx: GlobalIndex[];
  watchCodes: string[];
  watchQuotes: Record<string, Quote>;
  watchMinute: Record<string, AShareLightKline | null>;
  watchDone: boolean;
}

/** Domestic / global / watchlist index panel with optional minute sparks. */
export function ReviewIndexPanel({
  idxPanel,
  onIdxPanel,
  updatedLabel,
  session,
  indices,
  idxErr,
  idxMinute,
  idxMinuteDone,
  globalIdx,
  watchCodes,
  watchQuotes,
  watchMinute,
  watchDone,
}: Props) {
  return (
    <GlassCard className="!mb-0 !p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5">
        <ChipGroup>
          {([
            ["cn", "国内"],
            ["global", "全球"],
            ["watch", `自选${watchCodes.length ? ` ${watchCodes.length}` : ""}`],
          ] as const).map(([k, label]) => (
            <Chip key={k} active={idxPanel === k} onClick={() => onIdxPanel(k)}>{label}</Chip>
          ))}
        </ChipGroup>
        <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">{updatedLabel}</p>
      </div>

      <div className="max-h-[28rem] overflow-auto p-3">
        {idxPanel === "cn" && (
          indices.length === 0 ? (
            idxErr ? (
              <EmptyState title="A股指数未接通" description="可点顶部刷新重试；非交易时段或源限流时属正常。" />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground/65">加载中…</p>
            )
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {indices.map((ix) => {
                const sym = ix.symbol || "";
                const kl = sym ? idxMinute[sym] : null;
                const closes = (kl?.bars || []).map((b) => b.close).filter((n) => Number.isFinite(n));
                return (
                  <div key={sym || ix.name} className="rounded-xl border border-border/40 bg-card/40 px-2.5 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-semibold">{ix.name}</span>
                      <PctChip pct={ix.change_pct} />
                    </div>
                    <p className={cn("mt-0.5 font-mono text-sm font-bold tabular-nums", pctColor(ix.change_pct))}>
                      {fmt(ix.price)}
                    </p>
                    <div className="mt-1">
                      {!idxMinuteDone && !kl ? (
                        <div className="flex h-9 items-center justify-center text-[10px] text-muted-foreground/50">分时加载中…</div>
                      ) : closes.length < 2 ? (
                        <div className="flex h-9 items-center justify-center text-[10px] text-muted-foreground/50">
                          {sym.startsWith("hk")
                            ? "暂无分时"
                            : session.kind !== "open"
                              ? "非交易时段暂无分时"
                              : "暂无分时"}
                        </div>
                      ) : (
                        <MinuteSpark closes={closes} prevClose={kl?.prev_close} pct={ix.change_pct} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {idxPanel === "global" && (
          globalIdx.length === 0 ? (
            <EmptyState title="全球指数暂无" description="可点刷新重试；非交易时段或源限流时属正常。" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  {["指数", "市场", "点位", "涨跌%"].map((h) => (
                    <th key={h} className={h === "点位" || h === "涨跌%" ? "num" : ""}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {globalIdx.map((g) => (
                  <tr key={g.key}>
                    <td className="font-medium">{g.name}</td>
                    <td className="text-muted-foreground">{g.region}</td>
                    <td className={cn("num font-mono font-semibold", g.change_pct == null ? "text-foreground" : pctColor(g.change_pct))}>
                      {g.price ?? "—"}
                    </td>
                    <td className="num"><PctChip pct={g.change_pct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {idxPanel === "watch" && (
          watchCodes.length === 0 ? (
            <EmptyState
              title="还没有自选股"
              description="到「K线」页添加代码后，这里会显示分时。"
              action={
                <Link
                  to="/a-share?tab=kline"
                  className="btn-press mt-1 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary ring-1 ring-primary/20 hover:bg-primary/25"
                >
                  去 K 线加自选
                </Link>
              }
            />
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {watchCodes.slice(0, WATCH_MINUTE_MAX).map((c) => {
                  const q = watchQuotes[c];
                  const kl = watchMinute[c];
                  const pct = q?.change_pct ?? 0;
                  const closes = (kl?.bars || []).map((b) => b.close).filter((n) => Number.isFinite(n));
                  return (
                    <Link
                      key={c}
                      to={`/a-share?tab=kline&code=${c}`}
                      className="block rounded-xl border border-border/40 bg-card/40 px-2.5 py-2 transition-colors hover:border-primary/35 hover:bg-primary/5"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-semibold">
                          <span className="font-mono tabular-nums">{c}</span>
                          {q?.name ? <span className="ml-1 font-normal text-muted-foreground">{q.name}</span> : null}
                        </span>
                        <PctChip pct={q?.change_pct} />
                      </div>
                      <p className={cn("mt-0.5 font-mono text-sm font-bold tabular-nums", pctColor(pct))}>
                        {q?.price != null ? fmt(q.price) : "—"}
                      </p>
                      <div className="mt-1">
                        {!watchDone && !kl ? (
                          <div className="flex h-9 items-center justify-center text-[10px] text-muted-foreground/50">分时加载中…</div>
                        ) : closes.length < 2 ? (
                          <div className="flex h-9 items-center justify-center text-[10px] text-muted-foreground/50">
                            {session.kind !== "open" ? "非交易时段暂无分时" : "暂无分时"}
                          </div>
                        ) : (
                          <MinuteSpark closes={closes} prevClose={kl?.prev_close ?? q?.last_close} pct={pct} />
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
              {watchCodes.length > WATCH_MINUTE_MAX && (
                <p className="mt-2 text-center text-[10px] text-muted-foreground/55">
                  自选较多，分时仅展示前 {WATCH_MINUTE_MAX} 只 · 共 {watchCodes.length} 只
                </p>
              )}
            </>
          )
        )}
      </div>
    </GlassCard>
  );
}
