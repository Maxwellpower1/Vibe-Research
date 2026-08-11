import { Link } from "react-router-dom";
import { Flame, ShieldAlert } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionHeader, ChipGroup, Chip } from "@/components/ui/SectionHeader";
import { PctChip } from "@/components/review/PctChip";
import { reviewPending } from "@/components/review/reviewPending";
import type { AnomalyPool, LimitPool, MonitorPool, ThsLimitUpPool } from "@/lib/api";

interface Props {
  monitor: MonitorPool | null;
  anomaly: AnomalyPool | null;
  limitPool: LimitPool | null;
  thsLimit: ThsLimitUpPool | null;
  limitKind: "zt" | "zb" | "dt" | "yzt" | "jm";
  onLimitKind: (v: "zt" | "zb" | "dt" | "yzt" | "jm") => void;
  extraDone: boolean;
}

export function ReviewRiskSeg({
  monitor,
  anomaly,
  limitPool,
  thsLimit,
  limitKind,
  onLimitKind,
  extraDone,
}: Props) {
  return (
    <div className="space-y-6">
      <div>
        <SectionHeader
          icon={<ShieldAlert className="h-3.5 w-3.5 text-warning" />}
          title="重点监控池"
          hint="交易所风险警示"
          meta={monitor?.count != null ? `${monitor.count} 只` : (extraDone ? "暂无" : "加载中…")}
        />
        <GlassCard className="!p-0 overflow-hidden">
          {!monitor?.rows?.length ? (
            <div className="p-5">{reviewPending(extraDone)}</div>
          ) : (
            <div className="max-h-64 space-y-0.5 overflow-y-auto p-2">
              {monitor.rows.map((r) => (
                <Link key={r.code} to={`/a-share?tab=kline&code=${r.code}`}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-warning/10">
                  <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  <span className="shrink-0 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">{r.market}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/55">{r.start}~{r.end}</span>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      <div>
        <SectionHeader
          icon={<ShieldAlert className="h-3.5 w-3.5 text-warning" />}
          title="日内异动"
          hint="严重异常波动"
          meta={anomaly?.date ?? (extraDone ? "暂无" : "加载中…")}
        />
        <GlassCard className="!p-0 overflow-hidden">
          {!anomaly?.items?.length ? (
            <div className="p-5">{reviewPending(extraDone)}</div>
          ) : (
            <div className="max-h-64 space-y-0.5 overflow-y-auto p-2">
              {anomaly.items.slice(0, 30).map((r, i) => (
                <Link key={`${r.code}-${i}`} to={`/a-share?tab=kline&code=${r.code}`}
                  className="block rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-warning/10">
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{r.code}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    <PctChip pct={r.change_pct} />
                  </div>
                  <p className="mt-0.5 truncate pl-[3.75rem] text-[11px] text-muted-foreground/60">{r.rule}</p>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      <div>
        <SectionHeader
          icon={<Flame className="h-3.5 w-3.5 text-primary/80" />}
          title="打板池明细"
          hint="客观公开榜单 · 非推荐"
          meta={
            limitKind === "jm"
              ? (thsLimit?.date ? `${thsLimit.date} · 共 ${thsLimit.total} 只` : (extraDone ? "暂无" : "加载中…"))
              : (limitPool?.date ? `${limitPool.date} · 共 ${limitPool.total} 只` : (extraDone ? "暂无" : "加载中…"))
          }
          actions={(
            <ChipGroup>
              {([["zt", "涨停"], ["zb", "炸板"], ["dt", "跌停"], ["yzt", "昨涨停"], ["jm", "揭秘"]] as const).map(([k, label]) => (
                <Chip key={k} active={limitKind === k} onClick={() => onLimitKind(k)}>{label}</Chip>
              ))}
            </ChipGroup>
          )}
        />
        <GlassCard className="!p-0 overflow-hidden">
          {limitKind === "jm" ? (
            !thsLimit?.rows?.length ? (
              <div className="p-5">{reviewPending(extraDone)}</div>
            ) : (
              <div className="max-h-[28rem] overflow-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      {["名称", "涨跌%", "几天几板", "题材原因", "板型", "封板率%", "首次"].map((h) => (
                        <th key={h} className={h === "名称" || h === "题材原因" || h === "板型" ? "" : "num"}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {thsLimit.rows.map((s) => (
                      <tr key={`${s.code}-${s.name}`}>
                        <td>
                          <Link to={`/a-share?tab=kline&code=${s.code}`} className="hover:text-primary">
                            <span className="font-medium">{s.name}</span>{" "}
                            <span className="text-muted-foreground/50">{s.code}</span>
                          </Link>
                        </td>
                        <td className="num"><PctChip pct={s.pct} /></td>
                        <td className="num font-mono text-xs">{s.high_days || "—"}</td>
                        <td className="max-w-[10rem] truncate text-muted-foreground" title={s.reason}>{s.reason || "—"}</td>
                        <td className="text-muted-foreground">{s.board_type || "—"}</td>
                        <td className="num font-mono text-xs">{s.seal_rate != null ? s.seal_rate : "—"}</td>
                        <td className="num font-mono text-xs text-muted-foreground">{s.first_time || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : !limitPool?.rows?.length ? (
            <div className="p-5">{reviewPending(extraDone)}</div>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {["名称", "涨跌%", "连板/统计", "换手%", "行业"].map((h) => (
                      <th key={h} className={h !== "名称" && h !== "行业" ? "num" : ""}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {limitPool.rows.map((s) => (
                    <tr key={`${s.code}-${s.name}`}>
                      <td>
                        <Link to={`/a-share?tab=kline&code=${s.code}`} className="hover:text-primary">
                          <span className="font-medium">{s.name}</span>{" "}
                          <span className="text-muted-foreground/50">{s.code}</span>
                        </Link>
                      </td>
                      <td className="num"><PctChip pct={s.pct} /></td>
                      <td className="num font-mono text-xs">
                        {s.limit_days != null ? `${s.limit_days}板` : s.zt_stat || (s.dt_days != null ? `${s.dt_days}跌停` : "—")}
                      </td>
                      <td className="num text-muted-foreground">{s.turnover ?? "—"}</td>
                      <td className="text-muted-foreground">{s.industry || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
