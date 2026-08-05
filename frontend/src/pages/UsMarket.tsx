import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import * as echarts from "echarts";
import { AlertCircle, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { GlanceStrip, type GlanceMetric } from "@/components/ui/GlanceStrip";
import {
  api, ApiError, type GlobalStock, type UsKlineBar,
  type GlobalEarningsCalendar, type GlobalSecDaily, type GlobalFundamentals,
  type GlobalShortVolume, type GlobalTreasuryCurve,
  type GlobalEdgarScreener, type GlobalMovers, type GlobalShortRanking,
  type GlobalOptions, type GlobalFundFlow, type GlobalStockNews,
} from "@/lib/api";
import { addUsTickers, loadUsWatch, saveUsWatch } from "@/lib/usWatchlist";
import { useExpandAll, useSectionOpen } from "@/hooks/useExpandAll";
import { cn } from "@/lib/utils";

const UP = "#ef4444";
const DN = "#22c55e";
/** Pull 365 bars; default viewport shows latest ~120; wheel/slider zooms out to full. */
const KLINE_NUM = 365;
const VIEW_DAYS = 120;

const US_SECTION_KEYS = [
  "us.fundamentals", "us.short", "us.movers", "us.shortRank",
  "us.treasury", "us.options", "us.news", "us.fundflow",
  "us.edgar", "us.earnings", "us.sec",
] as const;

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtPrice(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return Number(v.toFixed(2)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtNum(v: number | null | undefined, digits = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return (Math.round(v * 10 ** digits) / 10 ** digits).toString();
}

function pctRatio(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-muted/30 p-2.5">
      <p className="text-[11px] text-muted-foreground">{k}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{v}</p>
    </div>
  );
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
  const [earnCal, setEarnCal] = useState<GlobalEarningsCalendar | null>(null);
  const [earnDays, setEarnDays] = useState<7 | 5 | 10>(7);
  const [secDaily, setSecDaily] = useState<GlobalSecDaily | null>(null);
  const [secNote, setSecNote] = useState<string | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [fund, setFund] = useState<GlobalFundamentals | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [fundTab, setFundTab] = useState<"val" | "analyst" | "holders">("val");
  const [shortVol, setShortVol] = useState<GlobalShortVolume | null>(null);
  const [shortLoading, setShortLoading] = useState(false);
  const [treasury, setTreasury] = useState<GlobalTreasuryCurve | null>(null);
  const [movers, setMovers] = useState<GlobalMovers | null>(null);
  const [moverBoard, setMoverBoard] = useState<
    "us_gainers" | "us_losers" | "us_amount" | "hk_gainers" | "hk_losers" | "hk_amount"
  >("us_gainers");
  const [shortRank, setShortRank] = useState<GlobalShortRanking | null>(null);
  const [edgar, setEdgar] = useState<GlobalEdgarScreener | null>(null);
  const [edgarTag, setEdgarTag] = useState("净利润");
  const [edgarLoading, setEdgarLoading] = useState(false);
  const [gOpt, setGOpt] = useState<GlobalOptions | null>(null);
  const [gFlow, setGFlow] = useState<GlobalFundFlow | null>(null);
  const [gNews, setGNews] = useState<GlobalStockNews | null>(null);
  const [gOptTab, setGOptTab] = useState<"0dte" | "7d">("0dte");

  const { allOpen, toggleAll } = useExpandAll(US_SECTION_KEYS);
  /** Re-draw treasury chart when its collapsible body mounts. */
  const [treasuryOpen] = useSectionOpen("us.treasury", false);

  const chartRef = useRef<HTMLDivElement>(null);
  const echartRef = useRef<echarts.ECharts | null>(null);
  const treasuryChartRef = useRef<HTMLDivElement>(null);
  const treasuryEchartRef = useRef<echarts.ECharts | null>(null);
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

  const loadPanels = useCallback(async () => {
    setPanelLoading(true);
    setSecNote(null);
    try {
      const [cal, sec, curve, mv, sr] = await Promise.all([
        api.globalEarningsCalendar({ days: earnDays }).catch(() => null),
        api.globalSecDaily({ limit: 60 }).catch((e) => {
          if (e instanceof ApiError) setSecNote(e.message);
          return null;
        }),
        api.globalTreasuryCurve().catch(() => null),
        api.globalMovers(moverBoard, 20).catch(() => null),
        api.globalShortRanking(20).catch(() => null),
      ]);
      setEarnCal(cal);
      setSecDaily(sec);
      setTreasury(curve);
      setMovers(mv);
      setShortRank(sr);
    } finally {
      setPanelLoading(false);
    }
  }, [earnDays, moverBoard]);

  const loadEdgar = useCallback(async (tag: string) => {
    setEdgarLoading(true);
    try {
      setEdgar(await api.globalEdgarScreener({ tag, top: 20 }));
    } catch {
      setEdgar(null);
    } finally {
      setEdgarLoading(false);
    }
  }, []);

  const loadFund = useCallback(async (sym: string) => {
    if (!sym) {
      setFund(null);
      return;
    }
    setFundLoading(true);
    try {
      setFund(await api.globalFundamentals(sym));
      setFundTab("val");
    } catch {
      setFund(null);
    } finally {
      setFundLoading(false);
    }
  }, []);

  const loadShort = useCallback(async (sym: string) => {
    if (!sym) {
      setShortVol(null);
      return;
    }
    setShortLoading(true);
    try {
      setShortVol(await api.globalShortVolume(sym, 15));
    } catch {
      setShortVol(null);
    } finally {
      setShortLoading(false);
    }
  }, []);

  const loadOptFlow = useCallback(async (sym: string) => {
    if (!sym) {
      setGOpt(null);
      setGFlow(null);
      setGNews(null);
      return;
    }
    const [opt, flow, news] = await Promise.all([
      api.globalOptions(sym).catch(() => null),
      api.globalFundFlow(sym, 30).catch(() => null),
      api.globalStockNews(sym, 8).catch(() => null),
    ]);
    setGOpt(opt);
    setGFlow(flow);
    setGNews(news);
    setGOptTab("0dte");
  }, []);

  useEffect(() => { void loadQuotes(); }, [loadQuotes]);
  useEffect(() => { void loadChart(selected, KLINE_NUM); }, [selected, loadChart]);
  useEffect(() => { void loadPanels(); }, [loadPanels]);
  useEffect(() => { void loadEdgar(edgarTag); }, [edgarTag, loadEdgar]);
  useEffect(() => { void loadFund(selected); }, [selected, loadFund]);
  useEffect(() => { void loadShort(selected); }, [selected, loadShort]);
  useEffect(() => { void loadOptFlow(selected); }, [selected, loadOptFlow]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    echartRef.current = chart;

    chart.on("updateAxisPointer", (raw: unknown) => {
      const params = raw as {
        currTrigger?: string;
        axesInfo?: Array<{ axisDim?: string; value?: unknown; seriesDataIndices?: Array<{ dataIndex?: number }> }>;
      };
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

  // Chart div mounts only after treasury data arrives; init+draw must run in the same effect.
  useEffect(() => {
    const el = treasuryChartRef.current;
    const pts = treasury?.points ?? [];
    if (!el || pts.length === 0) return;

    let chart = treasuryEchartRef.current;
    if (!chart || chart.getDom() !== el) {
      chart?.dispose();
      chart = echarts.init(el, undefined, { renderer: "canvas" });
      treasuryEchartRef.current = chart;
    }

    const cssHsl = (name: string, fallback: string) => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return raw ? `hsl(${raw})` : fallback;
    };
    const cText = cssHsl("--chart-text", "#94a3b8");
    const cAxis = cssHsl("--chart-axis", "#475569");
    const cGrid = cssHsl("--chart-grid", "#334155");
    const cPrimary = cssHsl("--primary", "#f35d2b");
    chart.setOption({
      animation: false,
      grid: { left: 48, right: 16, top: 20, bottom: 28 },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          const p = arr[0] as { name?: string; value?: number; dataIndex?: number } | undefined;
          if (!p) return "";
          const chg = pts[p.dataIndex ?? -1]?.chg;
          const chgTxt = chg == null ? "" : ` · 较前日 ${chg > 0 ? "+" : ""}${chg.toFixed(2)}`;
          return `${p.name}: ${Number(p.value).toFixed(2)}%${chgTxt}`;
        },
      },
      xAxis: {
        type: "category",
        data: pts.map((p) => p.tenor),
        axisLine: { lineStyle: { color: cAxis } },
        axisLabel: { color: cText, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: cText, fontSize: 10, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { color: cGrid, opacity: 0.25 } },
      },
      series: [{
        type: "line",
        data: pts.map((p) => p.yield),
        smooth: 0.2,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color: cPrimary, width: 2 },
        itemStyle: { color: cPrimary },
        areaStyle: { color: "rgba(243,93,43,0.08)" },
      }],
    }, { notMerge: true });

    // Layout may still be settling after conditional mount
    requestAnimationFrame(() => chart?.resize());
    const ro = new ResizeObserver(() => chart?.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [treasury, treasuryOpen]);

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

  const glanceMetrics: GlanceMetric[] = [];
  if (selQuote?.quote) {
    const pct = selQuote.quote.change_pct;
    const tone: GlanceMetric["tone"] =
      pct != null && pct > 0 ? "up" : pct != null && pct < 0 ? "down" : "flat";
    glanceMetrics.push(
      { label: "现价", value: fmtPrice(selQuote.quote.price), tone },
      { label: "涨跌幅", value: fmtPct(pct), tone },
      { label: "名称", value: selQuote.name || selected, tone: "muted" },
    );
  }
  glanceMetrics.push({ label: "观察数", value: String(codes.length), tone: "primary" });

  return (
    <div>
      <PageHeader
        title="美股"
        subtitle="观察列表 · K线 · 基本面 · 期权/资金流 · 榜单 · EDGAR Screener · 美债。只客观呈现。"
        actions={
          <button
            type="button"
            onClick={() => {
              void loadQuotes();
              if (selected) {
                void loadChart(selected, KLINE_NUM);
                void loadFund(selected);
                void loadShort(selected);
                void loadOptFlow(selected);
              }
              void loadPanels();
              void loadEdgar(edgarTag);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (quotesLoading || chartLoading || panelLoading || fundLoading || shortLoading) && "animate-spin")} />
            刷新
          </button>
        }
      />

      <GlanceStrip
        title="美股一眼"
        subtitle={selected ? `${selected} · 主图常开, 明细按需展开` : "主图常开 · 明细按需展开"}
        metrics={glanceMetrics}
        allOpen={allOpen}
        onToggleAll={toggleAll}
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

      {selected && (
        <CollapsibleSection
          storageKey="us.fundamentals"
          title={`基本面 · ${selected}`}
          summary={fund ? "Yahoo" : "无数据"}
          className="mt-4"
        >
          <GlassCard className="p-3 sm:p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                基本面 · {selected}
                <span className="ml-2 text-[11px] font-normal text-muted-foreground/60">Yahoo · 客观数据</span>
              </h3>
              <div className="flex gap-1">
                {([
                  ["val", "估值"],
                  ["analyst", "分析师"],
                  ["holders", "机构持仓"],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFundTab(k)}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px]",
                      fundTab === k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {fundLoading && !fund ? (
              <p className="py-6 text-center text-xs text-muted-foreground/60">加载中…</p>
            ) : !fund || (!fund.valuation && !fund.analyst && !fund.holders) ? (
              <p className="py-6 text-center text-xs text-muted-foreground/60">暂无基本面数据（Yahoo 不可达或该标的无覆盖）</p>
            ) : fundTab === "val" && fund.valuation ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {[
                  { k: "PE(TTM)", v: fmtNum(fund.valuation.trailing_pe) },
                  { k: "前向 PE", v: fmtNum(fund.valuation.forward_pe) },
                  { k: "PEG", v: fmtNum(fund.valuation.peg_ratio) },
                  { k: "PB", v: fmtNum(fund.valuation.price_to_book) },
                  { k: "目标均价", v: fmtNum(fund.valuation.target_mean) },
                  { k: "共识评级", v: fund.valuation.recommendation ?? "—" },
                  { k: "Beta", v: fmtNum(fund.valuation.beta) },
                  { k: "股息率", v: pctRatio(fund.valuation.dividend_yield) },
                  { k: "毛利率", v: pctRatio(fund.valuation.gross_margin) },
                  { k: "净利率", v: pctRatio(fund.valuation.profit_margin) },
                  { k: "ROE", v: pctRatio(fund.valuation.return_on_equity) },
                  { k: "营收增长", v: pctRatio(fund.valuation.revenue_growth) },
                ].map((m) => (
                  <Metric key={m.k} k={m.k} v={m.v} />
                ))}
              </div>
            ) : fundTab === "analyst" && fund.analyst ? (
              <div className="space-y-3">
                {fund.analyst.rating_trend[0] && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {[
                      { k: "强买", v: fund.analyst.rating_trend[0].strong_buy },
                      { k: "买入", v: fund.analyst.rating_trend[0].buy },
                      { k: "持有", v: fund.analyst.rating_trend[0].hold },
                      { k: "卖出", v: fund.analyst.rating_trend[0].sell },
                      { k: "强卖", v: fund.analyst.rating_trend[0].strong_sell },
                    ].map((m) => (
                      <Metric
                        key={m.k}
                        k={`${m.k} · ${fund.analyst!.rating_trend[0].period ?? ""}`}
                        v={String(m.v ?? "—")}
                      />
                    ))}
                  </div>
                )}
                {fund.analyst.eps_trend.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground">
                          <th className="py-1 text-left font-normal">期间</th>
                          <th className="px-2 py-1 text-right font-normal">EPS 预期</th>
                          <th className="px-2 py-1 text-right font-normal">高 / 低</th>
                          <th className="px-2 py-1 text-right font-normal">分析师数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fund.analyst.eps_trend.slice(0, 6).map((t) => (
                          <tr key={`${t.period}-${t.end_date}`} className="border-t border-border/40">
                            <td className="py-1.5 text-muted-foreground">
                              {t.period ?? "—"}{t.end_date ? ` · ${t.end_date}` : ""}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">{fmtNum(t.eps_estimate)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-xs text-muted-foreground">
                              {fmtNum(t.eps_high)} / {fmtNum(t.eps_low)}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">{t.num_analysts ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="py-4 text-center text-xs text-muted-foreground/60">暂无 EPS 预期</p>
                )}
              </div>
            ) : fundTab === "holders" && fund.holders ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric k="机构持股" v={pctRatio(fund.holders.overview.institutions_pct)} />
                  <Metric k="内部人" v={pctRatio(fund.holders.overview.insiders_pct)} />
                  <Metric k="机构数" v={fmtNum(fund.holders.overview.institutions_count, 0)} />
                  <Metric k="机构占流通" v={pctRatio(fund.holders.overview.institutions_float_pct)} />
                </div>
                {fund.holders.top_holders.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground">
                          <th className="py-1 text-left font-normal">机构</th>
                          <th className="px-2 py-1 text-right font-normal">持股占比</th>
                          <th className="px-2 py-1 text-right font-normal">股数</th>
                          <th className="px-2 py-1 text-right font-normal">报告日</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fund.holders.top_holders.map((h) => (
                          <tr key={h.name} className="border-t border-border/40">
                            <td className="py-1.5 pr-2">{h.name ?? "—"}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{pctRatio(h.pct_held)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-xs">
                              {h.shares != null ? h.shares.toLocaleString() : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">{h.report_date ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="py-4 text-center text-xs text-muted-foreground/60">暂无前十大机构明细</p>
                )}
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground/60">该分类暂无数据</p>
            )}
          </GlassCard>
        </CollapsibleSection>
      )}

      {selected && (
        <CollapsibleSection
          storageKey="us.short"
          title="FINRA 空头量"
          summary={shortVol?.rows?.length ? `${shortVol.rows.length} 日` : selected}
        >
          <GlassCard className="p-3 sm:p-4">
            <h3 className="mb-1 text-sm font-semibold">
              空头成交量 · {selected}
              <span className="ml-2 text-[11px] font-normal text-muted-foreground/60">FINRA Reg SHO</span>
            </h3>
            <p className="mb-3 text-[11px] text-muted-foreground/60">
              short volume ≠ short interest · 看日度占比变化，勿用绝对值下结论 · 近 {shortVol?.rows.length ?? 0} 个交易日
            </p>
            {shortLoading && !shortVol ? (
              <p className="py-6 text-center text-xs text-muted-foreground/60">加载中…</p>
            ) : !shortVol || shortVol.rows.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground/60">暂无 FINRA 空头数据</p>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(() => {
                    const latest = shortVol.rows[0];
                    const prev = shortVol.rows[1];
                    const delta =
                      latest?.ratio != null && prev?.ratio != null
                        ? latest.ratio - prev.ratio
                        : null;
                    return (
                      <>
                        <Metric
                          k="最新空头占比"
                          v={latest?.ratio == null ? "—" : `${(latest.ratio * 100).toFixed(1)}%`}
                        />
                        <Metric
                          k="较前日"
                          v={
                            delta == null
                              ? "—"
                              : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)} pt`
                          }
                        />
                        <Metric k="最新空头量" v={latest ? latest.short.toLocaleString() : "—"} />
                        <Metric k="最新总成交" v={latest ? latest.total.toLocaleString() : "—"} />
                      </>
                    );
                  })()}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground">
                        <th className="py-1 text-left font-normal">日期</th>
                        <th className="px-2 py-1 text-right font-normal">空头占比</th>
                        <th className="px-2 py-1 text-right font-normal">空头量</th>
                        <th className="px-2 py-1 text-right font-normal">总成交</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shortVol.rows.map((r) => (
                        <tr key={r.date} className="border-t border-border/40">
                          <td className="py-1.5 text-muted-foreground tabular-nums">
                            {`${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6)}`}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">
                            {r.ratio == null ? "—" : `${(r.ratio * 100).toFixed(1)}%`}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-xs">{r.short.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-xs">{r.total.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </GlassCard>
        </CollapsibleSection>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <CollapsibleSection
          storageKey="us.movers"
          title="市场榜单"
          summary={movers?.stocks?.length ? `${movers.stocks.length} 只` : undefined}
          className="mb-0"
        >
          <GlassCard className="p-3 sm:p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">市场榜单</h3>
              <div className="flex flex-wrap gap-1">
                {([
                  ["us_gainers", "纳指涨幅"],
                  ["us_losers", "纳指跌幅"],
                  ["us_amount", "纳指成交额"],
                  ["hk_gainers", "港股涨幅"],
                  ["hk_losers", "港股跌幅"],
                  ["hk_amount", "港股成交额"],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setMoverBoard(k)}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px]",
                      moverBoard === k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground/60">东财 clist · 点行加入/切换观察标的</p>
            {!movers?.stocks?.length ? (
              <p className="py-6 text-center text-xs text-muted-foreground/60">{panelLoading ? "加载中…" : "暂无榜单"}</p>
            ) : (
              <div className="max-h-72 space-y-0.5 overflow-y-auto">
                {movers.stocks.map((s) => (
                  <button
                    key={`${s.code}-${s.name}`}
                    type="button"
                    onClick={() => {
                      if (!s.code) return;
                      const c = s.code.toUpperCase();
                      // US watchlist + K-line only accept US tickers; HK digits -> hint
                      if (/^\d+$/.test(c) || moverBoard.startsWith("hk_")) {
                        setHint(`港股 ${c} 请到「A股 → 轻量图表」查看详情`);
                        return;
                      }
                      if (!codes.includes(c)) persist([...codes, c]);
                      setSelected(c);
                    }}
                    className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/40"
                  >
                    <span className="w-16 shrink-0 font-semibold tabular-nums">{s.code}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.name}</span>
                    <span className="w-16 shrink-0 text-right font-mono text-xs">{fmtPrice(s.price)}</span>
                    <span className={cn(
                      "w-16 shrink-0 text-right font-mono text-xs",
                      (s.change_pct ?? 0) > 0 ? "text-red-500" : (s.change_pct ?? 0) < 0 ? "text-emerald-500" : "text-muted-foreground",
                    )}>
                      {fmtPct(s.change_pct)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </GlassCard>
        </CollapsibleSection>

        <CollapsibleSection
          storageKey="us.shortRank"
          title="空头排名"
          summary={shortRank?.rows?.length ? `${shortRank.rows.length} 只` : undefined}
          className="mb-0"
        >
          <GlassCard className="p-3 sm:p-4">
            <h3 className="mb-1 text-sm font-semibold">
              FINRA 空头榜
              <span className="ml-2 text-[11px] font-normal text-muted-foreground/60">
                {shortRank?.date
                  ? `${shortRank.date.slice(0, 4)}-${shortRank.date.slice(4, 6)}-${shortRank.date.slice(6)}`
                  : "—"}
              </span>
            </h3>
            <p className="mb-3 text-[11px] text-muted-foreground/60">
              全市场空头占比 TOP · 过滤总成交 ≥ 100 万 · ≠ short interest
            </p>
            {!shortRank?.rows?.length ? (
              <p className="py-6 text-center text-xs text-muted-foreground/60">{panelLoading ? "加载中…" : "暂无空头榜"}</p>
            ) : (
              <div className="max-h-72 space-y-0.5 overflow-y-auto">
                {shortRank.rows.map((r) => (
                  <button
                    key={r.symbol}
                    type="button"
                    onClick={() => {
                      const c = r.symbol.toUpperCase();
                      if (!codes.includes(c)) persist([...codes, c]);
                      setSelected(c);
                    }}
                    className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/40"
                  >
                    <span className="w-16 shrink-0 font-semibold tabular-nums">{r.symbol}</span>
                    <span className="flex-1 text-right font-mono text-xs">
                      {r.ratio == null ? "—" : `${(r.ratio * 100).toFixed(1)}%`}
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                      {r.total.toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </GlassCard>
        </CollapsibleSection>
      </div>

      <CollapsibleSection
        storageKey="us.edgar"
        title="EDGAR Screener"
        summary={edgar?.rows?.length ? `${edgar.rows.length} 家` : edgarTag}
      >
        <GlassCard className="p-3 sm:p-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              EDGAR Screener
              <span className="ml-2 text-[11px] font-normal text-muted-foreground/60">
                S 级 · {edgar?.period ?? "—"} · 覆盖 {edgar?.universe ?? "—"} 家
              </span>
            </h3>
            <select
              value={edgarTag}
              onChange={(e) => setEdgarTag(e.target.value)}
              className="rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs outline-none"
            >
              {(edgar?.tags?.length
                ? edgar.tags.map((t) => t.label)
                : ["净利润", "研发费用", "营业收入", "经营现金流", "稀释EPS"]
              ).map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
          </div>
          <p className="mb-3 text-[11px] text-muted-foreground/60">
            SEC frames 全市场横截面 · {edgar?.tag_label ?? edgarTag} · 金额单位 {edgar?.unit ?? "USD"}
          </p>
          {edgarLoading && !edgar ? (
            <p className="py-6 text-center text-xs text-muted-foreground/60">加载中…</p>
          ) : !edgar?.rows?.length ? (
            <p className="py-6 text-center text-xs text-muted-foreground/60">暂无 screener 数据（需 VR_SEC_CONTACT）</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="py-1 text-left font-normal">#</th>
                    <th className="px-2 py-1 text-left font-normal">公司</th>
                    <th className="px-2 py-1 text-right font-normal">数值</th>
                    <th className="px-2 py-1 text-right font-normal">期末</th>
                  </tr>
                </thead>
                <tbody>
                  {edgar.rows.map((r, i) => (
                    <tr key={`${r.cik}-${r.entity}`} className="border-t border-border/40">
                      <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <div className="truncate max-w-[280px]">{r.entity ?? "—"}</div>
                        <div className="text-[11px] text-muted-foreground">CIK {r.cik}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {r.value == null
                          ? "—"
                          : Math.abs(r.value) >= 1e9
                            ? `${(r.value / 1e9).toFixed(2)}B`
                            : Math.abs(r.value) >= 1e6
                              ? `${(r.value / 1e6).toFixed(1)}M`
                              : r.value.toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">{r.end ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </CollapsibleSection>

      {selected && gOpt && (
        <CollapsibleSection
          storageKey="us.options"
          title="期权"
          summary={`CBOE · ${selected}`}
        >
          <GlassCard className="p-3 sm:p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                期权 · CBOE · {selected}
                <span className="ml-2 text-[11px] font-normal text-muted-foreground/60">
                  spot {fmtNum(gOpt.spot)} · {gOpt.et_today}
                </span>
              </h3>
              <div className="flex gap-1">
                {([["0dte", "0DTE"], ["7d", "近7日"]] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setGOptTab(k)}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px]",
                      gOptTab === k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {(() => {
              const sum = gOptTab === "0dte" ? gOpt.summary_0dte : gOpt.summary_7d;
              const flow = gOptTab === "0dte" ? gOpt.unusual_0dte : gOpt.unusual_7d;
              if (!sum) {
                return <p className="py-4 text-center text-xs text-muted-foreground/60">该区间暂无汇总</p>;
              }
              return (
                <>
                  <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric k="P/C 量比" v={fmtNum(sum.put_call_volume_ratio)} />
                    <Metric
                      k="量加权 IV"
                      v={sum.volume_weighted_iv == null ? "—" : `${(sum.volume_weighted_iv * 100).toFixed(1)}%`}
                    />
                    <Metric k="净 delta(股)" v={sum.net_delta_exposure_shares.toLocaleString()} />
                    <Metric k="成交合约" v={`${sum.contracts_traded}/${sum.contracts_total}`} />
                  </div>
                  {flow.length > 0 ? (
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full min-w-[480px] text-sm">
                        <thead>
                          <tr className="text-xs text-muted-foreground">
                            <th className="py-1 text-left font-normal">类型</th>
                            <th className="px-2 py-1 text-right font-normal">行权价</th>
                            <th className="px-2 py-1 text-right font-normal">量</th>
                            <th className="px-2 py-1 text-right font-normal">vol/OI</th>
                            <th className="px-2 py-1 text-right font-normal">IV</th>
                          </tr>
                        </thead>
                        <tbody>
                          {flow.slice(0, 12).map((c) => (
                            <tr key={c.symbol} className="border-t border-border/40">
                              <td className={cn("py-1", c.type === "call" ? "text-red-500" : "text-emerald-500")}>
                                {c.type === "call" ? "C" : "P"} <span className="text-muted-foreground text-xs">{c.expiry}</span>
                              </td>
                              <td className="px-2 py-1 text-right font-mono">{fmtNum(c.strike)}</td>
                              <td className="px-2 py-1 text-right font-mono">{c.volume?.toLocaleString() ?? "—"}</td>
                              <td className="px-2 py-1 text-right font-mono">{c.vol_oi_ratio ?? "∞"}</td>
                              <td className="px-2 py-1 text-right font-mono">
                                {c.iv == null ? "—" : `${(c.iv * 100).toFixed(1)}%`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="py-2 text-center text-xs text-muted-foreground/60">暂无异动合约</p>
                  )}
                </>
              );
            })()}
          </GlassCard>
        </CollapsibleSection>
      )}

      {selected && gNews && gNews.items.length > 0 && (
        <CollapsibleSection
          storageKey="us.news"
          title="新闻"
          summary={`${gNews.items.length} 条`}
        >
          <GlassCard className="p-3 sm:p-4">
            <h3 className="mb-1 text-sm font-semibold">
              个股新闻 · {selected}
              <span className="ml-2 text-[11px] font-normal text-muted-foreground/60">Yahoo · C 级</span>
            </h3>
            <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
              {gNews.items.map((n, i) => (
                <div key={`${n.link ?? n.title}-${i}`} className="flex items-baseline gap-2 border-b border-border/40 py-1.5 text-sm last:border-0">
                  <span className="w-24 shrink-0 font-mono text-[11px] text-muted-foreground">
                    {(n.publish_time || "").slice(0, 16) || "—"}
                  </span>
                  {n.link ? (
                    <a href={n.link} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-primary">
                      {n.title}
                    </a>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  )}
                </div>
              ))}
            </div>
          </GlassCard>
        </CollapsibleSection>
      )}

      {selected && gFlow && gFlow.rows.length > 0 && (
        <CollapsibleSection
          storageKey="us.fundflow"
          title="资金流"
          summary={`${Math.min(gFlow.rows.length, 10)} 日`}
        >
          <GlassCard className="p-3 sm:p-4">
            <h3 className="mb-1 text-sm font-semibold">资金流 · {selected}</h3>
            <p className="mb-3 text-[11px] text-muted-foreground/60">东财日级主力净流入 · 单位：亿美元 · 最近 10 日</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="py-1 text-left font-normal">日期</th>
                    <th className="px-2 py-1 text-right font-normal">主力</th>
                    <th className="px-2 py-1 text-right font-normal">超大单</th>
                    <th className="px-2 py-1 text-right font-normal">大单</th>
                    <th className="px-2 py-1 text-right font-normal">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {[...gFlow.rows].reverse().slice(0, 10).map((r) => (
                    <tr key={r.date} className="border-t border-border/40">
                      <td className="py-1.5 text-muted-foreground">{r.date}</td>
                      <td className={cn(
                        "px-2 py-1.5 text-right font-mono",
                        r.main_net > 0 ? "text-red-500" : r.main_net < 0 ? "text-emerald-500" : "",
                      )}>
                        {(r.main_net / 1e8).toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{(r.super_big_net / 1e8).toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{(r.big_net / 1e8).toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {r.main_pct == null ? "—" : `${r.main_pct.toFixed(2)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        storageKey="us.treasury"
        title="美债"
        summary={treasury?.date ?? undefined}
      >
        <GlassCard className="p-3 sm:p-4">
          <h3 className="mb-1 text-sm font-semibold">
            美债收益率曲线
            <span className="ml-2 text-[11px] font-normal text-muted-foreground/60">
              1M~30Y · Treasury · {treasury?.date ?? "—"}
            </span>
          </h3>
          <p className="mb-3 text-[11px] text-muted-foreground/60">
            美国财政部官方日度曲线（S 级）· 利差仅客观呈现，不构成利率预测
          </p>
          {!treasury || treasury.points.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground/60">
              {panelLoading ? "加载中…" : "暂无美债曲线数据"}
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div ref={treasuryChartRef} className="h-[220px] w-full min-w-0" />
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 content-start">
                <Metric
                  k="10Y − 2Y"
                  v={
                    treasury.spreads.ten_two == null
                      ? "—"
                      : `${treasury.spreads.ten_two > 0 ? "+" : ""}${treasury.spreads.ten_two.toFixed(2)}`
                  }
                />
                <Metric
                  k="10Y − 3M"
                  v={
                    treasury.spreads.ten_three_month == null
                      ? "—"
                      : `${treasury.spreads.ten_three_month > 0 ? "+" : ""}${treasury.spreads.ten_three_month.toFixed(2)}`
                  }
                />
                <Metric
                  k="30Y − 10Y"
                  v={
                    treasury.spreads.thirty_ten == null
                      ? "—"
                      : `${treasury.spreads.thirty_ten > 0 ? "+" : ""}${treasury.spreads.thirty_ten.toFixed(2)}`
                  }
                />
                <Metric
                  k="2Y / 10Y / 30Y"
                  v={[
                    treasury.points.find((p) => p.tenor === "2Y")?.yield,
                    treasury.points.find((p) => p.tenor === "10Y")?.yield,
                    treasury.points.find((p) => p.tenor === "30Y")?.yield,
                  ].map((v) => (v == null ? "—" : v.toFixed(2))).join(" / ")}
                />
              </div>
            </div>
          )}
        </GlassCard>
      </CollapsibleSection>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <CollapsibleSection
          storageKey="us.earnings"
          title="财报日历"
          summary={
            earnCal
              ? `${earnCal.total ?? earnCal.count ?? 0} 家`
              : undefined
          }
          className="mb-0"
        >
          <GlassCard className="p-3 sm:p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">财报日历</h3>
              <div className="flex gap-1">
                {([5, 7, 10] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setEarnDays(d)}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px]",
                      earnDays === d ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    {d} 日
                  </button>
                ))}
              </div>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground/60">
              Nasdaq · {earnCal?.start && earnCal?.end ? `${earnCal.start} → ${earnCal.end}` : "—"}
              {" · "}共 {earnCal?.total ?? earnCal?.count ?? 0} 家
              {" · "}跳过周末 · 仅客观日程与 EPS 预期
            </p>
            {!earnCal || (earnCal.total ?? earnCal.count) === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground/60">
                {panelLoading ? "加载中…" : "区间内暂无财报安排（或数据源暂不可用）"}
              </p>
            ) : (
              <div className="max-h-80 space-y-3 overflow-y-auto">
                {(earnCal.by_day ?? [{ date: earnCal.date, count: earnCal.count, rows: earnCal.rows }])
                  .filter((d) => d.count > 0)
                  .map((day) => (
                    <div key={day.date}>
                      <div className="sticky top-0 z-[1] mb-1 flex items-baseline gap-2 bg-card/95 py-0.5 text-xs backdrop-blur">
                        <span className="font-medium tabular-nums text-foreground">{day.date}</span>
                        <span className="text-muted-foreground/60">{day.count} 家</span>
                      </div>
                      <div className="space-y-0.5">
                        {day.rows.slice(0, 30).map((r) => (
                          <button
                            key={`${day.date}-${r.symbol}-${r.name}`}
                            type="button"
                            onClick={() => { if (r.symbol) setSelected(r.symbol); }}
                            className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/40"
                          >
                            <span className="w-16 shrink-0 font-semibold tabular-nums">{r.symbol}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.name}</span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">{r.time || "—"}</span>
                            <span className="w-16 shrink-0 text-right font-mono text-xs">{r.eps_forecast || "—"}</span>
                          </button>
                        ))}
                        {day.rows.length > 30 && (
                          <p className="px-2 text-[11px] text-muted-foreground/60">…另有 {day.rows.length - 30} 家</p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </GlassCard>
        </CollapsibleSection>

        <CollapsibleSection
          storageKey="us.sec"
          title="SEC 申报流"
          summary={secDaily ? `${secDaily.total} 份` : undefined}
          className="mb-0"
        >
          <GlassCard className="p-3 sm:p-4">
            <h3 className="mb-1 text-sm font-semibold">SEC 申报流</h3>
            <p className="mb-3 text-[11px] text-muted-foreground/60">
              EDGAR 每日索引 · Form 4 / 8-K / 13F · {secDaily ? `日期 ${secDaily.date.slice(0, 4)}-${secDaily.date.slice(4, 6)}-${secDaily.date.slice(6)} · 全市场 ${secDaily.total} 份` : "需配置 VR_SEC_CONTACT"}
            </p>
            {secNote && !secDaily ? (
              <p className="py-4 text-xs text-muted-foreground">{secNote}</p>
            ) : !secDaily || secDaily.filings.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground/60">
                {panelLoading ? "加载中…" : "暂无申报流"}
              </p>
            ) : (
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {secDaily.filings.map((f, i) => (
                  <a
                    key={`${f.form}-${f.cik}-${f.date}-${i}`}
                    href={f.url || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "flex items-baseline gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40",
                      !f.url && "pointer-events-none",
                    )}
                  >
                    <span className="w-12 shrink-0 font-mono text-xs text-primary">{f.form}</span>
                    <span className="min-w-0 flex-1 truncate">{f.company}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{f.form_label || ""}</span>
                  </a>
                ))}
              </div>
            )}
          </GlassCard>
        </CollapsibleSection>
      </div>

      <Disclaimer />
    </div>
  );
}
