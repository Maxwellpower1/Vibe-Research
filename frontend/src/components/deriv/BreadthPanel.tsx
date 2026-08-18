import { useMemo } from "react";
import type { DerivData } from "@/hooks/useDerivData";
import { cn } from "@/lib/utils";
import { num } from "@/components/ovlab/shared";
import { CellEmpty } from "./derivShared";

const BINS = 8;

/** 广度: up/flat/down counts + IV percentile histogram, all from the same frame. */
export function BreadthPanel({ d }: { d: DerivData }) {
  const stats = useMemo(() => {
    const rows = d.rows ?? [];
    let up = 0, down = 0, flat = 0;
    const hist = new Array<number>(BINS).fill(0);
    let ivpCount = 0;
    for (const r of rows) {
      const ctn = num(r.ctn);
      if (ctn !== null) {
        if (ctn > 0.0002) up += 1;
        else if (ctn < -0.0002) down += 1;
        else flat += 1;
      }
      const ivp = num(r.atmv_percentile);
      if (ivp !== null) {
        const b = Math.max(0, Math.min(BINS - 1, Math.floor(ivp / (100 / BINS))));
        hist[b] += 1;
        ivpCount += 1;
      }
    }
    return { up, down, flat, hist, ivpCount, total: up + down + flat };
  }, [d.rows]);

  if (!d.rows) return <CellEmpty text={d.marketError ? "未取到" : "更新中…"} />;
  if (stats.total === 0) return <CellEmpty />;

  const { up, down, flat, total } = stats;
  const maxBin = Math.max(...stats.hist, 1);

  return (
    <div className="flex h-full flex-col justify-center gap-3 px-3 py-2">
      <div>
        <div className="mb-1 flex items-baseline justify-between text-[10px] text-slate-500">
          <span>涨跌分布</span>
          <span className="tabular-nums">
            <span className="text-red-400">{up}涨</span>
            <span className="mx-1 text-slate-500">{flat}平</span>
            <span className="text-emerald-400">{down}跌</span>
          </span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-800/80">
          <span className="bg-red-500/80" style={{ width: `${(up / total) * 100}%` }} />
          <span className="bg-slate-600/60" style={{ width: `${(flat / total) * 100}%` }} />
          <span className="bg-emerald-500/80" style={{ width: `${(down / total) * 100}%` }} />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between text-[10px] text-slate-500">
          <span>隐波百分位分布</span>
          <span className="tabular-nums">{stats.ivpCount}只</span>
        </div>
        <div className="flex h-12 items-end gap-1">
          {stats.hist.map((n, i) => {
            const lo = i * (100 / BINS);
            const tone = lo >= 80 ? "bg-red-500/70" : lo < 20 ? "bg-emerald-500/70" : "bg-amber-500/50";
            return (
              <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                <span className="text-[9px] tabular-nums text-slate-500">{n || ""}</span>
                <div
                  className={cn("w-full rounded-sm", tone)}
                  style={{ height: `${Math.max(4, (n / maxBin) * 32)}px` }}
                  title={`IVP ${lo}-${lo + 100 / BINS}: ${n}只`}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-slate-600">
          <span>0 便宜</span>
          <span>100 贵</span>
        </div>
      </div>
    </div>
  );
}
