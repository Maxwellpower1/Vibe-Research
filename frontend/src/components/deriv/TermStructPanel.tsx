import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { api, type OvlabTermPoint } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import type { DerivData } from "@/hooks/useDerivData";
import { cn } from "@/lib/utils";
import { CellEmpty } from "./derivShared";

interface Slope {
  und: string;
  label: string;
  near: OvlabTermPoint;
  far: OvlabTermPoint;
  /** (far - near) / near in %; positive = contango. */
  pct: number;
}

const AXIS = "#475569";
const SPLIT = "rgba(51,65,85,0.5)";

/** 曲线有效点: 排除当日到期 (dte<1 的 forward 易失真). */
function validCurve(curve: OvlabTermPoint[] | undefined): OvlabTermPoint[] {
  return (curve ?? []).filter((p) => p.dte >= 1);
}

function slopeOf(und: string, label: string, curve: OvlabTermPoint[]): Slope | null {
  if (curve.length < 2) return null;
  const near = curve[0];
  const far = curve[curve.length - 1];
  if (!near.fwd) return null;
  return { und, label, near, far, pct: ((far.fwd - near.fwd) / near.fwd) * 100 };
}

/**
 * 期限结构: 上部选中品种远期曲线 (今实线/昨虚线, x=到期月), 下部跨品种近远月斜率排行.
 * 数据源 volatility-surface forward (future-ts-all 上游只覆盖 6 个品种, 弃用).
 * product/onPickProduct 与 T 型报价联动.
 */
export function TermStructPanel({
  d,
  product,
  onPickProduct,
}: {
  d: DerivData;
  product?: string;
  onPickProduct?: (und: string) => void;
}) {
  const unds = useMemo(() => {
    const list = d.catalogRows.filter((c) => c.def.group === "commodity").map((c) => c.def.und);
    if (product && !list.includes(product)) list.push(product); // 联动品种并入 (如多晶硅 PS)
    return list;
  }, [d.catalogRows, product]);
  const undsKey = unds.join(",");
  const { data } = usePolling(
    () => api.ovlabTermStructure(undsKey.split(",")),
    60_000,
    [undsKey],
  );

  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of d.catalogRows) m.set(c.def.und, c.def.label);
    for (const r of d.rows ?? []) {
      const und = String(r.prodUnd ?? "");
      if (und && !m.has(und)) m.set(und, String(r.product_alias ?? und));
    }
    return (und: string) => m.get(und) ?? und;
  }, [d.catalogRows, d.rows]);

  const slopes = useMemo<Slope[]>(() => {
    const curves = data?.curves ?? {};
    const out: Slope[] = [];
    for (const und of Object.keys(curves)) {
      const s = slopeOf(und, labelOf(und), validCurve(curves[und]));
      if (s) out.push(s);
    }
    return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  }, [data, labelOf]);

  const [inner, setInner] = useState<string | null>(null);
  const sel = (product && data?.curves?.[product] ? product : null) ?? inner ?? slopes[0]?.und ?? null;
  const selCurve = useMemo(() => validCurve(sel ? data?.curves?.[sel] : undefined), [data, sel]);
  const selSlope = slopes.find((s) => s.und === sel) ?? null;

  const chartRef = useRef<HTMLDivElement | null>(null);
  const ecRef = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ec = echarts.init(el);
    ecRef.current = ec;
    const ro = new ResizeObserver(() => ec.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      ec.dispose();
      ecRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ec = ecRef.current;
    if (!ec || !sel) return;
    const xs = selCurve.map((p) => p.exp.slice(2));
    ec.setOption(
      {
        animation: false,
        grid: { left: 44, right: 10, top: 8, bottom: 18 },
        tooltip: {
          trigger: "axis",
          backgroundColor: "rgba(15,23,42,0.95)",
          borderColor: "#334155",
          textStyle: { color: "#e2e8f0", fontSize: 10 },
          formatter: (ps: unknown) => {
            const arr = ps as Array<{ dataIndex: number; seriesName: string; value: number | null }>;
            const p = selCurve[arr[0]?.dataIndex ?? 0];
            if (!p) return "";
            const rows = arr
              .filter((a) => a.value != null)
              .map((a) => `${a.seriesName} ${a.value}`)
              .join("<br/>");
            return `${p.exp} (${p.dte}天)<br/>${rows}`;
          },
        },
        xAxis: {
          type: "category",
          data: xs,
          axisLine: { lineStyle: { color: SPLIT } },
          axisLabel: { color: AXIS, fontSize: 9 },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          scale: true,
          axisLine: { show: false },
          axisLabel: { color: AXIS, fontSize: 9 },
          splitLine: { lineStyle: { color: SPLIT } },
        },
        series: [
          {
            name: "今日",
            type: "line",
            data: selCurve.map((p) => p.fwd),
            symbol: "circle",
            symbolSize: 4,
            lineStyle: { color: "#22d3ee", width: 1.5 },
            itemStyle: { color: "#22d3ee" },
          },
          {
            name: "昨日",
            type: "line",
            data: selCurve.map((p) => p.fwdYd),
            symbol: "circle",
            symbolSize: 3,
            lineStyle: { color: "#64748b", width: 1, type: "dashed" },
            itemStyle: { color: "#64748b" },
            connectNulls: true,
          },
        ],
      },
      { notMerge: true },
    );
  }, [sel, selCurve]);

  if (data && slopes.length === 0) return <CellEmpty />;
  if (!data) return <CellEmpty text="更新中…" />;

  const maxAbs = Math.max(...slopes.map((s) => Math.abs(s.pct)), 0.01);

  return (
    <div className="flex h-full flex-col">
      {/* 选中品种曲线头 */}
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1 text-[11px]">
        <span className="font-medium text-slate-200">{sel ? labelOf(sel) : "--"}</span>
        {selSlope && (
          <>
            <span className={cn("tabular-nums", selSlope.pct >= 0 ? "text-red-400" : "text-emerald-400")}>
              {selSlope.pct > 0 ? "+" : ""}{selSlope.pct.toFixed(2)}%
            </span>
            <span className="text-[10px] text-slate-500">
              {selSlope.near.exp.slice(2)}→{selSlope.far.exp.slice(2)}
            </span>
          </>
        )}
        <span className="ml-auto text-[10px] text-slate-600">实=今 虚=昨</span>
      </div>
      {/* 远期曲线 */}
      <div ref={chartRef} className="min-h-0 flex-1" />
      {/* 斜率排行 */}
      <div className="max-h-[42%] shrink-0 overflow-auto border-t border-slate-800/60 px-1 py-1">
        {slopes.map((s) => (
          <div
            key={s.und}
            onClick={() => {
              setInner(s.und);
              onPickProduct?.(s.und);
            }}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-1.5 py-[2px] hover:bg-slate-800/40",
              s.und === sel && "bg-slate-800/50",
            )}
            title={`${s.near.exp}(${s.near.dte}天) ${s.near.fwd} / ${s.far.exp}(${s.far.dte}天) ${s.far.fwd}`}
          >
            <span className="w-[3.2rem] shrink-0 truncate text-[11px] text-slate-300">{s.label}</span>
            <span className="relative h-2 min-w-0 flex-1">
              <span className="absolute inset-y-0 left-1/2 w-px bg-slate-700" />
              <span
                className={cn(
                  "absolute top-0 h-full rounded-sm",
                  s.pct >= 0 ? "left-1/2 bg-red-500/70" : "right-1/2 bg-emerald-500/70",
                )}
                style={{ width: `${(Math.abs(s.pct) / maxAbs) * 50}%` }}
              />
            </span>
            <span className={cn("w-[3.4rem] shrink-0 text-right text-[10px] tabular-nums", s.pct >= 0 ? "text-red-400" : "text-emerald-400")}>
              {s.pct > 0 ? "+" : ""}{s.pct.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
