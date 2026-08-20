import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, FileText, Loader2, Newspaper, Plus, RefreshCw, Search, X } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { LcLegend, LcSeg, LcWell, lcTone, type LcLegendItem } from "@/components/ui/LcFrame";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { PageFallback } from "@/components/ui/PageFallback";
import { WatchlistFeed } from "@/components/WatchlistFeed";
import { ApiError, type AShareLightBar } from "@/lib/api";
import { useQuotes } from "@/lib/quoteHub";
import { loadLightKline } from "@/lib/lightKline";
import { getAShareSession } from "@/lib/ashareSession";
import { addCodes, loadWatch, saveWatch } from "@/lib/watchlist";
import { cn } from "@/lib/utils";
import {
  BaselineSeries, CandlestickSeries, HistogramSeries, applyTimeLabels, baselineOpts,
  candleOpts, candleValues, resizeLc, seriesAlive, setRefPriceLine, showLatest, sparseLine, styleLastTag,
  styleVolOverlay, useLcChart, volOpts, volValues, wipeLc, type IPriceLine, type ISeriesApi,
} from "@/lib/lcChart";

const StockData = lazy(() =>
  import("@/pages/StockData").then((m) => ({ default: m.StockData })),
)

export type AShareChartSeg = "kline" | "detail" | "feed";
const CHART_SEGS: AShareChartSeg[] = ["kline", "detail", "feed"];

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

  const { ref: chartRef, chartRef: lcRef, labelsRef, onHoverRef } = useLcChart();
  const bag = useRef<{
    kind: "candle" | "baseline" | null;
    main: ISeriesApi<"Candlestick"> | ISeriesApi<"Baseline"> | null;
    vol: ISeriesApi<"Histogram"> | null;
  }>({ kind: null, main: null, vol: null });
  const refLine = useRef<IPriceLine | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  onHoverRef.current = setHoverIdx;

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
    const chart = lcRef.current;
    if (!chart) return;
    if (bars.length === 0) {
      wipeLc(chart);
      bag.current = { kind: null, main: null, vol: null };
      refLine.current = null;
      labelsRef.current = [];
      return;
    }
    const isDaily = resolution === "1D";
    const kind = isDaily ? "candle" as const : "baseline" as const;
    const finitePx = bars.map((b) => b.close).filter((v) => Number.isFinite(v));
    const baseline = (resolution === "1" && meta?.prev_close != null && Number.isFinite(meta.prev_close))
      ? Number(meta.prev_close)
      : (finitePx[0] ?? 0);
    labelsRef.current = bars.map((b) => b.datetime);
    applyTimeLabels(chart, labelsRef, isDaily ? "md" : resolution === "5" ? "mdhm" : "hm");
    if (bag.current.kind !== kind || !seriesAlive(chart, bag.current.main) || !seriesAlive(chart, bag.current.vol)) {
      wipeLc(chart);
      refLine.current = null;
      bag.current.main = kind === "candle"
        ? chart.addSeries(CandlestickSeries, candleOpts())
        : chart.addSeries(BaselineSeries, baselineOpts(baseline));
      bag.current.vol = chart.addSeries(HistogramSeries, volOpts());
      bag.current.kind = kind;
      styleVolOverlay(chart);
    }
    if (kind === "candle") {
      (bag.current.main as ISeriesApi<"Candlestick">).setData(candleValues(bars));
    } else {
      const bl = bag.current.main as ISeriesApi<"Baseline">;
      bl.applyOptions(baselineOpts(baseline));
      bl.setData(sparseLine(bars.map((b) => b.close)));
    }
    const last = bars[bars.length - 1];
    styleLastTag(bag.current.main, last?.close, kind === "candle" ? last?.open : baseline);
    const prev = kind === "candle"
      ? (bars.length > 1 ? bars[bars.length - 2].close : null)
      : baseline;
    setRefPriceLine(bag.current.main, refLine, prev);
    bag.current.vol!.setData(volValues(bars.map((b) => ({
      value: b.volume,
      up: isDaily ? b.close >= b.open : b.close >= baseline,
    }))));
    if (isDaily) showLatest(chart, bars.length, VIEW_DAYS);
    else chart.timeScale().fitContent();
  }, [bars, resolution, meta?.prev_close, lcRef, labelsRef]);


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

  const ashareLegend: LcLegendItem[] = [];
  if (bar) {
    if (resolution === "1D") {
      ashareLegend.push(
        { k: "O", v: fmtPrice(bar.open) },
        { k: "H", v: fmtPrice(bar.high) },
        { k: "L", v: fmtPrice(bar.low) },
        { k: "C", v: fmtPrice(bar.close), tone: lcTone(chg) },
        { k: "V", v: fmtVol(bar.volume), tone: "muted" },
      );
    } else {
      ashareLegend.push(
        { k: "T", v: resolution === "5" ? (bar.datetime.slice(5, 16) || bar.datetime) : (bar.datetime.slice(11, 16) || bar.datetime), tone: "muted" },
        { k: "P", v: fmtPrice(bar.close), tone: lcTone(chg) },
        { k: "V", v: fmtVol(bar.volume), tone: "muted" },
      );
    }
  }

  // Keep chart DOM mounted so LC survives tab switches (hide when not on kline)
  const showKline = seg === "kline";
  useEffect(() => {
    if (!showKline) return;
    const t = window.setTimeout(() => {
      const chart = lcRef.current;
      if (chart) resizeLc(chart, chartRef.current);
    }, 50);
    return () => window.clearTimeout(t);
  }, [showKline, selected, lcRef, chartRef]);

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
                      active
                        ? "bg-white/[0.04] text-foreground shadow-[inset_2px_0_0_#22d3ee]"
                        : "hover:bg-white/[0.03]",
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
                          pct != null && pct > 0 ? "text-[#f6465d]" : pct != null && pct < 0 ? "text-[#0ecb81]" : "text-muted-foreground",
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
              <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-lg font-semibold tracking-tight">{selected || "—"}</span>
                    <span className="truncate text-xs text-slate-500">
                      {meta?.name || selQuote?.name || ""}
                    </span>
                    <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                      {resolution === "1D" ? (meta?.adjust === "qfq" ? "qfq" : "D") : resolution === "5" ? "5D" : "1"}
                    </span>
                    {hovering ? (
                      <span className="font-mono text-[10px] tracking-wide text-cyan-400/80">CROSSHAIR</span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-3">
                    <span className={cn(
                      "font-mono text-2xl font-semibold tabular-nums",
                      quoteChgPct != null && quoteChgPct > 0 ? "text-[#f6465d]"
                        : quoteChgPct != null && quoteChgPct < 0 ? "text-[#0ecb81]"
                          : "text-slate-200",
                    )}>
                      {fmtPrice(bar?.close ?? selQuote?.price)}
                    </span>
                    <span className={cn(
                      "font-mono text-sm tabular-nums",
                      quoteChgPct != null && quoteChgPct > 0 ? "text-[#f6465d]"
                        : quoteChgPct != null && quoteChgPct < 0 ? "text-[#0ecb81]"
                          : "text-slate-500",
                    )}>
                      {quoteChgAmt != null ? `${quoteChgAmt > 0 ? "+" : ""}${quoteChgAmt.toFixed(2)}` : "—"}
                      <span className="ml-1.5">({fmtPct(quoteChgPct)})</span>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <LcSeg value={resolution} options={RES_OPTS} onChange={setResolution} />
                  <button
                    type="button"
                    onClick={() => { if (selected) void loadChart(selected, resolution); }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 ring-1 ring-white/[0.06] hover:text-slate-200"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", chartLoading && "animate-spin")} />
                  </button>
                </div>
              </div>

              <LcWell className="h-[480px]">
                {!selected && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#0b0f17]/88 px-6 text-center">
                    <p className="text-sm text-slate-400">先选一只股票看 K 线</p>
                    <p className="max-w-xs text-[11px] text-slate-600">
                      从左侧自选点选，或在上方加 6 位代码。复盘榜单点代码也会落到这里。
                    </p>
                  </div>
                )}
                {chartErr && selected && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-[#0b0f17]/88 px-4 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {chartErr}
                  </div>
                )}
                {chartLoading && selected && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0b0f17]/40">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                  </div>
                )}
                <LcLegend items={ashareLegend} />
                <div ref={chartRef} className="h-full w-full" />
              </LcWell>
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
                      quoteChgPct != null && quoteChgPct > 0 ? "text-[#f6465d]"
                        : quoteChgPct != null && quoteChgPct < 0 ? "text-[#0ecb81]"
                          : "text-foreground",
                    )}>
                      {fmtPrice(bar?.close ?? selQuote?.price)}
                    </p>
                    <p className={cn(
                      "mt-0.5 text-sm tabular-nums",
                      quoteChgPct != null && quoteChgPct > 0 ? "text-[#f6465d]"
                        : quoteChgPct != null && quoteChgPct < 0 ? "text-[#0ecb81]"
                          : "text-muted-foreground",
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
