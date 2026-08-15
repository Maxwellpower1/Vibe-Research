import { Link } from "react-router-dom";
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
  /** indices = 国内/全球; watch = 自选分时; full = 三者切换 */
  variant?: "full" | "indices" | "watch";
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
  variant = "full",
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
  const showChips = variant === "full" || variant === "indices";
  const panel = variant === "watch" ? "watch" : idxPanel === "watch" && variant === "indices" ? "cn" : idxPanel;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showChips && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/40 px-2 py-1">
          <ChipGroup>
            {(variant === "indices"
              ? ([["cn", "国内"], ["global", "全球"]] as const)
              : ([
                  ["cn", "国内"],
                  ["global", "全球"],
                  ["watch", `自选${watchCodes.length ? ` ${watchCodes.length}` : ""}`],
                ] as const)
            ).map(([k, label]) => (
              <Chip key={k} active={panel === k} onClick={() => onIdxPanel(k)}>{label}</Chip>
            ))}
          </ChipGroup>
          <p className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">{updatedLabel}</p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {panel === "cn" && (
          indices.length === 0 ? (
            idxErr ? (
              <EmptyState title="A股指数未接通" description="可点顶部刷新重试；非交易时段或源限流时属正常。" />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground/65">加载中…</p>
            )
          ) : (
            <div className="space-y-0.5">
              {indices.map((ix) => {
                const sym = ix.symbol || "";
                const kl = sym ? idxMinute[sym] : null;
                const closes = (kl?.bars || []).map((b) => b.close).filter((n) => Number.isFinite(n));
                return (
                  <div key={sym || ix.name} className="grid grid-cols-[4.5rem_1fr_4.25rem_3.25rem] items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-800/40">
                    <span className="truncate text-[11px] font-semibold text-slate-200">{ix.name}</span>
                    <div className="min-w-0">
                      {!idxMinuteDone && !kl ? (
                        <div className="h-7 text-[10px] leading-7 text-slate-600">分时…</div>
                      ) : closes.length < 2 ? (
                        <div className="h-7 text-[10px] leading-7 text-slate-600">
                          {sym.startsWith("hk") ? "暂无分时" : session.kind !== "open" ? "非交易时段" : "暂无分时"}
                        </div>
                      ) : (
                        <MinuteSpark closes={closes} prevClose={kl?.prev_close} pct={ix.change_pct} />
                      )}
                    </div>
                    <span className={cn("text-right font-mono text-[12px] font-bold tabular-nums", pctColor(ix.change_pct))}>
                      {fmt(ix.price)}
                    </span>
                    <span className="text-right"><PctChip pct={ix.change_pct} /></span>
                  </div>
                );
              })}
            </div>
          )
        )}

        {panel === "global" && (
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

        {panel === "watch" && (
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
              <div className="space-y-0.5">
                {watchCodes.slice(0, WATCH_MINUTE_MAX).map((c) => {
                  const q = watchQuotes[c];
                  const kl = watchMinute[c];
                  const pct = q?.change_pct ?? 0;
                  const closes = (kl?.bars || []).map((b) => b.close).filter((n) => Number.isFinite(n));
                  return (
                    <Link
                      key={c}
                      to={`/a-share?tab=kline&code=${c}`}
                      className="grid grid-cols-[5.5rem_1fr_4.25rem_3.25rem] items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-800/40"
                    >
                      <span className="min-w-0 truncate text-[11px] font-semibold text-slate-200">
                        {q?.name || c}
                      </span>
                      <div className="min-w-0">
                        {!watchDone && !kl ? (
                          <div className="h-7 text-[10px] leading-7 text-slate-600">分时…</div>
                        ) : closes.length < 2 ? (
                          <div className="h-7 text-[10px] leading-7 text-slate-600">
                            {session.kind !== "open" ? "非交易时段" : "暂无分时"}
                          </div>
                        ) : (
                          <MinuteSpark closes={closes} prevClose={kl?.prev_close ?? q?.last_close} pct={pct} />
                        )}
                      </div>
                      <span className={cn("text-right font-mono text-[12px] font-bold tabular-nums", pctColor(pct))}>
                        {q?.price != null ? fmt(q.price) : "—"}
                      </span>
                      <span className="text-right"><PctChip pct={q?.change_pct} /></span>
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
    </div>
  );
}
