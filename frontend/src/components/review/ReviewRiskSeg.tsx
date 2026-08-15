import { useState } from "react";
import { Link } from "react-router-dom";
import { ChipGroup, Chip } from "@/components/ui/SectionHeader";
import { PctChip } from "@/components/review/PctChip";
import { reviewPending } from "@/components/review/reviewPending";
import type { AnomalyPool, LimitPool, MonitorPool, ThsLimitUpPool } from "@/lib/api";

type RiskTab = "limit" | "monitor" | "anomaly";

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
  const [tab, setTab] = useState<RiskTab>("limit");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-1 py-1">
        <ChipGroup>
          {([
            ["limit", "涨跌停"],
            ["monitor", "监控"],
            ["anomaly", "异动"],
          ] as const).map(([k, label]) => (
            <Chip key={k} active={tab === k} onClick={() => setTab(k)}>{label}</Chip>
          ))}
        </ChipGroup>
        {tab === "limit" && (
          <ChipGroup>
            {([["zt", "涨停"], ["zb", "炸板"], ["dt", "跌停"], ["yzt", "昨涨停"], ["jm", "揭秘"]] as const).map(([k, label]) => (
              <Chip key={k} active={limitKind === k} onClick={() => onLimitKind(k)}>{label}</Chip>
            ))}
          </ChipGroup>
        )}
        <span className="ml-auto text-[10px] text-slate-500">
          {tab === "limit"
            ? (limitKind === "jm"
              ? (thsLimit?.date ? `${thsLimit.date} · ${thsLimit.total}` : (extraDone ? "暂无" : "…"))
              : (limitPool?.date ? `${limitPool.date} · ${limitPool.total}` : (extraDone ? "暂无" : "…")))
            : tab === "monitor"
              ? (monitor?.count != null ? `${monitor.count} 只` : (extraDone ? "暂无" : "…"))
              : (anomaly?.date ?? (extraDone ? "暂无" : "…"))}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "monitor" && (
          !monitor?.rows?.length ? (
            <div className="p-5">{reviewPending(extraDone)}</div>
          ) : (
            <div className="space-y-0.5 p-1">
              {monitor.rows.map((r) => (
                <Link key={r.code} to={`/a-share?tab=kline&code=${r.code}`}
                  className="flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors hover:bg-warning/10">
                  <span className="w-14 shrink-0 font-mono text-[11px] text-slate-500">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  <span className="shrink-0 rounded bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-500">{r.market}</span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-600">{r.start}~{r.end}</span>
                </Link>
              ))}
            </div>
          )
        )}

        {tab === "anomaly" && (
          !anomaly?.items?.length ? (
            <div className="p-5">{reviewPending(extraDone)}</div>
          ) : (
            <div className="space-y-0.5 p-1">
              {anomaly.items.slice(0, 30).map((r, i) => (
                <Link key={`${r.code}-${i}`} to={`/a-share?tab=kline&code=${r.code}`}
                  className="block rounded px-2 py-1 text-xs transition-colors hover:bg-warning/10">
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 font-mono text-[11px] text-slate-500">{r.code}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    <PctChip pct={r.change_pct} />
                  </div>
                  <p className="mt-0.5 truncate pl-[3.75rem] text-[10px] text-slate-500">{r.rule}</p>
                </Link>
              ))}
            </div>
          )
        )}

        {tab === "limit" && (
          limitKind === "jm" ? (
            !thsLimit?.rows?.length ? (
              <div className="p-5">{reviewPending(extraDone)}</div>
            ) : (
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
                        <Link to={`/a-share?tab=kline&code=${s.code}`} className="hover:text-cyan-300">
                          <span className="font-medium">{s.name}</span>{" "}
                          <span className="text-slate-500">{s.code}</span>
                        </Link>
                      </td>
                      <td className="num"><PctChip pct={s.pct} /></td>
                      <td className="num font-mono text-xs">{s.high_days || "—"}</td>
                      <td className="max-w-[10rem] truncate text-slate-500" title={s.reason}>{s.reason || "—"}</td>
                      <td className="text-slate-500">{s.board_type || "—"}</td>
                      <td className="num font-mono text-xs">{s.seal_rate != null ? s.seal_rate : "—"}</td>
                      <td className="num font-mono text-xs text-slate-500">{s.first_time || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : !limitPool?.rows?.length ? (
            <div className="p-5">{reviewPending(extraDone)}</div>
          ) : (
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
                      <Link to={`/a-share?tab=kline&code=${s.code}`} className="hover:text-cyan-300">
                        <span className="font-medium">{s.name}</span>{" "}
                        <span className="text-slate-500">{s.code}</span>
                      </Link>
                    </td>
                    <td className="num"><PctChip pct={s.pct} /></td>
                    <td className="num font-mono text-xs">
                      {s.limit_days != null ? `${s.limit_days}板` : s.zt_stat || (s.dt_days != null ? `${s.dt_days}跌停` : "—")}
                    </td>
                    <td className="num text-slate-500">{s.turnover ?? "—"}</td>
                    <td className="text-slate-500">{s.industry || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
