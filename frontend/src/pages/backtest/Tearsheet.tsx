import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { cn } from "@/lib/utils";
import type { BacktestResult } from "@/lib/api";
import { GlassCard } from "@/components/ui/GlassCard";

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function fmtPct(v: number | null | undefined, digits = 1) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function cellText(v: number) {
  const n = v * 100;
  const body = Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1);
  return n > 0 ? `+${body}` : body;
}

function heatStyle(v: number | undefined, maxAbs: number): { background: string; color: string } {
  if (v == null) return { background: "transparent", color: "#475569" };
  if (v === 0 || maxAbs <= 0) return { background: "rgba(51,65,85,0.45)", color: "#94a3b8" };
  const t = Math.min(1, Math.abs(v) / maxAbs);
  const a = 0.14 + t * 0.5;
  if (v > 0) return { background: `rgba(248,113,113,${a})`, color: t > 0.55 ? "#fecaca" : "#fca5a5" };
  return { background: `rgba(52,211,153,${a})`, color: t > 0.55 ? "#a7f3d0" : "#6ee7b7" };
}

function tone(v: number | null | undefined) {
  if (v == null || Number.isNaN(v) || v === 0) return "text-slate-300";
  return v > 0 ? "text-red-400" : "text-emerald-400";
}

function DrawdownChart({
  curve,
  troughs,
}: {
  curve: { date: string; drawdown: number }[];
  troughs: { trough: string; depth: number }[];
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const inst = echarts.init(el, undefined, { renderer: "canvas" });
    instRef.current = inst;
    const onResize = () => inst.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      inst.dispose();
      instRef.current = null;
    };
  }, []);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst || !curve.length) return;
    const dates = curve.map((p) => p.date);
    const vals = curve.map((p) => p.drawdown * 100);
    inst.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        backgroundColor: "#0f172a",
        borderColor: "#334155",
        textStyle: { color: "#e2e8f0", fontSize: 11 },
        valueFormatter: (v: unknown) => (typeof v === "number" ? `${v.toFixed(2)}%` : ""),
      },
      grid: { left: 44, right: 12, top: 16, bottom: 24 },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { color: "#64748b", fontSize: 10 },
        axisLine: { lineStyle: { color: "#334155" } },
      },
      yAxis: {
        type: "value",
        max: 0,
        splitLine: { lineStyle: { color: "#1e293b" } },
        axisLabel: { color: "#64748b", fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` },
      },
      series: [{
        name: "回撤",
        type: "line",
        data: vals,
        showSymbol: false,
        lineStyle: { color: "#34d399", width: 1.4 },
        areaStyle: { color: "rgba(52,211,153,0.18)" },
        markPoint: troughs.length
          ? {
              symbol: "circle",
              symbolSize: 7,
              itemStyle: { color: "#6ee7b7" },
              label: { color: "#a7f3d0", fontSize: 10, formatter: "{b}" },
              data: troughs.map((d) => ({
                name: fmtPct(d.depth),
                coord: [d.trough, d.depth * 100],
              })),
            }
          : undefined,
      }],
    });
    inst.resize();
  }, [curve, troughs]);

  return <div ref={elRef} className="h-[180px] w-full" />;
}

export function Tearsheet({
  sheet,
  drawdown,
}: {
  sheet: NonNullable<BacktestResult["tearsheet"]>;
  drawdown?: { date: string; drawdown: number }[];
}) {
  const monthly = sheet.monthly;
  const years = [...new Set(monthly.map((m) => m.month.slice(0, 4)))];
  const byKey = new Map(monthly.map((m) => [m.month, m.return]));
  const yearRet = new Map((sheet.yearly || []).map((y) => [y.year, y.return]));
  const maxAbs = Math.max(...monthly.map((m) => Math.abs(m.return)), 0.01);
  const best = monthly.reduce((a, b) => (b.return > a.return ? b : a), monthly[0]);
  const worst = monthly.reduce((a, b) => (b.return < a.return ? b : a), monthly[0]);
  const up = monthly.filter((m) => m.return > 0).length;
  const dds = sheet.drawdowns.slice(0, 3);
  const deepest = dds[0];
  const curve = drawdown || [];

  return (
    <GlassCard className="space-y-3 overflow-x-auto p-3">
      <div>
        <p className="text-[11px] text-slate-400">月收益</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          最好 {best.month} <span className={tone(best.return)}>{fmtPct(best.return)}</span>
          {" · "}
          最差 {worst.month} <span className={tone(worst.return)}>{fmtPct(worst.return)}</span>
          {" · "}
          正收益 {up}/{monthly.length} 个月
        </p>
      </div>
      <div className="min-w-[560px]">
        <div
          className="grid gap-px"
          style={{ gridTemplateColumns: "40px repeat(12, minmax(0, 1fr)) 48px" }}
        >
          <div />
          {MONTHS.map((lab) => (
            <div key={lab} className="pb-1 text-center text-[10px] text-slate-500">{lab}</div>
          ))}
          <div className="pb-1 text-center text-[10px] text-slate-500">全年</div>
          {years.map((y) => {
            const yr = yearRet.get(y);
            return (
              <div key={y} className="contents">
                <div className="flex items-center text-[10px] text-slate-400">{y}</div>
                {MONTHS.map((_, i) => {
                  const key = `${y}-${String(i + 1).padStart(2, "0")}`;
                  const v = byKey.get(key);
                  const style = heatStyle(v, maxAbs);
                  return (
                    <div
                      key={key}
                      title={v == null ? `${key} 无数据` : `${key} ${fmtPct(v)}`}
                      className="flex h-8 items-center justify-center rounded-sm font-mono text-[10px] tabular-nums"
                      style={style}
                    >
                      {v == null ? "" : cellText(v)}
                    </div>
                  );
                })}
                <div className={cn("flex items-center justify-end pr-1 font-mono text-[10px] tabular-nums", tone(yr))}>
                  {yr == null ? "—" : cellText(yr)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {curve.length > 0 && (
        <div>
          <p className="text-[11px] text-slate-400">最大回撤</p>
          {deepest && (
            <p className="mt-0.5 text-[11px] text-slate-500">
              最深 <span className="text-emerald-300">{fmtPct(deepest.depth)}</span>
              {" · "}
              {deepest.trough}
              {" · "}
              {deepest.days} 个交易日
            </p>
          )}
          <DrawdownChart curve={curve} troughs={dds} />
        </div>
      )}
    </GlassCard>
  );
}
