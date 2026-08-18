import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import * as echarts from "echarts";
import { AlertCircle, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, ApiError, type OvlabLastBar, type OvlabSearchItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import { storageGet, storageSet } from "@/lib/storage";
import { usePolling } from "@/hooks/usePolling";
import { derivSession } from "@/components/deriv/derivShared";
import {
  derivMinuteSlots, kindOfUnd, padToSlots, tradingDayOf, undRootOf,
} from "@/lib/derivMinuteAxis";

const UP = "#ef4444";
const DN = "#22c55e";
const IV_COLOR = "#a78bfa";
const OI_COLOR = "#eab308";
const KLINE_NUM = 365;
const VIEW_DAYS = 120;
const WATCH_KEY = "deriv.kline.watch";

type Res = "1" | "5" | "1D";
const RES_OPTS: { v: Res; label: string }[] = [
  { v: "1", label: "分时" },
  { v: "5", label: "5日" },
  { v: "1D", label: "日线" },
];

/** Futures contract (SC2610 / IM2609) or 6-digit ETF (510300). */
const CODE_RE = /^([A-Z]{1,4}\d{2,4}|\d{6})$/;

type Bar = {
  datetime: string;
  open: number;
  close: number;
  low: number;
  high: number;
  volume: number | null;
  oi: number | null;
};

type WatchItem = { c: string; n: string };

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

function loadWatch(): WatchItem[] {
  try {
    const raw = storageGet(WATCH_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x): WatchItem | null => {
        if (typeof x === "string") return CODE_RE.test(x) ? { c: x, n: "" } : null;
        const c = String(x?.c ?? "").toUpperCase();
        return CODE_RE.test(c) ? { c, n: String(x?.n ?? "") } : null;
      })
      .filter((x): x is WatchItem => x !== null);
  } catch {
    return [];
  }
}

function saveWatch(list: WatchItem[]): void {
  storageSet(WATCH_KEY, JSON.stringify(list));
}

/** api unwraps {data: upstream}; upstream is usually {data: rows}. */
function unwrapRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const d = (raw as { data?: unknown })?.data;
  return Array.isArray(d) ? d : [];
}

// —— 合约搜索选择弹窗 ——
function SymbolPicker({
  onSelect,
  onClose,
}: {
  onSelect: (code: string, name: string) => void;
  onClose: () => void;
}) {
  const [kw, setKw] = useState("");
  const [results, setResults] = useState<OvlabSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const k = kw.trim();
    if (!k) { setResults([]); return; }
    let cancel = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.ovlabSearchSymbols(k);
        if (!cancel) setResults(r);
      } catch { if (!cancel) setResults([]); }
      finally { if (!cancel) setLoading(false); }
    }, 300);
    return () => { cancel = true; clearTimeout(t); };
  }, [kw]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-20" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">选择合约</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={kw} onChange={(e) => setKw(e.target.value)} placeholder="输入关键词, 如 SC / 沪铜 / 510300"
            className="w-full rounded-lg border border-border/60 bg-muted/30 py-2 pl-8 pr-3 text-sm outline-none focus:border-primary/50" />
        </div>
        <div className="mt-2 max-h-[50vh] overflow-auto rounded-lg border border-border/60">
          {loading ? (
            <div className="flex items-center justify-center p-4 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 搜索中...</div>
          ) : results.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">{kw.trim() ? "无匹配结果" : "输入关键词搜索合约"}</p>
          ) : results.map((r, i) => (
            <button key={(r.ticker ?? "") + i} onClick={() => r.ticker && onSelect(r.ticker, r.name ?? "")}
              className="flex w-full items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-left text-sm transition-colors hover:bg-primary/10">
              <div className="min-w-0">
                <div className="font-medium">{r.ticker ?? "-"} <span className="ml-1.5 text-xs text-muted-foreground">{r.name ?? ""}</span></div>
                <div className="truncate text-[11px] text-muted-foreground">{r.exchange ?? ""} · {r.type ?? ""} {r.expiration_date ? `· 到期 ${r.expiration_date}` : ""}</div>
              </div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground/60">数据来自 openvlab search-symbols · 输入 300ms 后自动搜索</p>
      </div>
    </div>
  );
}

export function DerivLightChart() {
  const [params, setParams] = useSearchParams();
  const urlSym = (params.get("symbol") || "").trim().toUpperCase();
  const [codes, setCodes] = useState<WatchItem[]>(() => {
    const w = loadWatch();
    if (urlSym && CODE_RE.test(urlSym) && !w.some((x) => x.c === urlSym)) return [...w, { c: urlSym, n: "" }];
    return w;
  });
  const [selected, setSelected] = useState<string>(() => {
    if (urlSym && CODE_RE.test(urlSym)) return urlSym;
    return loadWatch()[0]?.c ?? "";
  });
  const [input, setInput] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resolution, setResolution] = useState<Res>("1");
  const [bars, setBars] = useState<Bar[]>([]);
  const [atm, setAtm] = useState<Array<number | null>>([]);
  const [lastBar, setLastBar] = useState<OvlabLastBar | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [, tick] = useState(0);

  const chartRef = useRef<HTMLDivElement>(null);
  const echartRef = useRef<echarts.ECharts | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const plot = useMemo(() => {
    if (resolution !== "1" || bars.length === 0) return { bars, atm };
    const lastTd = tradingDayOf(bars[bars.length - 1].datetime);
    const idxs = bars.map((b, i) => (tradingDayOf(b.datetime) === lastTd ? i : -1)).filter((i) => i >= 0);
    const dayBars = idxs.map((i) => bars[i]);
    const dayAtm = idxs.map((i) => atm[i] ?? null);
    const kind = kindOfUnd(undRootOf(selected), dayBars.map((b) => b.datetime));
    const slots = derivMinuteSlots(lastTd, kind);
    const padded = padToSlots(dayBars, slots, (b) => b.datetime);
    const viewBars: Bar[] = padded.map((b, i) => b ?? {
      datetime: slots[i],
      open: NaN, close: NaN, low: NaN, high: NaN,
      volume: null, oi: null,
    });
    const viewAtm = padded.map((b) => {
      if (!b) return null;
      const j = dayBars.indexOf(b);
      return j >= 0 ? dayAtm[j] : null;
    });
    return { bars: viewBars, atm: viewAtm };
  }, [bars, atm, resolution, selected]);

  const barsRef = useRef(plot.bars);
  barsRef.current = plot.bars;
  // Guard against out-of-order responses when switching 分时/5日/日线 quickly
  const loadSeq = useRef(0);
  // Per-symbol / per-resolution memory cache: switch tabs instantly, then refresh on demand
  type ChartCache = { bars: Bar[]; atm: Array<number | null>; lastBar: OvlabLastBar | null };
  const chartCache = useRef<Record<string, ChartCache>>({});

  // Session badge re-ticks every minute
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const session = derivSession();

  const persist = (next: WatchItem[]) => {
    setCodes(next);
    saveWatch(next);
    if (selected && !next.some((x) => x.c === selected)) setSelected(next[0]?.c ?? "");
    if (!selected && next[0]) setSelected(next[0].c);
  };

  const addCode = (raw: string, name = "") => {
    const c = raw.trim().toUpperCase();
    if (!CODE_RE.test(c)) {
      setHint(raw.trim() ? "没识别到合约代码 (如 SC2610 / IM2609 / 510300)" : null);
      setInput("");
      return;
    }
    if (codes.some((x) => x.c === c)) {
      setHint("已在列表里");
      setInput("");
      setSelected(c);
      return;
    }
    const next = [...codes, { c, n: name }];
    persist(next);
    setInput("");
    setHint(`已添加 ${c}`);
    setSelected(c);
  };

  const remove = (c: string, e?: MouseEvent) => {
    e?.stopPropagation();
    persist(codes.filter((x) => x.c !== c));
  };

  // Watchlist quotes: one last-bar per code, 60s (server cached, 休市喂上一笔)
  const watchKey = codes.map((x) => x.c).join(",");
  const quotesPoll = usePolling(
    async () => {
      const out: Record<string, OvlabLastBar | null> = {};
      await Promise.all(codes.map(async (x) => {
        try { out[x.c] = await api.ovlabLastBar(x.c); } catch { out[x.c] = null; }
      }));
      return out;
    },
    60_000,
    [watchKey],
    codes.length > 0,
  );
  const quotes = quotesPoll.data ?? {};

  const applyCache = useCallback((hit: ChartCache) => {
    setBars(hit.bars);
    setAtm(hit.atm);
    setLastBar(hit.lastBar);
    setHoverIdx(null);
    setChartErr(null);
  }, []);

  const loadChart = useCallback(async (sym: string, res: Res, force = false) => {
    if (!sym) {
      setBars([]); setAtm([]); setLastBar(null); setChartErr(null); setHoverIdx(null);
      return;
    }
    const key = `${sym}::${res}`;
    const hit = chartCache.current[key];
    if (!force && hit) { applyCache(hit); setChartLoading(false); return; }
    const seq = ++loadSeq.current;
    if (hit) applyCache(hit);
    else { setBars([]); setAtm([]); setLastBar(null); setHoverIdx(null); }
    setChartLoading(true);
    setChartErr(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      // 分时(1): 当日0点前推6h 覆盖夜盘; 5日(5): ~10自然日; 日线(1D): 1年前
      const from = res === "1"
        ? Math.floor(new Date().setHours(0, 0, 0, 0) / 1000) - 6 * 3600
        : res === "5" ? now - 10 * 86400 : now - KLINE_NUM * 86400;
      const [kl, av, lb] = await Promise.all([
        api.ovlabKlineHistory(sym, res, from, now),
        api.ovlabAtmvolHistory(sym, res, from, now),
        api.ovlabLastBar(sym).catch(() => null),
      ]);
      if (seq !== loadSeq.current) return;
      const klRows = unwrapRows(kl);
      const avRows = unwrapRows(av);
      let nextBars: Bar[];
      if (res === "1D") {
        // 日线: 对象格式 {trade_date, open, close, low, high, vol, oi}
        nextBars = klRows.map((b) => {
          const r = b as Record<string, unknown>;
          const vol = Number(r.vol);
          const oi = Number(r.oi);
          return {
            datetime: String(r.trade_date ?? ""),
            open: Number(r.open ?? 0), close: Number(r.close ?? 0),
            low: Number(r.low ?? 0), high: Number(r.high ?? 0),
            volume: Number.isFinite(vol) && vol > 0 ? vol : null,
            oi: Number.isFinite(oi) && oi > 0 ? oi : null,
          };
        });
      } else {
        // 分时/5日: 数组格式 [datetime, price, pct, volume, open, high, low, oi]
        nextBars = klRows.map((b) => {
          const r = b as unknown[];
          const vol = Number(r[3]);
          const oi = Number(r[7]);
          return {
            datetime: String(r[0] ?? ""),
            open: Number(r[4] ?? 0), close: Number(r[1] ?? 0),
            low: Number(r[6] ?? 0), high: Number(r[5] ?? 0),
            volume: Number.isFinite(vol) && vol > 0 ? vol : null,
            oi: Number.isFinite(oi) && oi > 0 ? oi : null,
          };
        });
      }
      // 隐波按日期对齐, 缺失用前一个有效值填充 (forward fill)
      const avMap = new Map<string, number>();
      avRows.forEach((a) => {
        const r = a as unknown[];
        let d = String(r[0] ?? "");
        if (res === "1D") d = d.replace(/-/g, "");
        const v = Number(r[1]);
        if (d && Number.isFinite(v)) avMap.set(d, v);
      });
      let prevAv: number | null = null;
      const nextAtm = nextBars.map((b) => {
        const v = avMap.has(b.datetime) ? avMap.get(b.datetime)! : null;
        if (v != null) prevAv = v;
        return prevAv;
      });
      const packed: ChartCache = { bars: nextBars, atm: nextAtm, lastBar: lb };
      chartCache.current[key] = packed;
      applyCache(packed);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setChartErr(e instanceof ApiError ? e.message : "K 线加载失败");
      if (!chartCache.current[key]) { setBars([]); setAtm([]); setLastBar(null); }
    } finally {
      if (seq === loadSeq.current) setChartLoading(false);
    }
  }, [applyCache]);

  useEffect(() => { void loadChart(selected, resolution); }, [selected, resolution, loadChart]);

  // Sync selection <- URL deep link (?symbol=)
  useEffect(() => {
    if (!urlSym || !CODE_RE.test(urlSym)) return;
    if (urlSym !== selected) {
      setSelected(urlSym);
      setCodes((prev) => (prev.some((x) => x.c === urlSym) ? prev : [...prev, { c: urlSym, n: "" }]));
    }
  }, [urlSym]); // eslint-disable-line react-hooks/exhaustive-deps -- only react to URL

  // Sync URL <- selection
  useEffect(() => {
    if (!selected) return;
    const cur = (params.get("symbol") || "").trim().toUpperCase();
    if (cur === selected && params.get("tab") === "kline") return;
    const p = new URLSearchParams(params);
    p.set("tab", "kline");
    p.set("symbol", selected);
    setParams(p, { replace: true });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    echartRef.current = chart;
    chart.on("updateAxisPointer", (raw) => {
      const p = raw as {
        currTrigger?: string;
        axesInfo?: Array<{ axisDim?: string; value?: unknown; seriesDataIndices?: Array<{ dataIndex?: number }> }>;
      };
      if (p?.currTrigger === "leave") { setHoverIdx(null); return; }
      const xAxis = (p.axesInfo ?? []).find((a) => a.axisDim === "x") ?? p.axesInfo?.[0];
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
        const s = String(val);
        const i = list.findIndex((b) => b.datetime === s || b.datetime.slice(11, 16) === s);
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

  const preClose = lastBar?.pre_close != null && Number.isFinite(Number(lastBar.pre_close))
    ? Number(lastBar.pre_close)
    : null;

  useEffect(() => {
    if (!echartRef.current) return;
    if (plot.bars.length === 0) {
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
    const plotBars = plot.bars;
    const plotAtm = plot.atm;
    const dates = plotBars.map((b) => b.datetime);
    const isDaily = resolution === "1D";
    // 分时: 昨结为基准; 5日: 首笔为基准 (与 A股轻量图同口径)
    const priceVals = plotBars.map((b) => b.close);
    const finitePx = priceVals.filter((v) => Number.isFinite(v));
    const baseline = (resolution === "1" && preClose != null && preClose > 0)
      ? preClose
      : (finitePx[0] ?? 0);
    const pMin = finitePx.length ? Math.min(...finitePx, baseline) : baseline;
    const pMax = finitePx.length ? Math.max(...finitePx, baseline) : baseline;
    const pPad = (pMax - pMin) * 0.06 || Math.abs(baseline) * 0.002 || 1;

    // 成交量柱: 日线按 close>=open; 分时/5日按 close>=基准 (与 A股轻量图同口径)
    const volData = plotBars.map((b) => {
      const up = isDaily ? b.close >= b.open : b.close >= baseline;
      return { value: Number.isFinite(b.close) ? b.volume : null, itemStyle: { color: up ? UP : DN } };
    });

    const zoomStart = isDaily && plotBars.length > VIEW_DAYS
      ? (1 - VIEW_DAYS / plotBars.length) * 100
      : 0;

    // Same custom paint as AShareLightChart: red above / green below zero axis
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
          data: plotBars.map((b) => [b.open, b.close, b.low, b.high]),
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
      legend: {
        show: true,
        orient: "horizontal",
        right: 8,
        top: 2,
        itemWidth: 14,
        itemHeight: 8,
        itemGap: 12,
        textStyle: { color: cText, fontSize: 10 },
        icon: "roundRect",
        data: [isDaily ? "K线" : "价格", "ATM隐波", "成交量", "持仓量"],
      },
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
        { left: 56, right: 56, top: 26, height: "54%" },
        { left: 56, right: 56, top: "72%", height: "16%" },
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
                const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/);
                return m ? `${m[2]}-${m[3]} ${m[4]}` : v;
              }
              const d = v.replace(/-/g, "");
              return d.length === 8 ? `${d.slice(4, 6)}-${d.slice(6)}` : v;
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
          position: "right" as const,
          splitLine: { show: false },
          axisLabel: { color: IV_COLOR, fontSize: 10, formatter: (v: number) => Number(v.toFixed(1)) + "%" },
          axisPointer: { label: { show: false } },
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
          name: "ATM隐波", type: "line" as const, yAxisIndex: 1, z: 5,
          data: plotAtm,
          connectNulls: false,
          showSymbol: false,
          lineStyle: { width: 1.3, color: IV_COLOR },
          emphasis: { focus: "none" as const },
          blur: { lineStyle: { opacity: 1 }, itemStyle: { opacity: 1 } },
        },
        {
          name: "成交量", type: "bar" as const, xAxisIndex: 1, yAxisIndex: 2, z: 1,
          data: volData,
          emphasis: { focus: "none" as const },
          blur: { itemStyle: { opacity: 1 } },
        },
        {
          name: "持仓量", type: "line" as const, xAxisIndex: 1, yAxisIndex: 2, z: 5,
          data: plotBars.map((b) => b.oi),
          connectNulls: false,
          showSymbol: false,
          lineStyle: { width: 1.3, color: OI_COLOR },
          emphasis: { focus: "none" as const },
          blur: { lineStyle: { opacity: 1 }, itemStyle: { opacity: 1 } },
        },
      ],
    }, { notMerge: true });
  }, [plot, resolution, preClose]);

  const plotBars = plot.bars;
  const plotAtm = plot.atm;
  const lastPxIdx = (() => {
    for (let i = plotBars.length - 1; i >= 0; i--) {
      if (Number.isFinite(plotBars[i].close)) return i;
    }
    return plotBars.length ? plotBars.length - 1 : -1;
  })();
  const slotHover = hoverIdx != null && plotBars[hoverIdx] != null;
  const hovering = slotHover && Number.isFinite(plotBars[hoverIdx!].close);
  const emptyHover = slotHover && !hovering;
  const activeIdx = hovering || emptyHover ? hoverIdx! : lastPxIdx;
  const bar = activeIdx >= 0 ? plotBars[activeIdx] : null;
  const prevBar = activeIdx > 0 ? plotBars[activeIdx - 1] : null;
  const base = resolution === "1D"
    ? (prevBar?.close ?? null)
    : preClose;
  const pxOk = bar != null && Number.isFinite(bar.close);
  const chg = pxOk && base != null && Number.isFinite(base) ? bar.close - base : null;
  const chgPct = chg != null && base ? (chg / base) * 100 : null;
  const selQuote = selected ? quotes[selected] : undefined;
  const quoteChgPct = emptyHover
    ? null
    : (chgPct ?? (selQuote?.pre_close ? ((selQuote.close - selQuote.pre_close) / selQuote.pre_close) * 100 : null));
  const quoteChgAmt = emptyHover
    ? null
    : (chg ?? (selQuote?.pre_close != null ? selQuote.close - selQuote.pre_close : null));
  const selName = codes.find((x) => x.c === selected)?.n ?? "";
  const curAtm = activeIdx >= 0 ? plotAtm[activeIdx] : null;

  const fmtBarTime = (raw: string) => {
    if (!raw) return "";
    if (resolution === "1D") {
      const d = raw.replace(/-/g, "");
      return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : raw;
    }
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/);
    return m ? `${m[2]}-${m[3]} ${m[4]}` : raw;
  };

  // Scroll watchlist so deep-linked / selected code stays in view
  useEffect(() => {
    if (!selected || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-code="${selected}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, codes.length]);

  const sessionTone =
    session.live ? "border-primary/40 bg-primary/10 text-primary"
      : "border-border/50 bg-muted/30 text-muted-foreground";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium",
            sessionTone,
          )}
        >
          <span className={cn(
            "h-1.5 w-1.5 rounded-full",
            session.live ? "bg-primary animate-pulse" : "bg-muted-foreground/45",
          )} />
          {session.label}
        </span>
        <span className="text-[11px] text-muted-foreground/65">日盘 09:00-15:00 · 午休 11:30-13:30 · 夜盘 21:00-02:30</span>
        {!session.live && (
          <span className="text-[11px] text-muted-foreground/50">· 非交易时段显示上一笔缓存</span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <GlassCard className="flex flex-col !p-0 overflow-hidden">
          <div className="market-toolbar !py-2.5">
            <span className="text-xs font-medium text-foreground">自选合约</span>
            <span className="text-[11px] text-muted-foreground/55">{codes.length} 个</span>
          </div>
          <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCode(input); }}
              placeholder="加自选: SC2610 IM2609"
              className="min-w-0 flex-1 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-sm outline-none focus:border-primary/50"
            />
            <button
              type="button"
              onClick={() => addCode(input)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary/15 px-2.5 py-1.5 text-xs font-medium text-primary btn-press ring-1 ring-primary/20 hover:bg-primary/25"
            >
              <Plus className="h-3.5 w-3.5" /> 添加
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              title="搜索合约"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
          {hint ? <p className="px-3 py-1.5 text-[11px] text-muted-foreground">{hint}</p> : null}
          <div ref={listRef} className="min-h-[320px] flex-1 space-y-0.5 overflow-auto p-2">
            {codes.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <p className="text-xs text-muted-foreground">还没有自选合约</p>
                <p className="text-[11px] text-muted-foreground/60">
                  在上方输入合约代码添加，或从「期权驾驶舱」点品种跳转过来。
                </p>
              </div>
            ) : codes.map((x) => {
              const q = quotes[x.c];
              const pct = q?.pre_close ? ((q.close - q.pre_close) / q.pre_close) * 100 : null;
              const active = x.c === selected;
              return (
                <button
                  key={x.c}
                  type="button"
                  data-code={x.c}
                  onClick={() => setSelected(x.c)}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    active ? "bg-primary/15 text-foreground ring-1 ring-primary/20" : "hover:bg-muted/40",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-semibold tabular-nums">{x.c}</span>
                      <span className="truncate text-[11px] text-muted-foreground">{x.n}</span>
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-2 tabular-nums text-xs">
                      <span>{fmtPrice(q?.close)}</span>
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
                    onClick={(e) => remove(x.c, e)}
                    onKeyDown={(e) => { if (e.key === "Enter") remove(x.c); }}
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
                  {selName || selected || "—"}{" "}
                  <span className="text-sm font-medium text-muted-foreground">{selName ? selected : ""}</span>
                </span>
                <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {resolution === "1D" ? "日K" : resolution === "5" ? "5日" : "分时"}
                </span>
                <span className={cn(
                  "rounded px-1.5 py-0.5 text-[10px]",
                  slotHover ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground",
                )}>
                  {slotHover ? "十字光标" : "最新"}
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
                  onClick={() => { if (selected) void loadChart(selected, resolution, true); }}
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
                    <p className="text-sm text-muted-foreground">先选一个合约看 K 线</p>
                    <p className="max-w-xs text-[11px] text-muted-foreground/60">
                      从左侧自选点选，或在上方添加合约代码。驾驶舱品种点过来也会落到这里。
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
            </div>
            {!selected ? (
              <div className="flex flex-col items-center gap-1.5 px-3 py-10 text-center">
                <p className="text-xs text-muted-foreground/65">从左侧自选点一个</p>
                <p className="text-[11px] text-muted-foreground/50">看合约行情与隐波快照</p>
              </div>
            ) : (
              <div className="flex-1 space-y-3 overflow-auto p-3">
                <div>
                  <p className="truncate text-sm font-semibold">
                    {selName || "—"}
                    <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">{selected}</span>
                  </p>
                  {bar?.datetime ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtBarTime(bar.datetime)}</p>
                  ) : null}
                  <p className={cn(
                    "mt-2 font-mono text-2xl font-bold tabular-nums",
                    quoteChgPct != null && quoteChgPct > 0 ? "text-danger" : quoteChgPct != null && quoteChgPct < 0 ? "text-success" : "text-foreground",
                  )}>
                    {fmtPrice(emptyHover ? null : (bar?.close ?? selQuote?.close))}
                  </p>
                  <p className={cn(
                    "mt-0.5 text-sm tabular-nums",
                    quoteChgPct != null && quoteChgPct > 0 ? "text-danger" : quoteChgPct != null && quoteChgPct < 0 ? "text-success" : "text-muted-foreground",
                  )}>
                    {quoteChgAmt != null && Number.isFinite(quoteChgAmt)
                      ? `${quoteChgAmt > 0 ? "+" : ""}${quoteChgAmt.toFixed(2)}`
                      : "—"}
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
                        { k: "昨结", v: fmtPrice(base ?? selQuote?.pre_close) },
                      ]
                    : bar
                      ? [
                          { k: "价", v: fmtPrice(bar.close) },
                          { k: "量", v: fmtVol(bar.volume) },
                          { k: "持仓", v: fmtVol(bar.oi) },
                          { k: "昨结", v: fmtPrice(preClose ?? selQuote?.pre_close) },
                        ]
                      : [
                          { k: "最新", v: fmtPrice(selQuote?.close) },
                          { k: "昨结", v: fmtPrice(selQuote?.pre_close) },
                          { k: "涨跌%", v: fmtPct(quoteChgPct) },
                        ]
                  ).map((m) => (
                    <div key={m.k} className="rounded-lg bg-muted/25 px-2.5 py-2">
                      <p className="text-[10px] text-muted-foreground">{m.k}</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{m.v}</p>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border/40 pt-3">
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">隐波 / 持仓快照</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      { k: "ATM隐波", v: curAtm != null ? `${curAtm.toFixed(1)}%` : "—" },
                      { k: "持仓量", v: fmtVol(bar?.oi ?? selQuote?.oi) },
                      { k: "昨结", v: fmtPrice(preClose ?? selQuote?.pre_close) },
                      { k: "前周结", v: fmtPrice(selQuote?.pre_close_1w != null ? Number(selQuote.pre_close_1w) : null) },
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

      {pickerOpen && (
        <SymbolPicker
          onSelect={(c, n) => { setPickerOpen(false); addCode(c, n); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
