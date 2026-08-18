import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { num } from "@/components/ovlab/shared";
import { cn } from "@/lib/utils";
import {
  derivMinuteSlots, hmOf, kindOfUnd, lastFiniteIdx, minuteKey, padToSlots, tradingDayOf,
} from "@/lib/derivMinuteAxis";
import type { OptionPick } from "./TQuotePanel";

const UP = "#ef4444";
const DN = "#22c55e";
const IV_COLOR = "#a78bfa";

/** Narrow glance card: hide Y ticks, keep the shape. */
const GLANCE_GRID = [
  { left: 6, right: 6, top: 4, height: "66%" },
  { left: 6, right: 6, top: "78%", height: "14%" },
];

interface MinBar { t: string; close: number; vol: number }

/** 分钟 bar 数组 -> {t, close, vol}; bar: [time, close, pct, vol, open, high, low, ?]. */
function parseMinute(raw: unknown): MinBar[] {
  if (!Array.isArray(raw)) return [];
  const out: MinBar[] = [];
  for (const b of raw) {
    if (!Array.isArray(b) || b.length < 2) continue;
    const close = num(b[1]);
    if (close === null) continue;
    out.push({ t: String(b[0]), close, vol: num(b[3]) ?? 0 });
  }
  return out;
}

/** 分钟 pct 字段反推昨结: 取该交易日第一根 bar, close / (1 + pct/100). */
function preCloseOf(raw: unknown, td: string): number | null {
  if (!Array.isArray(raw)) return null;
  for (const b of raw) {
    if (!Array.isArray(b) || b.length < 3) continue;
    if (tradingDayOf(String(b[0])) !== td) continue;
    const close = num(b[1]);
    const pct = typeof b[2] === "string" ? parseFloat(b[2].replace("%", "")) : num(b[2]);
    if (close !== null && pct !== null && Number.isFinite(pct) && 1 + pct / 100 !== 0) {
      return close / (1 + pct / 100);
    }
    return null;
  }
  return null;
}

/** Align [[time, v], ...] onto categories. loose also matches YYYY-MM-DD HH:MM / HH:MM. */
function alignSeries(
  pairs: Array<[string, number | null]> | undefined,
  cats: string[],
  loose = false,
): Array<number | null> {
  const exact = new Map<string, number | null>();
  const keys = new Map<string, number | null>();
  for (const [t, v] of pairs ?? []) {
    exact.set(t, v);
    if (loose) {
      keys.set(minuteKey(t), v);
      const hm = hmOf(t);
      if (hm) keys.set(hm, v);
    }
  }
  return cats.map((c) => exact.get(c) ?? (loose ? (keys.get(minuteKey(c)) ?? keys.get(hmOf(c)) ?? null) : null));
}

/** Overlay axis: keep a quiet series from filling the pane (IV wiggle ~occupy of height). */
export function overlayAxis(
  vals: Array<number | null | undefined>,
  occupy = 0.32,
): { min: number; max: number } | null {
  const xs: number[] = [];
  for (const v of vals) {
    if (v != null && Number.isFinite(v) && v > 0) xs.push(v);
  }
  if (xs.length === 0) return null;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, Math.abs(mid) * 0.015, 0.4);
  const frac = Math.min(0.85, Math.max(0.1, occupy));
  const pad = half / frac - half;
  return { min: mid - half - pad, max: mid + half + pad };
}

/** echarts updateAxisPointer -> 类目下标. 类目轴 value 是字符串, 不能当 number 用. */
export function hoverIdxOf(raw: unknown, cats: string[]): number | null {
  const p = raw as {
    currTrigger?: string;
    axesInfo?: Array<{ axisDim?: string; value?: unknown; seriesDataIndices?: Array<{ dataIndex?: number }> }>;
  };
  if (p?.currTrigger === "leave") return null;
  const xAxis = (p.axesInfo ?? []).find((a) => a.axisDim === "x") ?? p.axesInfo?.[0];
  const fromSeries = xAxis?.seriesDataIndices?.find((s) => Number.isInteger(s?.dataIndex));
  if (fromSeries && Number.isInteger(fromSeries.dataIndex)) return fromSeries.dataIndex as number;
  const val = xAxis?.value;
  if (typeof val === "number" && val >= 0 && val < cats.length) return Math.round(val);
  if (val != null) {
    const s = String(val);
    const i = cats.findIndex((c) => c === s || c.slice(11, 16) === s || c.slice(5) === s);
    if (i >= 0) return i;
  }
  return null;
}

function useChart() {
  const ref = useRef<HTMLDivElement | null>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    inst.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); inst.current = null; };
  }, []);
  return { ref, inst };
}

function axisColors() {
  const cssHsl = (name: string, fallback: string) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return raw ? `hsl(${raw})` : fallback;
  };
  return {
    cText: cssHsl("--chart-text", "#94a3b8"),
    cAxis: cssHsl("--chart-axis", "#475569"),
    cGrid: cssHsl("--chart-grid", "#334155"),
  };
}

function fmtPx(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
}

export { tradingDayOf } from "@/lib/derivMinuteAxis";

/** 期权联动图卡: mode=daily 日K(分钟聚合+量+标的IV日线) / minute 分时(价线+量+合约IV分钟). */
export function OptionChartCard({ pick, mode }: { pick: OptionPick | null; mode: "daily" | "minute" }) {
  const { ref, inst } = useChart();
  const [hover, setHover] = useState<number | null>(null);
  const catsRef = useRef<string[]>([]);

  const daily = usePolling(
    () => (pick && mode === "daily" ? api.ovlabOptionDaily(pick.code, pick.und) : Promise.resolve(null)),
    300_000,
    [pick?.code, pick?.und, mode],
    Boolean(pick && mode === "daily"),
  );
  const minute = usePolling(
    () => {
      if (!pick || mode !== "minute") return Promise.resolve(null);
      const code = pick.code;
      const now = Math.floor(Date.now() / 1000);
      const from = now - 80 * 3600;
      return Promise.all([
        api.ovlabKlineHistory(code, "1", from, now),
        api.ovlabAtmvolHistory(code, "1", from, now).catch(() => null),
      ]).then(([kl, av]) => ({ code, kl, av }));
    },
    60_000,
    [pick?.code, mode],
    Boolean(pick && mode === "minute"),
  );

  const minData = useMemo(() => {
    if (mode !== "minute" || !minute.data || minute.data.code !== pick?.code) return null;
    const { kl, av } = minute.data;
    const all = parseMinute(kl?.data);
    const empty = {
      bars: [] as MinBar[],
      cats: [] as string[],
      prices: [] as Array<number | null>,
      vols: [] as Array<number | null>,
      iv: [] as Array<number | null>,
      pre: null as number | null,
    };
    if (all.length === 0) return empty;
    const lastTd = tradingDayOf(all[all.length - 1].t);
    const bars = all.filter((b) => tradingDayOf(b.t) === lastTd);
    const kind = kindOfUnd(pick?.und, bars.map((b) => b.t));
    const cats = derivMinuteSlots(lastTd, kind);
    const padded = padToSlots(bars, cats, (b) => b.t);
    const prices = padded.map((b) => b?.close ?? null);
    const vols = padded.map((b) => b?.vol ?? null);
    const ivPairs = (av?.data ?? []) as Array<[string, number | null]>;
    const iv = alignSeries(ivPairs, cats, true);
    return { bars, cats, prices, vols, iv, pre: preCloseOf(kl?.data, lastTd) };
  }, [minute.data, mode, pick?.code, pick?.und]);

  const dailyStale = Boolean(daily.data?.code && daily.data.code !== pick?.code);
  const dailyMatch = mode === "daily" && daily.data && daily.data.code === pick?.code ? daily.data : null;
  const dailyBars = useMemo(() => dailyMatch?.bars ?? [], [dailyMatch]);
  const dailyIv = useMemo(
    () => alignSeries(dailyMatch?.iv, dailyBars.map((b) => b.t)),
    [dailyMatch, dailyBars],
  );

  const minStale = Boolean(minute.data && minute.data.code !== pick?.code);
  const loading = mode === "daily"
    ? (!dailyMatch && !daily.error && (daily.data === null || dailyStale))
    : (minData === null && !minute.error && (minute.data === null || minStale));
  const err = mode === "daily" ? daily.error : minute.error;
  const empty = Boolean(pick && !loading && !err && (
    mode === "daily" ? dailyBars.length === 0 : (minData?.bars.length ?? 0) === 0
  ));

  useEffect(() => { setHover(null); }, [pick?.code, mode]);

  catsRef.current = mode === "daily" ? dailyBars.map((b) => b.t) : (minData?.cats ?? []);

  useEffect(() => {
    const chart = inst.current;
    if (!chart) return;
    if (!pick) { chart.clear(); return; }
    const { cText, cAxis, cGrid } = axisColors();

    if (mode === "daily") {
      if (dailyBars.length === 0) { chart.clear(); return; }
      const cats = dailyBars.map((b) => b.t);
      const volData = dailyBars.map((b) => ({
        value: b.vol,
        itemStyle: { color: b.close >= b.open ? UP : DN },
      }));
      chart.setOption({
        backgroundColor: "transparent",
        animation: false,
        tooltip: {
          trigger: "axis",
          showContent: false,
          axisPointer: { type: "cross", crossStyle: { color: cAxis, width: 1, type: "dashed" }, label: { show: false } },
        },
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        grid: GLANCE_GRID,
        xAxis: [
          {
            type: "category", data: cats, boundaryGap: true, scale: true,
            axisLine: { lineStyle: { color: cAxis } },
            axisLabel: { color: cText, fontSize: 8, hideOverlap: true, formatter: (v: string) => v.slice(5) },
            splitLine: { show: false },
            axisPointer: { label: { show: false } },
          },
          {
            type: "category", gridIndex: 1, data: cats, boundaryGap: true, scale: true,
            axisLabel: { show: false }, axisLine: { lineStyle: { color: cAxis } },
            splitLine: { show: false }, axisPointer: { label: { show: false } },
          },
        ],
        yAxis: [
          {
            scale: true,
            splitLine: { lineStyle: { color: cGrid, opacity: 0.25, width: 1 } },
            axisLabel: { show: false },
            axisPointer: { label: { show: false } },
          },
          {
            ...(overlayAxis(dailyIv) ?? { min: 0, max: 1 }),
            scale: false, position: "right" as const,
            splitLine: { show: false },
            axisLabel: { show: false },
            axisPointer: { label: { show: false } },
          },
          {
            scale: true, gridIndex: 1,
            min: (v: { min?: number }) => { const mn = v.min ?? 0; return mn > 0 ? Math.floor(mn * 0.9) : 0; },
            splitNumber: 1,
            axisLabel: { show: false }, splitLine: { show: false }, axisPointer: { label: { show: false } },
          },
        ],
        series: [
          {
            name: "K线", type: "candlestick" as const,
            data: dailyBars.map((b) => [b.open, b.close, b.low, b.high]),
            itemStyle: { color: UP, color0: DN, borderColor: UP, borderColor0: DN },
            emphasis: { focus: "none" as const },
          },
          {
            name: "平值隐波", type: "line" as const, yAxisIndex: 1, z: 5,
            data: dailyIv, connectNulls: true, showSymbol: false,
            lineStyle: { width: 1.2, color: IV_COLOR },
            emphasis: { focus: "none" as const },
          },
          {
            name: "成交量", type: "bar" as const, xAxisIndex: 1, yAxisIndex: 2, z: 1,
            data: volData, emphasis: { focus: "none" as const },
          },
        ],
      }, { notMerge: true });
      return;
    }

    const cats = minData?.cats ?? [];
    const prices = minData?.prices ?? [];
    const finite = prices.filter((p): p is number => p != null && Number.isFinite(p));
    if (cats.length === 0 || finite.length === 0) { chart.clear(); return; }
    const pre = minData?.pre ?? null;
    const lastPx = finite[finite.length - 1];
    const baseline = pre !== null && pre > 0 ? pre : finite[0];
    const pMin = Math.min(...finite, baseline);
    const pMax = Math.max(...finite, baseline);
    const pPad = (pMax - pMin) * 0.06 || Math.abs(baseline) * 0.002 || 1;
    const up = lastPx >= baseline;
    const tone = up ? UP : DN;
    const fade = up ? "239,68,68" : "34,197,94";
    const grad = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: `rgba(${fade},0.35)` },
      { offset: 1, color: `rgba(${fade},0.02)` },
    ]);
    const volData = (minData?.vols ?? []).map((v, i) => {
      const px = prices[i];
      return {
        value: v,
        itemStyle: { color: px != null && px >= baseline ? UP : DN },
      };
    });

    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        showContent: false,
        axisPointer: { type: "cross", crossStyle: { color: cAxis, width: 1, type: "dashed" }, label: { show: false } },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: GLANCE_GRID,
      xAxis: [
        {
          type: "category", data: cats, boundaryGap: false, scale: true,
          axisLine: { lineStyle: { color: cAxis } },
          axisLabel: { color: cText, fontSize: 8, hideOverlap: true, formatter: (v: string) => v.slice(11, 16) || v },
          splitLine: { show: false },
          axisPointer: { label: { show: false } },
        },
        {
          type: "category", gridIndex: 1, data: cats, boundaryGap: true, scale: true,
          axisLabel: { show: false }, axisLine: { lineStyle: { color: cAxis } },
          splitLine: { show: false }, axisPointer: { label: { show: false } },
        },
      ],
        yAxis: [
        {
          min: pMin - pPad, max: pMax + pPad, scale: false,
          splitLine: { lineStyle: { color: cGrid, opacity: 0.25, width: 1 } },
          axisLabel: { show: false },
          axisPointer: { label: { show: false } },
        },
        {
          ...(overlayAxis(minData?.iv ?? []) ?? { min: 0, max: 1 }),
          scale: false, position: "right" as const,
          splitLine: { show: false },
          axisLabel: { show: false },
          axisPointer: { label: { show: false } },
        },
        {
          scale: true, gridIndex: 1,
          min: 0,
          splitNumber: 1,
          axisLabel: { show: false }, splitLine: { show: false }, axisPointer: { label: { show: false } },
        },
      ],
      series: [
        {
          name: "价格", type: "line" as const, z: 3,
          data: prices, showSymbol: false, connectNulls: false,
          lineStyle: { width: 1.4, color: tone },
          areaStyle: { color: grad },
          markLine: {
            silent: true, symbol: "none", animation: false,
            lineStyle: { color: "rgba(148,163,184,0.45)", width: 1, type: "dashed" },
            label: { show: false },
            data: [{ yAxis: baseline }],
          },
          emphasis: { focus: "none" as const },
        },
        {
          name: "隐波", type: "line" as const, yAxisIndex: 1, z: 5,
          data: minData?.iv ?? [], connectNulls: true, showSymbol: false,
          lineStyle: { width: 1.2, color: IV_COLOR },
          emphasis: { focus: "none" as const },
        },
        {
          name: "成交量", type: "bar" as const, xAxisIndex: 1, yAxisIndex: 2, z: 1,
          data: volData, emphasis: { focus: "none" as const },
        },
      ],
    }, { notMerge: true });
  }, [pick, mode, dailyBars, dailyIv, minData, inst]);

  useEffect(() => {
    const chart = inst.current;
    if (!chart) return;
    const onPtr = (raw: unknown) => {
      const idx = hoverIdxOf(raw, catsRef.current);
      setHover(idx);
    };
    chart.on("updateAxisPointer", onPtr);
    const zr = chart.getZr();
    const onOut = () => setHover(null);
    zr.on("globalout", onOut);
    return () => { chart.off("updateAxisPointer", onPtr); zr.off("globalout", onOut); };
  }, [inst]);

  let head: { label: string; toneCls: string } | null = null;
  if (pick) {
    if (mode === "daily" && dailyBars.length > 0) {
      const i = hover != null && dailyBars[hover] ? hover : dailyBars.length - 1;
      const b = dailyBars[i];
      const pct = i > 0 ? ((b.close - dailyBars[i - 1].close) / dailyBars[i - 1].close) * 100 : null;
      const iv = dailyIv[i];
      head = {
        label: [
          `${b.t.slice(5)} ${fmtPx(b.close)}`,
          pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "",
          iv != null ? `IV ${iv.toFixed(0)}` : "",
        ].filter(Boolean).join("  "),
        toneCls: pct === null ? "text-slate-400" : pct >= 0 ? "text-red-400" : "text-emerald-400",
      };
    } else if (mode === "minute" && (minData?.bars.length ?? 0) > 0) {
      const prices = minData!.prices;
      const i = lastFiniteIdx(prices, hover);
      if (hover != null && i == null) {
        const t = minData!.cats[hover] ?? "";
        head = { label: t.slice(11, 16) || t, toneCls: "text-slate-600" };
      } else if (i != null) {
        const px = prices[i];
        if (px != null) {
          const pre = minData!.pre;
          const pct = pre ? ((px - pre) / pre) * 100 : null;
          const iv = minData!.iv[i];
          const t = minData!.cats[i] ?? "";
          head = {
            label: [
              `${t.slice(11, 16) || t} ${fmtPx(px)}`,
              pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "",
              iv != null ? `IV ${iv.toFixed(0)}` : "",
            ].filter(Boolean).join("  "),
            toneCls: pct === null ? "text-slate-400" : pct >= 0 ? "text-red-400" : "text-emerald-400",
          };
        }
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-6 shrink-0 items-center gap-2 px-2 text-[11px]">
        <span className="shrink-0 font-medium text-slate-300">{mode === "daily" ? "日K" : "分时"}</span>
        {pick && head && (
          <span className={cn("min-w-0 truncate tabular-nums", head.toneCls)}>{head.label}</span>
        )}
        {!pick && mode === "daily" && (
          <span className="text-slate-600">点行情观察或 T 表</span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {pick && loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-[11px] text-slate-500">更新中…</div>
        )}
        {pick && !loading && (err || empty) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-[11px] text-slate-500">未取到</div>
        )}
        <div ref={ref} className="h-full w-full" />
      </div>
    </div>
  );
}
