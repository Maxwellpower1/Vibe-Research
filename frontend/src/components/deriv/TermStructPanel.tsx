import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { api, type OvlabFutureTs, type OvlabTermPoint } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import type { DerivData } from "@/hooks/useDerivData";
import { num } from "@/components/ovlab/shared";
import { cn } from "@/lib/utils";
import { CellEmpty } from "./derivShared";

const AXIS = "#475569";
const SPLIT = "rgba(51,65,85,0.5)";
const BAR = "rgba(245,158,11,0.78)";

type CurvePt = {
  exp: string;
  dte: number;
  fwd: number;
  fwdYd: number | null;
  oi: number | null;
};

/** 曲线有效点: 排除当日到期 (dte<1 的 forward 易失真). */
function validSurf(curve: OvlabTermPoint[] | undefined): CurvePt[] {
  return (curve ?? [])
    .filter((p) => p.dte >= 1)
    .map((p) => ({ exp: p.exp, dte: p.dte, fwd: p.fwd, fwdYd: p.fwdYd ?? null, oi: p.oi ?? null }));
}

/** OpenVlab future-ts/{prodUnd}: 按到期月的期货价 + 持仓. 对齐 /future/term-structure. */
function parseFutTs(raw: OvlabFutureTs | null): CurvePt[] {
  if (!raw) return [];
  const out: CurvePt[] = [];
  for (const [exp, blk] of Object.entries(raw)) {
    if (!blk || typeof blk !== "object") continue;
    const fwd = num(blk.future_tday);
    const dte = num(blk.days_to_expiry);
    if (fwd === null || dte === null || dte < 1) continue;
    out.push({
      exp,
      dte,
      fwd,
      fwdYd: num(blk.future_yday),
      oi: num(blk.oi_tday),
    });
  }
  return out.sort((a, b) => a.dte - b.dte);
}

function fmtOi(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(Math.round(v));
}

function isEtf(prod: string): boolean {
  return /^\d+$/.test(prod);
}

function fmtPx(v: number): string {
  if (Math.abs(v) >= 1000) return String(Math.round(v));
  if (Math.abs(v) >= 100) return v.toFixed(1).replace(/\.0$/, "");
  return v.toFixed(2);
}

function fmtChg(pct: number): string {
  if (Math.abs(pct) < 0.005) return "0%";
  const s = pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${pct > 0 ? "+" : ""}${s}%`;
}

function chgPct(p: CurvePt): number | null {
  if (p.fwdYd == null || p.fwdYd === 0) return null;
  return ((p.fwd - p.fwdYd) / p.fwdYd) * 100;
}

/** Compact month table above the curve: 现值 / 涨幅. */
function MonthTable({ pts }: { pts: CurvePt[] }) {
  if (pts.length === 0) return null;
  const th = "px-1 py-0.5 text-right font-normal text-slate-500";
  const td = "px-1 py-0.5 text-right tabular-nums";
  return (
    <div className="shrink-0 overflow-x-auto border-b border-slate-800/60 px-1 pb-0.5">
      <table className="w-full min-w-max text-[10px] leading-tight">
        <thead>
          <tr>
            <th className="sticky left-0 bg-card px-1 py-0.5 text-left font-normal text-slate-500">指标</th>
            {pts.map((p) => (
              <th key={p.exp} className={th}>{p.exp.slice(2)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sticky left-0 bg-card px-1 py-0.5 text-slate-500">现值</td>
            {pts.map((p) => (
              <td key={p.exp} className={cn(td, "text-slate-200")}>{fmtPx(p.fwd)}</td>
            ))}
          </tr>
          <tr>
            <td className="sticky left-0 bg-card px-1 py-0.5 text-slate-500">涨幅</td>
            {pts.map((p) => {
              const chg = chgPct(p);
              return (
                <td
                  key={p.exp}
                  className={cn(
                    td,
                    chg == null || Math.abs(chg) < 0.005 ? "text-slate-400"
                      : chg > 0 ? "text-red-400" : "text-emerald-400",
                  )}
                >
                  {chg == null ? "-" : fmtChg(chg)}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * 期限结构: 上部选中品种远期曲线 (今实线/昨虚线), 下部同月持仓量柱.
 * 期货持仓走 future-ts oi_tday (同 openvlab.cn/future/term-structure);
 * ETF 无此接口, 退回 surface Call+Put.
 * 品种选择只在本格内, 不跟 T 型报价联动.
 */
export function TermStructPanel({ d }: { d: DerivData }) {
  const unds = useMemo(
    // 全市场 domestic 品种 (ctamap-all), 无期权的品种上游 surface 返回空, 自动不进曲线
    () => [...new Set((d.rows ?? []).map((r) => String(r.prodUnd ?? "").trim()).filter(Boolean))],
    [d.rows],
  );
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

  const withCurve = useMemo(
    () => unds.filter((u) => (data?.curves?.[u]?.length ?? 0) > 0),
    [unds, data],
  );
  const [inner, setInner] = useState<string | null>(null);
  const sel = inner && withCurve.includes(inner) ? inner : (withCurve[0] ?? null);
  const surfCurve = useMemo(() => validSurf(sel ? data?.curves?.[sel] : undefined), [data, sel]);

  const tsPoll = usePolling(
    () => api.ovlabFutureTs(sel ?? "").then((months) => ({ prod: sel, months })),
    60_000,
    [sel],
    Boolean(sel) && !isEtf(sel ?? ""),
  );
  const futCurve = useMemo(() => {
    if (!sel || tsPoll.data?.prod !== sel) return [];
    return parseFutTs(tsPoll.data.months);
  }, [sel, tsPoll.data]);

  const selCurve = futCurve.length > 0 ? futCurve : surfCurve;
  const oiVals = useMemo(() => selCurve.map((p) => p.oi), [selCurve]);

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
    if (!ec) return;
    if (!sel || selCurve.length === 0) {
      ec.clear();
      return;
    }
    const xs = selCurve.map((p) => p.exp.slice(2));
    ec.setOption(
      {
        animation: false,
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        grid: [
          { left: 44, right: 10, top: 8, height: "52%" },
          { left: 44, right: 10, top: "68%", height: "24%" },
        ],
        tooltip: {
          trigger: "axis",
          backgroundColor: "rgba(15,23,42,0.95)",
          borderColor: "#334155",
          textStyle: { color: "#e2e8f0", fontSize: 10 },
          formatter: (ps: unknown) => {
            const arr = ps as Array<{ dataIndex: number; seriesName: string; value: number | null }>;
            const idx = arr[0]?.dataIndex ?? 0;
            const p = selCurve[idx];
            if (!p) return "";
            const rows = arr
              .filter((a) => a.seriesName !== "持仓" && a.value != null)
              .map((a) => `${a.seriesName} ${a.value}`)
              .join("<br/>");
            return `${p.exp} (${p.dte}天)<br/>${rows}<br/>持仓 ${fmtOi(oiVals[idx])}`;
          },
        },
        xAxis: [
          {
            type: "category",
            data: xs,
            axisLine: { lineStyle: { color: SPLIT } },
            axisLabel: { show: false },
            axisTick: { show: false },
          },
          {
            type: "category",
            gridIndex: 1,
            data: xs,
            axisLine: { lineStyle: { color: SPLIT } },
            axisLabel: { color: AXIS, fontSize: 9 },
            axisTick: { show: false },
          },
        ],
        yAxis: [
          {
            type: "value",
            scale: true,
            axisLine: { show: false },
            axisLabel: { color: AXIS, fontSize: 9 },
            splitLine: { lineStyle: { color: SPLIT } },
          },
          {
            type: "value",
            gridIndex: 1,
            min: 0,
            axisLine: { show: false },
            axisLabel: {
              color: AXIS,
              fontSize: 9,
              formatter: (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(0)}万` : String(Math.round(v))),
            },
            splitLine: { lineStyle: { color: SPLIT } },
            splitNumber: 2,
          },
        ],
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
          {
            name: "持仓",
            type: "bar",
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: oiVals,
            itemStyle: { color: BAR },
            barMaxWidth: 18,
          },
        ],
      },
      { notMerge: true },
    );
  }, [sel, selCurve, oiVals]);

  const loading = !data;
  const empty = !!data && withCurve.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1 text-[11px]">
        <select
          value={sel ?? ""}
          onChange={(e) => setInner(e.target.value)}
          className="h-5 max-w-[7rem] rounded border border-slate-700/60 bg-slate-900 px-1 text-[10px] text-slate-200 outline-none"
          title="品种"
        >
          {withCurve.map((u) => (
            <option key={u} value={u}>{labelOf(u)} {u}</option>
          ))}
        </select>
        <span className="ml-auto text-[10px] text-slate-600">实=今 虚=昨 柱=持仓</span>
      </div>
      {selCurve.length > 0 && <MonthTable pts={selCurve} />}
      <div className="relative min-h-0 flex-1">
        <div ref={chartRef} className="absolute inset-0" />
        {(loading || empty || selCurve.length === 0) && (
          <div className="absolute inset-0">
            <CellEmpty text={loading ? "更新中…" : "未取到"} />
          </div>
        )}
      </div>
    </div>
  );
}
