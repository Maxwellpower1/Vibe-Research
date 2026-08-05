import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import * as echarts from "echarts";
import { AlertCircle, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, ApiError, type GlobalStock, type UsKlineBar } from "@/lib/api";
import { addUsTickers, loadUsWatch, saveUsWatch } from "@/lib/usWatchlist";
import { cn } from "@/lib/utils";

const UP = "#ef4444";
const DN = "#22c55e";
/** Pull 365 bars; default viewport shows latest ~120; wheel/slider zooms out to full. */
const KLINE_NUM = 365;
const VIEW_DAYS = 120;

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtPrice(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return Number(v.toFixed(2)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function UsMarket() {
  const [codes, setCodes] = useState<string[]>(loadUsWatch);
  const [selected, setSelected] = useState<string>(() => loadUsWatch()[0] ?? "");
  const [input, setInput] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, GlobalStock | null>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [bars, setBars] = useState<UsKlineBar[]>([]);
  const [chartMeta, setChartMeta] = useState<{ code: string; name?: string; adjust?: string } | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const chartRef = useRef<HTMLDivElement>(null);
  const echartRef = useRef<echarts.ECharts | null>(null);
  const barsRef = useRef(bars);
  barsRef.current = bars;

  const persist = (next: string[]) => {
    setCodes(next);
    saveUsWatch(next);
    if (selected && !next.includes(selected)) {
      setSelected(next[0] ?? "");
    }
    if (!selected && next[0]) setSelected(next[0]);
  };

  const add = () => {
    const { next, added } = addUsTickers(codes, input);
    if (added === 0) {
      setHint(input.trim() ? "没识别到新的美股代码（或已在列表里）" : null);
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
    if (codes.length === 0) {
      setQuotes({});
      return;
    }
    setQuotesLoading(true);
    const entries = await Promise.all(
      codes.map(async (c) => {
        try {
          return [c, await api.globalStock(c, { withMetrics: false })] as const;
        } catch {
          return [c, null] as const;
        }
      }),
    );
    setQuotes(Object.fromEntries(entries));
    setQuotesLoading(false);
  }, [codes]);

  const loadChart = useCallback(async (sym: string, num: number) => {
    if (!sym) {
      setBars([]);
      setChartMeta(null);
      setChartErr(null);
      return;
    }
    setChartLoading(true);
    setChartErr(null);
    try {
      const data = await api.usKline(sym, num);
      setBars(data.bars ?? []);
      setChartMeta({ code: data.code, name: data.name, adjust: data.adjust });
      setHoverIdx(null);
    } catch (e) {
      setBars([]);
      setChartMeta(null);
      setHoverIdx(null);
      setChartErr(e instanceof ApiError ? e.message : "K 线加载失败");
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => { void loadQuotes(); }, [loadQuotes]);
  useEffect(() => { void loadChart(selected, KLINE_NUM); }, [selected, loadChart]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    echartRef.current = chart;

    chart.on("updateAxisPointer", (params: {
      currTrigger?: string;
      axesInfo?: Array<{ axisDim?: string; value?: unknown; seriesDataIndices?: Array<{ dataIndex?: number }> }>;
    }) => {
      if (params?.currTrigger === "leave") {
        setHoverIdx(null);
        return;
      }
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
        const i = list.findIndex((b) => b.date === String(val));
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
    const dates = bars.map((b) => b.date);
    const ohlc = bars.map((b) => [b.open, b.close, b.low, b.high]);
    const vols = bars.map((b) => ({
      value: b.volume,
      itemStyle: { color: b.close >= b.open ? UP : DN },
    }));

    const cPtr = cssHsl("--primary", "#f35d2b");
    echartRef.current.setOption({
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
        { left: 56, right: 24, top: 16, height: "62%" },
        { left: 56, right: 24, top: "76%", height: "14%" },
      ],
      xAxis: [
        {
          type: "category", data: dates, boundaryGap: true, scale: true,
          axisLine: { lineStyle: { color: cAxis } },
          axisLabel: { color: cText, fontSize: 10 },
          splitLine: { show: false },
          axisPointer: { label: { show: false } },
        },
        {
          type: "category", gridIndex: 1, data: dates, boundaryGap: true, scale: true,
          axisLabel: { show: false },
          axisLine: { lineStyle: { color: cAxis } },
          splitLine: { show: false },
          axisPointer: { label: { show: false } },
        },
      ],
      yAxis: [
        {
          scale: true,
          splitLine: { lineStyle: { color: cGrid, opacity: 0.25 } },
          axisLabel: { color: cText, fontSize: 10, formatter: (v: number) => Number(v.toFixed(2)).toString() },
          axisPointer: {
            label: {
              show: true, backgroundColor: cPtr, color: "#fff",
              formatter: (p: { value: number | string }) => Number(Number(p.value).toFixed(2)).toLocaleString("en-US"),
            },
          },
        },
        {
          scale: true, gridIndex: 1,
          splitNumber: 2,
          axisLabel: { show: false },
          splitLine: { show: false },
          axisPointer: { label: { show: false } },
        },
      ],
      dataZoom: [
        {
          type: "inside", xAxisIndex: [0, 1],
          // Default show latest ~120 of 365; wheel zoom out to full 365
          start: bars.length > VIEW_DAYS ? (1 - VIEW_DAYS / bars.length) * 100 : 0,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
        },
        {
          type: "slider", xAxisIndex: [0, 1], bottom: 4, height: 16,
          start: bars.length > VIEW_DAYS ? (1 - VIEW_DAYS / bars.length) * 100 : 0,
          end: 100,
          textStyle: { fontSize: 9, color: cText },
          borderColor: cAxis,
          fillerColor: "rgba(243,93,43,0.15)",
          handleStyle: { color: cssHsl("--primary", "#f35d2b") },
        },
      ],
      series: [
        {
          name: "K线", type: "candlestick", data: ohlc,
          itemStyle: { color: UP, color0: DN, borderColor: UP, borderColor0: DN },
        },
        {
          name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: vols,
        },
      ],
    }, { notMerge: true });
  }, [bars]);

  const selQuote = selected ? quotes[selected] : null;
  const activeIdx = hoverIdx != null && bars[hoverIdx] ? hoverIdx : (bars.length ? bars.length - 1 : -1);
  const bar = activeIdx >= 0 ? bars[activeIdx] : null;
  const prevBar = activeIdx > 0 ? bars[activeIdx - 1] : null;
  const chg = bar && prevBar ? bar.close - prevBar.close : null;
  const chgPct = chg != null && prevBar && prevBar.close ? (chg / prevBar.close) * 100 : null;
  const hovering = hoverIdx != null && bars[hoverIdx] != null;

  const fmtVol = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return "—";
    if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return String(Math.round(v));
  };

  return (
    <div>
      <PageHeader
        title="美股"
        subtitle="观察列表 + 日 K（默认前复权）。列表只存本地；只客观呈现，不推荐不预测。"
        actions={
          <button
            type="button"
            onClick={() => { void loadQuotes(); if (selected) void loadChart(selected, KLINE_NUM); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (quotesLoading || chartLoading) && "animate-spin")} />
            刷新
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Watchlist */}
        <GlassCard className="flex flex-col p-3">
          <div className="mb-2 flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              placeholder="加代码: AAPL TSLA"
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
              <p className="p-4 text-center text-xs text-muted-foreground">还没有观察标的，先加几个 ticker。</p>
            ) : codes.map((c) => {
              const q = quotes[c];
              const pct = q?.quote?.change_pct;
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
                      <span>{fmtPrice(q?.quote?.price)}</span>
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

        {/* Chart */}
        <GlassCard className="p-3 sm:p-4">
          <div className="mb-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-lg font-bold tracking-tight">
                {chartMeta?.name || selQuote?.name || selected || "—"}{" "}
                <span className="text-sm font-medium text-muted-foreground">{selected || ""}</span>
              </div>
              <span className="flex items-center gap-1.5">
                <span className="rounded px-1.5 py-0.5 text-[10px] bg-muted/40 text-muted-foreground">
                  {chartMeta?.adjust === "qfq" ? "前复权" : chartMeta?.adjust === "none" ? "不复权" : "日K"}
                </span>
                <span className={cn(
                  "rounded px-1.5 py-0.5 text-[10px]",
                  hovering ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground",
                )}>
                  {hovering ? "十字光标" : "最新"}
                </span>
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm tabular-nums">
              {bar?.date ? (
                <span className="text-xs text-muted-foreground">{bar.date}</span>
              ) : null}
              <span>
                <span className="text-[11px] text-muted-foreground">收</span>{" "}
                <b className="text-lg text-primary">{fmtPrice(bar?.close ?? selQuote?.quote?.price)}</b>
              </span>
              <span className={cn(
                chgPct != null && chgPct > 0 ? "text-red-500" : chgPct != null && chgPct < 0 ? "text-emerald-500" : "text-muted-foreground",
              )}>
                {chg != null ? `${chg > 0 ? "+" : ""}${chg.toFixed(2)}` : "—"}
                <span className="ml-1 text-xs">({fmtPct(chgPct)})</span>
              </span>
              <span className="text-xs text-muted-foreground">
                开 <b className="text-foreground">{fmtPrice(bar?.open)}</b>
                {" · "}高 <b className="text-foreground">{fmtPrice(bar?.high)}</b>
                {" · "}低 <b className="text-foreground">{fmtPrice(bar?.low)}</b>
                {" · "}量 <b className="text-foreground">{fmtVol(bar?.volume)}</b>
              </span>
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

      <Disclaimer />
    </div>
  );
}
