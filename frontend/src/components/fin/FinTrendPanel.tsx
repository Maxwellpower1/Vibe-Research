import { useMemo, useState } from "react";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { useFin } from "@/components/fin/FinContext";
import { quarterLabel } from "@/components/fin/utils";
import { useElementSize } from "@/hooks/useElementSize";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";

type Tab = "perf" | "quality";

export function FinTrendPanel() {
  const { company } = useFin();
  const [tab, setTab] = useState<Tab>("perf");
  const { data, error } = usePolling(() => api.finCompany(company.code), 1800_000, [company.code]);
  const reports = [...(data?.main.reports ?? [])].reverse();
  const { ref, size } = useElementSize();

  type Chart = {
    W: number; H: number; L: number; R: number; T: number; B: number;
    xs: number[]; bw: number; Y: (v: number) => number;
    labels: string[];
    revs?: number[]; nps?: number[]; yoys?: number[]; line?: string; zero?: number; Y2?: (v: number) => number;
    lines?: Array<{ key: string; color: string; vals: number[]; pts: string }>;
  };

  const chart = useMemo((): Chart | null => {
    if (reports.length < 2 || size.w < 40 || size.h < 40) return null;
    const W = size.w;
    const H = size.h;
    const L = 36;
    const R = 36;
    const T = 8;
    const B = 18;
    const n = reports.length;
    const xs = reports.map((_, i) => L + (i + 0.5) * ((W - L - R) / n));
    const bw = Math.max(3, ((W - L - R) / n) * 0.32);
    if (tab === "perf") {
      const revs = reports.map((r) => r.revenue);
      const nps = reports.map((r) => r.net_profit);
      const yoys = reports.map((r) => r.profit_yoy);
      const maxA = Math.max(...revs, ...nps, 1);
      const minA = Math.min(...revs, ...nps, 0);
      const spanA = maxA - minA || 1;
      const Y = (v: number) => T + (1 - (v - minA) / spanA) * (H - T - B);
      const maxY = Math.max(...yoys.map(Math.abs), 10);
      const Y2 = (v: number) => T + (1 - (v + maxY) / (2 * maxY)) * (H - T - B);
      const line = yoys.map((v, i) => `${xs[i].toFixed(1)},${Y2(v).toFixed(1)}`).join(" ");
      return { W, H, L, R, T, B, xs, bw, Y, Y2, revs, nps, yoys, line, labels: reports.map((r) => quarterLabel(r.date)), zero: Y(0) };
    }
    const series = [
      { key: "roe", color: "#22d3ee", vals: reports.map((r) => r.roe) },
      { key: "gross", color: "#fbbf24", vals: reports.map((r) => r.gross_margin) },
      { key: "net", color: "#fb7185", vals: reports.map((r) => r.net_margin) },
    ];
    const all = series.flatMap((s) => s.vals);
    const min = Math.min(...all, 0);
    const max = Math.max(...all, 1);
    const Y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
    return {
      W, H, L, R, T, B, xs, bw, Y,
      lines: series.map((s) => ({
        ...s,
        pts: s.vals.map((v, i) => `${xs[i].toFixed(1)},${Y(v).toFixed(1)}`).join(" "),
      })),
      labels: reports.map((r) => quarterLabel(r.date)),
    };
  }, [reports, size, tab]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-700/40 px-1.5 py-1">
        <span className="truncate text-[10px] text-cyan-300">{data?.main.name || company.name}</span>
        <ChipGroup>
          <Chip active={tab === "perf"} onClick={() => setTab("perf")}>业绩</Chip>
          <Chip active={tab === "quality"} onClick={() => setTab("quality")}>质量</Chip>
        </ChipGroup>
      </div>
      <div ref={ref} className="min-h-0 flex-1">
        {!data && <p className="py-8 text-center text-[11px] text-slate-600">{error ? "趋势未接通" : "加载中…"}</p>}
        {data && reports.length < 2 && (
          <p className="py-8 text-center text-[11px] text-slate-600">暂无足够报告期</p>
        )}
        {(() => {
          if (!chart || tab !== "perf" || !chart.revs || !chart.nps || chart.zero == null) return null;
          const zero = chart.zero;
          const revs = chart.revs;
          const nps = chart.nps;
          return (
          <svg width="100%" height="100%" viewBox={`0 0 ${chart.W} ${chart.H}`} preserveAspectRatio="none">
            <line x1={chart.L} y1={zero} x2={chart.W - chart.R} y2={zero} stroke="#334155" strokeWidth={1} />
            {revs.map((v, i) => (
              <rect key={`r${i}`} x={chart.xs[i] - chart.bw} y={Math.min(chart.Y(v), zero)} width={chart.bw} height={Math.abs(chart.Y(v) - zero)} fill="#38bdf8" opacity={0.45} />
            ))}
            {nps.map((v, i) => (
              <rect key={`n${i}`} x={chart.xs[i]} y={Math.min(chart.Y(v), zero)} width={chart.bw * 0.7} height={Math.abs(chart.Y(v) - zero)} fill="#fbbf24" opacity={0.8} />
            ))}
            {chart.line && <polyline points={chart.line} fill="none" stroke="#fb7185" strokeWidth={1.3} />}
            {chart.labels.map((lb, i) => (
              i % 2 === 0 ? <text key={lb + i} x={chart.xs[i]} y={chart.H - 4} fontSize={8} fill="#64748b" textAnchor="middle">{lb}</text> : null
            ))}
          </svg>
          );
        })()}
        {chart && tab === "quality" && chart.lines && (
          <svg width="100%" height="100%" viewBox={`0 0 ${chart.W} ${chart.H}`} preserveAspectRatio="none">
            {chart.lines.map((s) => (
              <polyline key={s.key} points={s.pts} fill="none" stroke={s.color} strokeWidth={1.3} strokeDasharray={s.key === "net" ? "3 2" : undefined} />
            ))}
            {chart.labels.map((lb, i) => (
              i % 2 === 0 ? <text key={lb + i} x={chart.xs[i]} y={chart.H - 4} fontSize={8} fill="#64748b" textAnchor="middle">{lb}</text> : null
            ))}
          </svg>
        )}
      </div>
      <p className="shrink-0 px-1.5 pb-1 text-[9px] text-slate-600">
        {tab === "perf" ? "青柱营收 · 黄柱净利 · 红线净利同比" : "青 ROE · 黄毛利率 · 红虚线净利率"}
      </p>
    </div>
  );
}
