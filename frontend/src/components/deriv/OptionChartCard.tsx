import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { num } from "@/components/ovlab/shared";
import { cn } from "@/lib/utils";
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

/** 时间序列对齐: [[time, v], ...] -> 按 categories 精确匹配, 缺 null. */
function alignSeries(pairs: Array<[string, number | null]> | undefined, cats: string[]): Array<number | null> {
  const m = new Map<string, number | null>();
  for (const [t, v] of pairs ?? []) m.set(t, v);
  return cats.map((c) => m.get(c) ?? null);
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

/** 分钟 bar 时间 -> 交易日 (与后端 _trading_day 同口径): 夜盘 >=20点归次交易日; 凌晨 <6点归前一晚的次交易日, 周末顺延. */
export function tradingDayOf(t: string): string {
  const d = t.slice(0, 10);
  const hh = Number(t.slice(11, 13));
  if (hh >= 6 && hh < 20) return d;
  const dt = new Date(`${d}T00:00:00`);
  if (hh < 6) dt.setDate(dt.getDate() - 1);
  do {
    dt.setDate(dt.getDate() + 1);
  } while (dt.getDay() === 0 || dt.getDay() === 6);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
    if (all.length === 0) return { bars: [] as MinBar[], iv: [] as Array<number | null>, pre: null as number | null };
    const lastTd = tradingDayOf(all[all.length - 1].t);
    const bars = all.filter((b) => tradingDayOf(b.t) === lastTd);
    const ivPairs = (av?.data ?? []) as Array<[string, number | null]>;
    const iv = alignSeries(ivPairs, bars.map((b) => b.t));
    return { bars, iv, pre: preCloseOf(kl?.data, lastTd) };
  }, [minute.data, mode, pick?.code]);

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

  catsRef.current = mode === "daily" ? dailyBars.map((b) => b.t) : (minData?.bars.map((b) => b.t) ?? []);

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
            scale: true, position: "right" as const,
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

    const bars = minData?.bars ?? [];
    if (bars.length === 0) { chart.clear(); return; }
    const cats = bars.map((b) => b.t);
    const prices = bars.map((b) => b.close);
    const pre = minData?.pre ?? null;
    const baseline = pre !== null && pre > 0 ? pre : prices[0];
    const pMin = Math.min(...prices, baseline);
    const pMax = Math.max(...prices, baseline);
    const pPad = (pMax - pMin) * 0.06 || Math.abs(baseline) * 0.002 || 1;
    const up = prices[prices.length - 1] >= baseline;
    const tone = up ? UP : DN;
    const fade = up ? "239,68,68" : "34,197,94";
    const grad = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: `rgba(${fade},0.35)` },
      { offset: 1, color: `rgba(${fade},0.02)` },
    ]);
    const volData = bars.map((b) => ({
      value: b.vol,
      itemStyle: { color: b.close >= baseline ? UP : DN },
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
          scale: true, position: "right" as const,
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
          data: prices, showSymbol: false,
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
      const bars = minData!.bars;
      const i = hover != null && bars[hover] ? hover : bars.length - 1;
      const b = bars[i];
      const pre = minData!.pre;
      const pct = pre ? ((b.close - pre) / pre) * 100 : null;
      const iv = minData!.iv[i];
      head = {
        label: [
          `${b.t.slice(11, 16)} ${fmtPx(b.close)}`,
          pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "",
          iv != null ? `IV ${iv.toFixed(0)}` : "",
        ].filter(Boolean).join("  "),
        toneCls: pct === null ? "text-slate-400" : pct >= 0 ? "text-red-400" : "text-emerald-400",
      };
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
          <span className="text-slate-600">点 T 表出图</span>
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
