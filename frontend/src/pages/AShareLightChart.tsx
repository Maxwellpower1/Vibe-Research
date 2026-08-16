import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import * as echarts from "echarts";
import { AlertCircle, FileText, Loader2, Newspaper, Plus, RefreshCw, Search, X } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { PageFallback } from "@/components/ui/PageFallback";
import { WatchlistFeed } from "@/components/WatchlistFeed";
import { ApiError, type AShareLightBar } from "@/lib/api";
import { useQuotes } from "@/lib/quoteHub";
import { loadLightKline } from "@/lib/lightKline";
import { getAShareSession } from "@/lib/ashareSession";
import { addCodes, loadWatch, saveWatch } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

const StockData = lazy(() =>
  import("@/pages/StockData").then((m) => ({ default: m.StockData })),
)

export type AShareChartSeg = "kline" | "detail" | "feed";
const CHART_SEGS: AShareChartSeg[] = ["kline", "detail", "feed"];

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

export function AShareLightChart({
  seg = "kline",
  onSegChange,
}: {
  seg?: AShareChartSeg;
  onSegChange?: (seg: AShareChartSeg) => void;
} = {}) {
  const [params, setParams] = useSearchParams();
  const urlCode = (params.get("code") || "").trim().toUpperCase();
  const [codes, setCodes] = useState<string[]>(() => {
    const w = loadWatch();
    if (urlCode && /^\d{6}$/.test(urlCode) && !w.includes(urlCode)) return [...w, urlCode];
    return w;
  });
  const [selected, setSelected] = useState<string>(() => {
    if (urlCode && /^\d{6}$/.test(urlCode)) return urlCode;
    return loadWatch()[0] ?? "";
  });
  const [input, setInput] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Res>("1");
  const [bars, setBars] = useState<AShareLightBar[]>([]);
  const [meta, setMeta] = useState<{
    code: string; name?: string; adjust?: string; prev_close?: number | null;
  } | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [feedKind, setFeedKind] = useState<"filings" | "news">("filings");
  const [session, setSession] = useState(() => getAShareSession());
  const setSeg = (next: AShareChartSeg) => {
    onSegChange?.(next);
  };
  const pickStock = (c: string) => {
    setSelected(c);
    setSeg("kline");
  };

  const chartRef = useRef<HTMLDivElement>(null);
  const echartRef = useRef<echarts.ECharts | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef(bars);
  barsRef.current = bars;

  useEffect(() => {
    const tick = () => setSession(getAShareSession());
    tick();
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, []);

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

  const quotes = useQuotes(codes);

  const loadChart = useCallback(async (sym: string, res: Res) => {
    if (!sym) {
      setBars([]); setMeta(null); setChartErr(null); setHoverIdx(null);
      return;
    }
    setChartLoading(true);
    setChartErr(null);
    try {
      const num = res === "1" ? 240 : KLINE_NUM;
      const data = await loadLightKline(sym, res, num);
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

  useEffect(() => { void loadChart(selected, resolution); }, [selected, resolution, loadChart]);

  // Sync selection <- URL deep link (?code=)
  useEffect(() => {
    if (!urlCode || !/^\d{6}$/.test(urlCode)) return;
    if (urlCode !== selected) {
      setSelected(urlCode);
      setCodes((prev) => (prev.includes(urlCode) ? prev : [...prev, urlCode]));
    }
  }, [urlCode]); // eslint-disable-line react-hooks/exhaustive-deps -- only react to URL

  // Sync URL <- selection (keep current chart tab: kline|detail|feed)
  useEffect(() => {
    if (!selected) return;
    const cur = (params.get("code") || "").trim().toUpperCase();
    const tab = CHART_SEGS.includes(seg) ? seg : "kline";
    if (cur === selected && params.get("tab") === tab) return;
    const p = new URLSearchParams(params);
    p.set("tab", tab);
    p.set("code", selected);
    setParams(p, { replace: true });
  }, [selected, seg]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const cPtr = cssHsl("--primary", "#22d3ee");
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
          fillerColor: "rgba(34,211,238,0.15)",
          handleStyle: { color: cPtr },
          moveHandleStyle: { color: cPtr },
          dataBackground: { lineStyle: { color: cAxis }, areaStyle: { color: "rgba(148,163,184,0.15)" } },
          selectedDataBackground: { lineStyle: { color: cPtr }, areaStyle: { color: "rgba(34,211,238,0.12)" } },
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
  const quoteChgPct = chgPct ?? selQuote?.pct ?? null;
  const quoteChgAmt = chg != null
    ? chg
    : selQuote != null && selQuote.prev
      ? selQuote.price - selQuote.prev
      : null;

  // Keep chart DOM mounted so ECharts survives tab switches (hide when not on kline)
  const showKline = seg === "kline";
  useEffect(() => {
    if (!showKline) return;
    const t = window.setTimeout(() => echartRef.current?.resize(), 50);
    return () => window.clearTimeout(t);
  }, [showKline, selected]);

  // Scroll watchlist so deep-linked / selected code stays in view
  useEffect(() => {
    if (!selected || !listRef.current || !showKline) return;
    const el = listRef.current.querySelector(`[data-code="${selected}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, codes.length, showKline]);

  const sessionTone =
    session.kind === "open" ? "border-primary/40 bg-primary/10 text-primary"
      : session.kind === "closed" ? "border-border/50 bg-muted/30 text-muted-foreground"
        : "border-border/40 bg-muted/20 text-muted-foreground/80";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium",
            sessionTone,
          )}
          title={session.hint}
        >
          <span className={cn(
            "h-1.5 w-1.5 rounded-full",
            session.kind === "open" ? "bg-primary animate-pulse" : "bg-muted-foreground/45",
          )} />
          {session.label}
        </span>
        <span className="text-[11px] text-muted-foreground/65">{session.hint}</span>
        {session.kind !== "open" && (
          <span className="text-[11px] text-muted-foreground/50">· 加载中 / 非交易时段或源暂不可用时属正常</span>
        )}
      </div>

      {/* K线：自选 + 图表（keep mounted for chart resize） */}
      <div className={cn(!showKline && "hidden")}>
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <GlassCard className="flex flex-col !p-0 overflow-hidden">
            <div className="market-toolbar !py-2.5">
              <span className="text-xs font-medium text-foreground">自选列表</span>
              <span className="text-[11px] text-muted-foreground/55">{codes.length} 只</span>
            </div>
            <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2.5">
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
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary/15 px-2.5 py-1.5 text-xs font-medium text-primary btn-press ring-1 ring-primary/20 hover:bg-primary/25"
              >
                <Plus className="h-3.5 w-3.5" /> 添加
              </button>
            </div>
            {hint ? <p className="px-3 py-1.5 text-[11px] text-muted-foreground">{hint}</p> : null}
            <div ref={listRef} className="min-h-[320px] flex-1 space-y-0.5 overflow-auto p-2">
              {codes.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <p className="text-xs text-muted-foreground">还没有自选</p>
                  <p className="text-[11px] text-muted-foreground/60">
                    在上方输入 6 位代码添加，或从「每日复盘」榜单点代码跳转过来。
                  </p>
                </div>
              ) : codes.map((c) => {
                const q = quotes[c];
                const pct = q?.pct;
                const active = c === selected;
                return (
                  <button
                    key={c}
                    type="button"
                    data-code={c}
                    onClick={() => pickStock(c)}
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      active ? "bg-primary/15 text-foreground ring-1 ring-primary/20" : "hover:bg-muted/40",
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
                          pct != null && pct > 0 ? "text-danger" : pct != null && pct < 0 ? "text-success" : "text-muted-foreground",
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

          <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
            {/* K线 */}
            <GlassCard className="min-w-0 p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-base font-bold tracking-tight">
                    {meta?.name || selQuote?.name || selected || "—"}{" "}
                    <span className="text-sm font-medium text-muted-foreground">{selected || ""}</span>
                  </span>
                  <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {resolution === "1D" ? (meta?.adjust === "qfq" ? "前复权" : "日K") : resolution === "5" ? "5日" : "分时"}
                  </span>
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[10px]",
                    hovering ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground",
                  )}>
                    {hovering ? "十字光标" : "最新"}
                  </span>
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
                    onClick={() => { if (selected) void loadChart(selected, resolution); }}
                    className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", chartLoading && "animate-spin")} />
                    刷新
                  </button>
                </div>
              </div>

              {chartErr && selected ? (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {chartErr}
                </div>
              ) : (
                <div className="relative">
                  {!selected && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-background/85 px-6 text-center backdrop-blur-[1px]">
                      <p className="text-sm text-muted-foreground">先选一只股票看 K 线</p>
                      <p className="max-w-xs text-[11px] text-muted-foreground/60">
                        从左侧自选点选，或在上方加 6 位代码。复盘榜单点代码也会落到这里。
                      </p>
                    </div>
                  )}
                  {chartLoading && selected && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  )}
                  <div ref={chartRef} className="h-[480px] w-full" />
                </div>
              )}
            </GlassCard>

            {/* 行情：与 K 线左右并排 */}
            <GlassCard className="flex flex-col !p-0 overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
                <p className="text-sm font-semibold">行情</p>
                {selected && (
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setSeg("detail")}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-primary hover:bg-primary/10"
                    >
                      <Search className="h-3 w-3" /> 详情
                    </button>
                    <button
                      type="button"
                      onClick={() => setSeg("feed")}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-primary hover:bg-primary/10"
                    >
                      <Newspaper className="h-3 w-3" /> 公告
                    </button>
                  </div>
                )}
              </div>
              {!selected ? (
                <div className="flex flex-col items-center gap-1.5 px-3 py-10 text-center">
                  <p className="text-xs text-muted-foreground/65">从左侧自选点一只</p>
                  <p className="text-[11px] text-muted-foreground/50">看实时行情与估值快照</p>
                </div>
              ) : (
                <div className="flex-1 space-y-3 overflow-auto p-3">
                  <div>
                    <p className="truncate text-sm font-semibold">
                      {meta?.name || selQuote?.name || "—"}
                      <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">{selected}</span>
                    </p>
                    {bar?.datetime ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{bar.datetime}</p>
                    ) : null}
                    <p className={cn(
                      "mt-2 font-mono text-2xl font-bold tabular-nums",
                      quoteChgPct != null && quoteChgPct > 0 ? "text-danger" : quoteChgPct != null && quoteChgPct < 0 ? "text-success" : "text-foreground",
                    )}>
                      {fmtPrice(bar?.close ?? selQuote?.price)}
                    </p>
                    <p className={cn(
                      "mt-0.5 text-sm tabular-nums",
                      quoteChgPct != null && quoteChgPct > 0 ? "text-danger" : quoteChgPct != null && quoteChgPct < 0 ? "text-success" : "text-muted-foreground",
                    )}>
                      {quoteChgAmt != null ? `${quoteChgAmt > 0 ? "+" : ""}${quoteChgAmt.toFixed(2)}` : "—"}
                      <span className="ml-1.5">({fmtPct(quoteChgPct)})</span>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {(resolution === "1D" && bar
                      ? [
                          { k: "开", v: fmtPrice(bar.open) },
                          { k: "高", v: fmtPrice(bar.high) },
                          { k: "低", v: fmtPrice(bar.low) },
                          { k: "收", v: fmtPrice(bar.close) },
                          { k: "量", v: fmtVol(bar.volume) },
                          { k: "昨收", v: fmtPrice(base ?? selQuote?.prev) },
                        ]
                      : bar
                        ? [
                            { k: "价", v: fmtPrice(bar.close) },
                            { k: "量", v: fmtVol(bar.volume) },
                            { k: "昨收", v: fmtPrice(meta?.prev_close ?? selQuote?.prev) },
                            { k: "现价", v: fmtPrice(selQuote?.price) },
                          ]
                        : [
                            { k: "现价", v: fmtPrice(selQuote?.price) },
                            { k: "昨收", v: fmtPrice(selQuote?.prev) },
                            { k: "涨跌%", v: fmtPct(selQuote?.pct) },
                          ]
                    ).map((m) => (
                      <div key={m.k} className="rounded-lg bg-muted/25 px-2.5 py-2">
                        <p className="text-[10px] text-muted-foreground">{m.k}</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{m.v}</p>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-border/40 pt-3">
                    <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">估值快照</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { k: "PE(TTM)", v: selQuote?.pe_ttm ? fmtPrice(selQuote.pe_ttm) : "—" },
                        { k: "PB", v: selQuote?.pb ? fmtPrice(selQuote.pb) : "—" },
                        { k: "换手%", v: selQuote?.turnover ? fmtPrice(selQuote.turnover) : "—" },
                        { k: "市值(亿)", v: selQuote?.mcap_yi ? fmtPrice(selQuote.mcap_yi) : "—" },
                      ].map((m) => (
                        <div key={m.k} className="rounded-lg bg-muted/25 px-2.5 py-2">
                          <p className="text-[10px] text-muted-foreground">{m.k}</p>
                          <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{m.v}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </GlassCard>
          </div>
        </div>
      </div>

      {seg === "detail" && (
        selected ? (
          <Suspense fallback={<PageFallback />}>
            <StockData embedded hideSearch externalCode={selected} />
          </Suspense>
        ) : (
          <GlassCard>
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm text-muted-foreground/70">还没有选中股票</p>
              <p className="text-[11px] text-muted-foreground/55">
                先到「K线」选一只自选股，再看估值 / 研报 / 资金等详情。
              </p>
              <button
                type="button"
                onClick={() => setSeg("kline")}
                className="mt-1 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25"
              >
                去 K 线选股
              </button>
            </div>
          </GlassCard>
        )
      )}

      {seg === "feed" && (
        <GlassCard>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">自选公告 / 新闻</h3>
              <p className="text-[11px] text-muted-foreground/65">汇总本地自选近期公开披露与新闻 · 非推荐</p>
            </div>
            <ChipGroup>
              <Chip active={feedKind === "filings"} onClick={() => setFeedKind("filings")}>
                <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> A股公告</span>
              </Chip>
              <Chip active={feedKind === "news"} onClick={() => setFeedKind("news")}>
                <span className="inline-flex items-center gap-1"><Newspaper className="h-3 w-3" /> 公开新闻</span>
              </Chip>
            </ChipGroup>
          </div>
          <WatchlistFeed kind={feedKind} storageKeyPrefix="ashare.chart.feed" />
        </GlassCard>
      )}
    </div>
  );
}
