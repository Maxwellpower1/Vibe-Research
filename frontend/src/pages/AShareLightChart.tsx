import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import * as echarts from "echarts";
import { AlertCircle, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, ApiError, type AShareLightBar, type Quote } from "@/lib/api";
import { addCodes, loadWatch, saveWatch } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

const UP = "#ef4444";
const DN = "#22c55e";
const KLINE_NUM = 365;
const VIEW_DAYS = 120;

type Res = "1" | "5" | "1D";
const RES_OPTS: { v: Res; label: string }[] = [
  { v: "1", label: "分时" },
  { v: "5", label: "5日" },
  { v: "1D", label: "日线" },
];

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtPrice(v: number | null | undefined, d = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return Number(v.toFixed(d)).toLocaleString("zh-CN", { maximumFractionDigits: d });
}

function fmtVol(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e8) return (v / 1e8).toFixed(2) + "亿";
  if (v >= 1e4) return (v / 1e4).toFixed(1) + "万";
  return String(Math.round(v));
}

export function AShareLightChart() {
  const [codes, setCodes] = useState<string[]>(loadWatch);
  const [selected, setSelected] = useState<string>(() => loadWatch()[0] ?? "");
  const [input, setInput] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [resolution, setResolution] = useState<Res>("1");
  const [bars, setBars] = useState<AShareLightBar[]>([]);
  const [meta, setMeta] = useState<{
    code: string; name?: string; adjust?: string; prev_close?: number | null;
  } | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const chartRef = useRef<HTMLDivElement>(null);
  const echartRef = useRef<echarts.ECharts | null>(null);
  const barsRef = useRef(bars);
  barsRef.current = bars;

  const persist = (next: string[]) => {
    setCodes(next);
    saveWatch(next);
    if (selected && !next.includes(selected)) setSelected(next[0] ?? "");
    if (!selected && next[0]) setSelected(next[0]);
  };

  const add = () => {
    const { next, added } = addCodes(codes, input);
    if (added === 0) {
      setHint(input.trim() ? "没识别到新的 6 位代码（或已在列表里）" : null);
      setInput("");
      return;
    }
    persist(next);
    setInput("");
    setHint(`已添加 ${added} 只`);
    if (!selected) setSelected(next[next.length - added] ?? next[0]);
  };

  const remove = (c: string, e?: MouseEvent) => {
    e?.stopPropagation();
    persist(codes.filter((x) => x !== c));
  };

  const loadQuotes = useCallback(async () => {
    if (!codes.length) { setQuotes({}); return; }
    setQuotesLoading(true);
    try {
      setQuotes(await api.quote(codes.join(",")));
    } catch {
      setQuotes({});
    } finally {
      setQuotesLoading(false);
    }
  }, [codes]);

  const loadChart = useCallback(async (sym: string, res: Res) => {
    if (!sym) {
      setBars([]); setMeta(null); setChartErr(null); setHoverIdx(null);
      return;
    }
    setChartLoading(true);
    setChartErr(null);
    try {
      const data = await api.ashareLightKline(sym, res, KLINE_NUM);
      setBars(data.bars ?? []);
      setMeta({
        code: data.code,
        name: data.name,
        adjust: data.adjust,
        prev_close: data.prev_close,
      });
      setHoverIdx(null);
    } catch (e) {
      setBars([]);
      setMeta(null);
      setHoverIdx(null);
      setChartErr(e instanceof ApiError ? e.message : "K 线加载失败");
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => { void loadQuotes(); }, [loadQuotes]);
  useEffect(() => { void loadChart(selected, resolution); }, [selected, resolution, loadChart]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    echartRef.current = chart;
    chart.on("updateAxisPointer", (raw) => {
      const params = raw as {
        currTrigger?: string;
        axesInfo?: Array<{ axisDim?: string; value?: unknown; seriesDataIndices?: Array<{ dataIndex?: number }> }>;
      };
      if (params?.currTrigger === "leave") { setHoverIdx(null); return; }
      const xAxis = (params.axesInfo ?? []).find((a) => a.axisDim === "x") ?? params.axesInfo?.[0];
      const fromSeries = xAxis?.seriesDataIndices?.find((s) => Number.isInteger(s?.dataIndex));
      if (fromSeries && Number.isInteger(fromSeries.dataIndex)) {
        setHoverIdx(fromSeries.dataIndex as number);
        return;
      }
      const val = xAxis?.value;
      const list = barsRef.current;
      if (typeof val === "number" && val >= 0 && val < list.length) {
        setHoverIdx(Math.round(val));
        return;
      }
      if (val != null) {
        const i = list.findIndex((b) => b.datetime === String(val));
        if (i >= 0) setHoverIdx(i);
      }
    });
    const zr = chart.getZr();
    const onOut = () => setHoverIdx(null);
    zr.on("globalout", onOut);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(chartRef.current);
    return () => {
      zr.off("globalout", onOut);
      ro.disconnect();
      chart.dispose();
      echartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!echartRef.current) return;
    if (bars.length === 0) {
      echartRef.current.clear();
      return;
    }
    const cssHsl = (name: string, fallback: string) => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return raw ? `hsl(${raw})` : fallback;
    };
    const cText = cssHsl("--chart-text", "#94a3b8");
    const cAxis = cssHsl("--chart-axis", "#475569");
    const cGrid = cssHsl("--chart-grid", "#334155");
    const cPtr = cssHsl("--primary", "#f35d2b");
    const dates = bars.map((b) => b.datetime);
    const isDaily = resolution === "1D";
    // 分时: 昨收为零轴; 5日: 首笔为零轴 (对齐期货轻量图)
    const priceVals = bars.map((b) => b.close);
    const finitePx = priceVals.filter((v) => Number.isFinite(v));
    const baseline = (resolution === "1" && meta?.prev_close != null && Number.isFinite(meta.prev_close))
      ? Number(meta.prev_close)
      : (finitePx[0] ?? 0);
    const pMin = finitePx.length ? Math.min(...finitePx, baseline) : baseline;
    const pMax = finitePx.length ? Math.max(...finitePx, baseline) : baseline;
    const pPad = (pMax - pMin) * 0.06 || Math.abs(baseline) * 0.002 || 1;

    const volData = bars.map((b) => {
      const up = isDaily ? b.close >= b.open : b.close >= baseline;
      return { value: b.volume, itemStyle: { color: up ? UP : DN } };
    });

    const zoomStart = isDaily && bars.length > VIEW_DAYS
      ? (1 - VIEW_DAYS / bars.length) * 100
      : 0;

    // Same custom paint as Ovlab LightChartPanel: red above / green below zero axis
    const trendPaintSeries = {
      name: "_trendPaint",
      type: "custom" as const,
      yAxisIndex: 0,
      z: 2,
      silent: true,
      clip: true,
      data: priceVals,
      renderItem: (params: {
        dataIndex: number;
        dataIndexInside: number;
        dataInsideLength: number;
        coordSys?: { x: number; y: number; width: number; height: number };
      }, api: { coord: (v: [number, number]) => number[] }) => {
        if (params.dataIndexInside !== 0) return undefined;
        const cs = params.coordSys;
        if (!cs) return undefined;
        const visCount = params.dataInsideLength ?? 0;
        if (visCount < 2) return undefined;
        const i0 = params.dataIndex;
        const i1 = Math.min(priceVals.length - 1, i0 + visCount - 1);

        const segs: number[][][] = [];
        let cur: number[][] = [];
        for (let i = i0; i <= i1; i++) {
          const v = priceVals[i];
          if (!Number.isFinite(v)) {
            if (cur.length >= 2) segs.push(cur);
            cur = [];
            continue;
          }
          const p = api.coord([i, v]);
          if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
            if (cur.length >= 2) segs.push(cur);
            cur = [];
            continue;
          }
          cur.push(p);
        }
        if (cur.length >= 2) segs.push(cur);
        if (segs.length === 0) return undefined;

        const zRef = api.coord([i0, baseline]);
        if (!zRef || !Number.isFinite(zRef[1])) return undefined;
        const zeroY = zRef[1];
        const upH = Math.max(0, zeroY - cs.y);
        const dnH = Math.max(0, cs.y + cs.height - zeroY);

        const gradUp = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: "rgba(239, 68, 68, 0.42)" },
          { offset: 1, color: "rgba(239, 68, 68, 0.02)" },
        ]);
        const gradDn = new echarts.graphic.LinearGradient(0, 1, 0, 0, [
          { offset: 0, color: "rgba(34, 197, 94, 0.42)" },
          { offset: 1, color: "rgba(34, 197, 94, 0.02)" },
        ]);

        const paintChildren: Record<string, unknown>[] = [];
        for (const linePts of segs) {
          const zL = [linePts[0][0], zeroY];
          const zR = [linePts[linePts.length - 1][0], zeroY];
          const areaPts = [...linePts, zR, zL];
          paintChildren.push(
            {
              type: "group",
              clipPath: { type: "rect", shape: { x: cs.x, y: cs.y, width: cs.width, height: upH } },
              children: [
                { type: "polygon", shape: { points: areaPts }, style: { fill: gradUp } },
                { type: "polyline", shape: { points: linePts }, style: { stroke: UP, lineWidth: 1.5, fill: "none", lineJoin: "round", lineCap: "round" } },
              ],
            },
            {
              type: "group",
              clipPath: { type: "rect", shape: { x: cs.x, y: zeroY, width: cs.width, height: dnH } },
              children: [
                { type: "polygon", shape: { points: areaPts }, style: { fill: gradDn } },
                { type: "polyline", shape: { points: linePts }, style: { stroke: DN, lineWidth: 1.5, fill: "none", lineJoin: "round", lineCap: "round" } },
              ],
            },
          );
        }
        paintChildren.push({
          type: "line",
          shape: { x1: cs.x, y1: zeroY, x2: cs.x + cs.width, y2: zeroY },
          style: { stroke: "rgba(148,163,184,0.45)", lineWidth: 1, lineDash: [4, 3] },
        });
        return { type: "group", children: paintChildren };
      },
      tooltip: { show: false },
      legendHoverLink: false,
    };

    const mainSeries = isDaily
      ? [{
          name: "K线",
          type: "candlestick" as const,
          data: bars.map((b) => [b.open, b.close, b.low, b.high]),
          itemStyle: { color: UP, color0: DN, borderColor: UP, borderColor0: DN },
          emphasis: { focus: "none" as const },
          blur: { itemStyle: { opacity: 1 } },
        }]
      : [
          trendPaintSeries,
          {
            name: "价格",
            type: "line" as const,
            yAxisIndex: 0,
            z: 1,
            data: priceVals,
            showSymbol: false,
            lineStyle: { width: 0, opacity: 0 },
            emphasis: { focus: "none" as const },
            blur: { lineStyle: { opacity: 0 } },
          },
        ];

    echartRef.current.setOption({
      backgroundColor: "transparent",
      animation: false,
      legend: { show: false },
      tooltip: {
        trigger: "axis",
        showContent: false,
        axisPointer: {
          type: "cross",
          crossStyle: { color: cAxis, width: 1, type: "dashed" },
          label: { show: false },
        },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 56, right: 24, top: 16, height: "58%" },
        { left: 56, right: 24, top: "72%", height: "16%" },
      ],
      xAxis: [
        {
          type: "category", data: dates, boundaryGap: isDaily, scale: true,
          axisLine: { lineStyle: { color: cAxis } },
          axisLabel: {
            color: cText, fontSize: 10,
            formatter: (v: string) => {
              if (resolution === "1") return v.slice(11, 16) || v;
              if (resolution === "5") {
                const m = v.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
                return m ? `${m[2]}-${m[3]} ${m[4]}` : v;
              }
              return v.length >= 10 ? v.slice(5) : v;
            },
          },
          splitLine: { show: false },
          axisPointer: { label: { show: false } },
        },
        {
          type: "category", gridIndex: 1, data: dates, boundaryGap: isDaily, scale: true,
          axisLabel: { show: false },
          axisLine: { lineStyle: { color: cAxis } },
          splitLine: { show: false },
          axisPointer: { label: { show: false } },
        },
      ],
      yAxis: [
        isDaily
          ? {
              scale: true,
              splitLine: { lineStyle: { color: cGrid, opacity: 0.25, width: 1 } },
              axisLabel: { color: cText, fontSize: 10, formatter: (v: number) => Number(v.toFixed(2)).toString() },
              axisPointer: {
                label: {
                  show: true, backgroundColor: cPtr, color: "#fff",
                  formatter: (p: { value: number | string }) => Number(Number(p.value).toFixed(2)).toLocaleString("zh-CN"),
                },
              },
            }
          : {
              min: pMin - pPad,
              max: pMax + pPad,
              scale: false,
              splitLine: { lineStyle: { color: cGrid, opacity: 0.25, width: 1 } },
              axisLabel: { color: cText, fontSize: 10, formatter: (v: number) => Number(v.toFixed(2)).toString() },
              axisPointer: {
                label: {
                  show: true, backgroundColor: cPtr, color: "#fff",
                  formatter: (p: { value: number | string }) => Number(Number(p.value).toFixed(2)).toLocaleString("zh-CN"),
                },
              },
            },
        {
          scale: true,
          gridIndex: 1,
          min: (v: { min?: number }) => { const mn = v.min ?? 0; return mn > 0 ? Math.floor(mn * 0.9) : 0; },
          splitNumber: 2,
          axisLabel: { show: false },
          splitLine: { show: false },
          axisPointer: { label: { show: false } },
        },
      ],
      dataZoom: [
        {
          type: "inside", xAxisIndex: [0, 1],
          start: zoomStart, end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
        },
        {
          type: "slider", xAxisIndex: [0, 1], bottom: 4, height: 16,
          start: zoomStart, end: 100,
          textStyle: { fontSize: 9, color: cText },
          borderColor: cAxis,
          fillerColor: "rgba(243,93,43,0.15)",
          handleStyle: { color: cPtr },
          moveHandleStyle: { color: cPtr },
          dataBackground: { lineStyle: { color: cAxis }, areaStyle: { color: "rgba(148,163,184,0.15)" } },
          selectedDataBackground: { lineStyle: { color: cPtr }, areaStyle: { color: "rgba(243,93,43,0.12)" } },
        },
      ],
      series: [
        ...mainSeries,
        {
          name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, z: 1,
          data: volData,
          emphasis: { focus: "none" },
          blur: { itemStyle: { opacity: 1 } },
        },
      ],
    }, { notMerge: true });
  }, [bars, resolution, meta?.prev_close]);

  const activeIdx = hoverIdx != null && bars[hoverIdx] ? hoverIdx : (bars.length ? bars.length - 1 : -1);
  const bar = activeIdx >= 0 ? bars[activeIdx] : null;
  const prevBar = activeIdx > 0 ? bars[activeIdx - 1] : null;
  const base = resolution === "1D"
    ? (prevBar?.close ?? null)
    : (meta?.prev_close ?? null);
  const chg = bar && base != null ? bar.close - base : null;
  const chgPct = chg != null && base ? (chg / base) * 100 : null;
  const hovering = hoverIdx != null && bars[hoverIdx] != null;
  const selQuote = selected ? quotes[selected] : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <GlassCard className="flex flex-col p-3">
        <div className="mb-2 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="加自选: 600519 000858"
            className="min-w-0 flex-1 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-sm outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={add}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> 添加
          </button>
        </div>
        {hint ? <p className="mb-2 text-[11px] text-muted-foreground">{hint}</p> : null}
        <div className="min-h-[320px] flex-1 space-y-0.5 overflow-auto">
          {codes.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">还没有自选，先加几个 6 位代码（与「自选股」同源）。</p>
          ) : codes.map((c) => {
            const q = quotes[c];
            const pct = q?.change_pct;
            const active = c === selected;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setSelected(c)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  active ? "bg-primary/12 text-foreground" : "hover:bg-muted/40",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-semibold tabular-nums">{c}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{q?.name ?? ""}</span>
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2 tabular-nums text-xs">
                    <span>{fmtPrice(q?.price)}</span>
                    <span className={cn(
                      pct != null && pct > 0 ? "text-red-500" : pct != null && pct < 0 ? "text-emerald-500" : "text-muted-foreground",
                    )}>
                      {fmtPct(pct)}
                    </span>
                  </div>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => remove(c, e)}
                  onKeyDown={(e) => { if (e.key === "Enter") remove(c); }}
                  className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted/60 hover:text-foreground group-hover:opacity-100"
                  title="移除"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      </GlassCard>

      <GlassCard className="p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-lg font-bold tracking-tight">
                {meta?.name || selQuote?.name || selected || "—"}{" "}
                <span className="text-sm font-medium text-muted-foreground">{selected || ""}</span>
              </span>
              <span className="rounded px-1.5 py-0.5 text-[10px] bg-muted/40 text-muted-foreground">
                {resolution === "1D" ? (meta?.adjust === "qfq" ? "前复权" : "日K") : resolution === "5" ? "5日" : "分时"}
              </span>
              <span className={cn(
                "rounded px-1.5 py-0.5 text-[10px]",
                hovering ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground",
              )}>
                {hovering ? "十字光标" : "最新"}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm tabular-nums">
              {bar?.datetime ? <span className="text-xs text-muted-foreground">{bar.datetime}</span> : null}
              <span>
                <span className="text-[11px] text-muted-foreground">{resolution === "1D" ? "收" : "价"}</span>{" "}
                <b className="text-lg text-primary">{fmtPrice(bar?.close ?? selQuote?.price)}</b>
              </span>
              <span className={cn(
                chgPct != null && chgPct > 0 ? "text-red-500" : chgPct != null && chgPct < 0 ? "text-emerald-500" : "text-muted-foreground",
              )}>
                {chg != null ? `${chg > 0 ? "+" : ""}${chg.toFixed(2)}` : "—"}
                <span className="ml-1 text-xs">({fmtPct(chgPct)})</span>
              </span>
              {resolution === "1D" && bar ? (
                <span className="text-xs text-muted-foreground">
                  开 <b className="text-foreground">{fmtPrice(bar.open)}</b>
                  {" · "}高 <b className="text-foreground">{fmtPrice(bar.high)}</b>
                  {" · "}低 <b className="text-foreground">{fmtPrice(bar.low)}</b>
                  {" · "}量 <b className="text-foreground">{fmtVol(bar.volume)}</b>
                </span>
              ) : bar ? (
                <span className="text-xs text-muted-foreground">
                  量 <b className="text-foreground">{fmtVol(bar.volume)}</b>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
              {RES_OPTS.map((r) => (
                <button
                  key={r.v}
                  type="button"
                  onClick={() => setResolution(r.v)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs",
                    resolution === r.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { void loadQuotes(); if (selected) void loadChart(selected, resolution); }}
              className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", (quotesLoading || chartLoading) && "animate-spin")} />
              刷新
            </button>
          </div>
        </div>

        {chartErr ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /> {chartErr}
          </div>
        ) : (
          <div className="relative">
            {chartLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <div ref={chartRef} className="h-[480px] w-full" />
          </div>
        )}
      </GlassCard>
    </div>
  );
}
