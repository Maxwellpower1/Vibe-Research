import { useState, useEffect, useCallback, useRef } from "react";
import * as echarts from "echarts";
import { AlertCircle, Loader2, Search, X } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, ApiError, type OvlabSearchItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  AutoRefreshBar, TREND_GREEN, TREND_PINK, TREND_RED, useAutoRefresh,
} from "@/components/ovlab/shared";

export const RESOLUTIONS = [
  { v: "1", label: "分时" }, { v: "5", label: "5日" }, { v: "1D", label: "日线" },
];

// —— 合约搜索选择弹窗 ——
export function SymbolPicker({ onSelect, onClose }: { onSelect: (s: string) => void; onClose: () => void }) {
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
            <button key={(r.ticker ?? "") + i} onClick={() => r.ticker && onSelect(r.ticker)}
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

export function LightChartPanel({ initialSymbol }: { initialSymbol?: string } = {}) {
  const [symbol, setSymbol] = useState(initialSymbol || "SC2609");
  useEffect(() => { if (initialSymbol) setSymbol(initialSymbol); }, [initialSymbol]);
  const [resolution, setResolution] = useState("1D");
  const [kline, setKline] = useState<Array<[string, number, number, number, number]>>([]);
  const [atmvol, setAtmvol] = useState<Array<[string, number]>>([]);
  const [vols, setVols] = useState<Array<number | null>>([]);
  const [ois, setOis] = useState<Array<number | null>>([]);
  const [lastBar, setLastBar] = useState<Record<string, unknown> | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Guard against out-of-order responses when switching 分时/5日/日线 quickly
  const loadSeq = useRef(0);
  // Per-symbol / per-resolution memory cache: switch tabs instantly (like old 分时→日线 feel), then refresh
  type ChartCache = {
    kline: Array<[string, number, number, number, number]>;
    atmvol: Array<[string, number]>;
    vols: Array<number | null>;
    ois: Array<number | null>;
    lastBar: Record<string, unknown> | null;
  };
  const chartCache = useRef<Record<string, ChartCache>>({});
  const cacheKey = (sym: string, res: string) => `${sym}::${res}`;

  const applyCache = useCallback((hit: ChartCache) => {
    setKline(hit.kline);
    setAtmvol(hit.atmvol);
    setVols(hit.vols);
    setOis(hit.ois);
    setLastBar(hit.lastBar);
    setHoverIdx(null);
    setErr(null);
  }, []);

  /** force=true: always hit network (查询按钮); force=false: reuse cache if this period was loaded */
  const load = useCallback(async (force = false) => {
    const sym = symbol.trim();
    const res = resolution;
    if (!sym) return;
    const key = cacheKey(sym, res);
    const hit = chartCache.current[key];
    if (!force && hit) {
      applyCache(hit);
      setLoading(false);
      return;
    }
    const seq = ++loadSeq.current;
    if (hit) applyCache(hit); // keep showing old while refreshing
    else {
      setKline([]); setAtmvol([]); setVols([]); setOis([]); setHoverIdx(null); setLastBar(null);
    }
    setLoading(true); setErr(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      // 分时(1): 当日0点前推6h 覆盖夜盘; 5日(5): ~10自然日; 日线(1D): 1年前
      const from = res === "1"
        ? Math.floor(new Date().setHours(0, 0, 0, 0) / 1000) - 6 * 3600
        : res === "5" ? now - 10 * 86400 : now - 365 * 86400;
      const [kl, av] = await Promise.all([
        api.ovlabKlineHistory(sym, res, from, now),
        api.ovlabAtmvolHistory(sym, res, from, now),
      ]);
      if (seq !== loadSeq.current) return;
      // echarts K 线格式: [date, open, close, low, high]
      let bars: Array<[string, number, number, number, number]>;
      let volArr: Array<number | null>;
      let oiArr: Array<number | null>;
      // api unwraps {data: upstream}; upstream is usually {data: rows}
      const klRows = Array.isArray(kl) ? kl : (Array.isArray((kl as { data?: unknown })?.data) ? (kl as { data: unknown[] }).data : []);
      const avRows = Array.isArray(av) ? av : (Array.isArray((av as { data?: unknown })?.data) ? (av as { data: unknown[] }).data : []);
      if (res === "1D") {
        // 日线: 对象格式 {trade_date, open, close, low, high, vol, oi}
        bars = klRows.map((b: any) => [
          String(b.trade_date ?? ""),
          Number(b.open ?? 0), Number(b.close ?? 0),
          Number(b.low ?? 0), Number(b.high ?? 0),
        ] as [string, number, number, number, number]);
        volArr = klRows.map((b: any) => { const v = Number(b.vol); return Number.isFinite(v) && v > 0 ? v : null; });
        oiArr = klRows.map((b: any) => { const v = Number(b.oi); return Number.isFinite(v) && v > 0 ? v : null; });
      } else {
        // 分时/5日: 数组格式 [datetime, price, pct, volume, open, high, low, oi]
        bars = klRows.map((b: any) => [
          String(b[0] ?? ""),
          Number(b[4] ?? 0), Number(b[1] ?? 0),
          Number(b[6] ?? 0), Number(b[5] ?? 0),
        ] as [string, number, number, number, number]);
        volArr = klRows.map((b: any) => { const v = Number(b[3]); return Number.isFinite(v) && v > 0 ? v : null; });
        oiArr = klRows.map((b: any) => { const v = Number(b[7]); return Number.isFinite(v) && v > 0 ? v : null; });
      }
      const atm = avRows.map((a: any) => {
        let d = String(Array.isArray(a) ? a[0] : "");
        if (res === "1D") d = d.replace(/-/g, "");
        return [d, Number(Array.isArray(a) ? a[1] : NaN)] as [string, number];
      });
      let lb: Record<string, unknown> | null = null;
      try { lb = (await api.ovlabLastBar(sym)) ?? null; } catch { lb = null; }
      if (seq !== loadSeq.current) return;
      const packed: ChartCache = { kline: bars, atmvol: atm, vols: volArr, ois: oiArr, lastBar: lb };
      chartCache.current[key] = packed;
      applyCache(packed);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setErr(e instanceof ApiError ? e.message : "加载失败");
      if (!chartCache.current[key]) {
        setKline([]); setAtmvol([]); setVols([]); setOis([]); setLastBar(null);
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [symbol, resolution, applyCache]);

  // Auto-refresh (if enabled) always hits network; tab switch uses cache
  const hardLoad = useCallback(async () => { await load(true); }, [load]);
  const { auto, setAuto, ms, setMs, lastUpdate } = useAutoRefresh(hardLoad, { defaultOn: false, defaultMs: 60000 });

  // Tab switch: show cache if any, fetch only on cache miss. Symbol change clears cache.
  const prevSym = useRef(symbol);
  useEffect(() => {
    if (prevSym.current.trim() !== symbol.trim()) {
      chartCache.current = {};
      prevSym.current = symbol;
    }
    void load(false);
  }, [symbol, resolution, load]);

  // 查询按钮: force network refresh for current period
  const refresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); };

  // K 线 + 隐波双图
  const chartRef = useRef<HTMLDivElement>(null);
  const echartRef = useRef<echarts.ECharts | null>(null);
  const klineRef = useRef(kline);
  klineRef.current = kline;

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    echartRef.current = chart;

    const resolveIdxFromAxis = (params: {
      currTrigger?: string;
      axesInfo?: Array<{
        axisDim?: string;
        axisIndex?: number;
        value?: unknown;
        seriesDataIndices?: Array<{ dataIndex?: number }>;
      }>;
    }): number | null => {
      if (params?.currTrigger === "leave") return null;
      const axes = params?.axesInfo ?? [];
      const xAxis = axes.find((a) => a.axisDim === "x") ?? axes[0];
      if (!xAxis) return null;
      const fromSeries = xAxis.seriesDataIndices?.find((s) => Number.isInteger(s?.dataIndex));
      if (fromSeries && Number.isInteger(fromSeries.dataIndex)) return fromSeries.dataIndex as number;
      const val = xAxis.value;
      const bars = klineRef.current;
      if (typeof val === "number" && Number.isInteger(val) && val >= 0 && val < bars.length) return val;
      if (val != null) {
        const i = bars.findIndex((b) => b[0] === String(val));
        if (i >= 0) return i;
      }
      return null;
    };

    // Primary: axisPointer (crosshair) drives the header row
    chart.on("updateAxisPointer", (params) => {
      setHoverIdx(resolveIdxFromAxis(params as Parameters<typeof resolveIdxFromAxis>[0]));
    });

    // Fallback: pixel -> category index (works even when seriesDataIndices is empty)
    const zr = chart.getZr();
    const onMove = (e: { offsetX: number; offsetY: number }) => {
      const point: [number, number] = [e.offsetX, e.offsetY];
      try {
        const inMain = chart.containPixel({ gridIndex: 0 }, point);
        const inVol = chart.containPixel({ gridIndex: 1 }, point);
        if (!inMain && !inVol) return;
        const data = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, point);
        const xVal = Array.isArray(data) ? data[0] : data;
        const di = Math.round(Number(xVal));
        const n = klineRef.current.length;
        if (Number.isFinite(di) && di >= 0 && di < n) setHoverIdx(di);
      } catch {
        /* ignore convert errors during dispose / empty option */
      }
    };
    const onOut = () => setHoverIdx(null);
    zr.on("mousemove", onMove);
    zr.on("globalout", onOut);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(chartRef.current);
    return () => {
      zr.off("mousemove", onMove);
      zr.off("globalout", onOut);
      ro.disconnect();
      chart.dispose();
      echartRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!echartRef.current) return;
    const upColor = TREND_RED, downColor = TREND_GREEN; // A股红涨绿跌
    const dates = kline.map((b) => b[0]);
    // 隐波按 K 线日期对齐, 缺失用前一个有效值填充 (forward fill)
    const avMap = new Map<string, number>();
    atmvol.forEach((a) => avMap.set(a[0], a[1]));
    let prevAv: number | null = null;
    const avAligned = dates.map((d) => {
      const v = avMap.has(d) ? avMap.get(d)! : null;
      if (v != null) prevAv = v;
      return prevAv;
    });
    // 成交量柱: 按 K 线涨跌着色 (close>=open 红色 else 绿色)
    const volData = vols.map((v, i) => ({
      value: v,
      itemStyle: { color: kline[i] && kline[i][2] >= kline[i][1] ? upColor : downColor },
    }));
    const volSeries = {
      name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 2, z: 1,
      data: volData,
      emphasis: { focus: "none" },
      blur: { itemStyle: { opacity: 1 } },
    };
    const oiSeries = {
      name: "持仓量", type: "line", xAxisIndex: 1, yAxisIndex: 2, z: 5,
      data: ois,
      connectNulls: false,
      showSymbol: false, lineStyle: { width: 1.3, color: "#eab308" },
      emphasis: { focus: "none" },
      blur: { lineStyle: { opacity: 1 }, itemStyle: { opacity: 1 } },
    };
    const atmvolSeries = {
      name: "ATM隐波", type: "line", yAxisIndex: 1, z: 5,
      data: avAligned,
      connectNulls: false,
      showSymbol: false, lineStyle: { width: 1.5, color: TREND_PINK },
      emphasis: { focus: "none" },
      blur: { lineStyle: { opacity: 1 }, itemStyle: { opacity: 1 } },
    };

    // 分时/5日: same visual model as TrendSparkSvg (走势预览)
    // - zero axis = first print
    // - one area path closed to zero, clipped red above / green below
    // - no visualMap / areaStyle.origin (echarts getVisualGradient crash)
    const priceVals = kline.map((b) => b[2]);
    const finitePx = priceVals.filter((v) => Number.isFinite(v));
    const baseline = finitePx[0] ?? 0;
    const pMin = finitePx.length ? Math.min(...finitePx, baseline) : baseline;
    const pMax = finitePx.length ? Math.max(...finitePx, baseline) : baseline;
    const pPad = (pMax - pMin) * 0.06 || Math.abs(baseline) * 0.002 || 1;

    // Canvas cannot resolve CSS vars like hsl(var(--x)); resolve to concrete colors
    const cssHsl = (name: string, fallback: string) => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return raw ? `hsl(${raw})` : fallback;
    };
    const cText = cssHsl("--chart-text", "#94a3b8");
    const cAxis = cssHsl("--chart-axis", "#475569");
    const cGrid = cssHsl("--chart-grid", "#334155");
    const cPtr = cssHsl("--primary", "#22d3ee");

    if (dates.length === 0) {
      echartRef.current.clear();
      return;
    }

    // Draw once for the visible window (dataIndexInside===0).
    // Must NOT key off dataIndex===0: when zoomed, index 0 is culled and the line vanishes.
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
        // Contiguous visible indices under category dataZoom
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

        // Zero axis y in screen space (baseline = first print of full series)
        const zRef = api.coord([i0, baseline]);
        if (!zRef || !Number.isFinite(zRef[1])) return undefined;
        const zeroY = zRef[1];
        const upH = Math.max(0, zeroY - cs.y);
        const dnH = Math.max(0, cs.y + cs.height - zeroY);

        // Gradients match TrendSparkSvg: fade toward zero axis
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
                { type: "polyline", shape: { points: linePts }, style: { stroke: TREND_RED, lineWidth: 1.5, fill: "none", lineJoin: "round", lineCap: "round" } },
              ],
            },
            {
              type: "group",
              clipPath: { type: "rect", shape: { x: cs.x, y: zeroY, width: cs.width, height: dnH } },
              children: [
                { type: "polygon", shape: { points: areaPts }, style: { fill: gradDn } },
                { type: "polyline", shape: { points: linePts }, style: { stroke: TREND_GREEN, lineWidth: 1.5, fill: "none", lineJoin: "round", lineCap: "round" } },
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

    echartRef.current.setOption({
      backgroundColor: "transparent",
      animation: false,
      legend: {
        show: true,
        orient: "horizontal",
        left: "right",
        top: 6,
        itemWidth: 14,
        itemHeight: 8,
        itemGap: 14,
        textStyle: { color: cText, fontSize: 10 },
        icon: "roundRect",
        data: resolution === "1D" ? ["K线", "ATM隐波", "成交量", "持仓量"] : ["价格", "ATM隐波", "成交量", "持仓量"],
      },
      grid: [
        { left: 64, right: 64, top: 30, height: "52%" },
        { left: 64, right: 64, top: "68%", height: "22%" },
      ],
      xAxis: [
        { type: "category", data: dates, scale: true, boundaryGap: false,
          axisLine: { lineStyle: { color: cAxis } },
          axisLabel: { color: cText, fontSize: 10,
            formatter: (v: string) => {
              if (resolution === "1D") return v.length === 8 ? v.slice(4, 6) + "-" + v.slice(6) : v;
              const m = v.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
              return m ? `${m[2]}-${m[3]} ${m[4]}` : v;
            } },
          splitLine: { show: false },
          axisPointer: { label: { show: true, backgroundColor: cPtr, color: "#fff", borderColor: cPtr } },
        },
        { type: "category", gridIndex: 1, data: dates, scale: true, boundaryGap: false,
          axisLabel: { show: false },
          axisLine: { lineStyle: { color: cAxis } },
          splitLine: { show: false },
          axisPointer: { label: { show: false } },
        },
      ],
      yAxis: [
        resolution === "1D" ? {
          scale: true,
          splitLine: { lineStyle: { color: cGrid, opacity: 0.25, width: 1 } },
          axisLabel: { color: cText, fontSize: 10, formatter: (v: number) => Number(v.toFixed(2)).toString() },
          axisPointer: {
            label: {
              show: true, backgroundColor: cPtr, color: "#fff",
              formatter: (p: { value: number | string }) => Number(Number(p.value).toFixed(2)).toLocaleString("zh-CN"),
            },
          },
        } : {
          // Tight scale like TrendSparkSvg (min/max of series + zero), not forced mid-axis symmetry
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
          splitLine: { show: false },
          axisLabel: { color: TREND_PINK, fontSize: 10, formatter: (v: number) => Number(v.toFixed(1)) + "%" },
          axisPointer: {
            label: {
              show: true, backgroundColor: TREND_PINK, color: "#fff",
              formatter: (p: { value: number | string }) => Number(Number(p.value).toFixed(1)) + "%",
            },
          },
        },
        {
          scale: true,
          gridIndex: 1,
          min: (v: { min?: number }) => { const mn = v.min ?? 0; return mn > 0 ? Math.floor(mn * 0.9) : 0; },
          splitLine: { show: false },
          axisLabel: { color: cText, fontSize: 9, formatter: (v: number) => Number(v.toFixed(0)).toLocaleString("zh-CN") },
          axisPointer: { label: { show: false } },
        },
      ],
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      dataZoom: [
        // 分时/5日看全貌; 日线默认落在近端 40%
        { type: "inside", xAxisIndex: [0, 1], start: (resolution === "1" || resolution === "5") ? 0 : 60, end: 100 },
        {
          type: "slider", xAxisIndex: [0, 1], bottom: 6, height: 16,
          textStyle: { fontSize: 9, color: cText },
          borderColor: cAxis,
          fillerColor: "rgba(34,211,238,0.15)",
          handleStyle: { color: cPtr },
          moveHandleStyle: { color: cPtr },
          dataBackground: { lineStyle: { color: cAxis }, areaStyle: { color: "rgba(148,163,184,0.15)" } },
          selectedDataBackground: { lineStyle: { color: cPtr }, areaStyle: { color: "rgba(34,211,238,0.12)" } },
        },
      ],
      tooltip: {
        trigger: "axis",
        showContent: false,
        axisPointer: {
          type: "cross",
          crossStyle: { color: cAxis, width: 1, type: "dashed" },
          label: { show: false },
        },
      },
      series: resolution === "1D" ? [
        {
          name: "K线", type: "candlestick", yAxisIndex: 0, z: 2,
          data: kline.map((b) => [b[1], b[2], b[3], b[4]]),
          itemStyle: { color: upColor, color0: downColor, borderColor: upColor, borderColor0: downColor },
          emphasis: { focus: "none" },
          blur: { itemStyle: { opacity: 1 } },
        },
        atmvolSeries, volSeries, oiSeries,
      ] : [
        trendPaintSeries,
        // Invisible price series: legend + axisPointer values (paint is done by custom series)
        {
          name: "价格", type: "line", yAxisIndex: 0, z: 1,
          data: priceVals,
          showSymbol: false,
          lineStyle: { width: 0, opacity: 0 },
          emphasis: { focus: "none" },
          blur: { lineStyle: { opacity: 0 } },
        },
        atmvolSeries, volSeries, oiSeries,
      ],
    }, { notMerge: true });
  }, [kline, atmvol, vols, ois, resolution]);

  // hover: show bar under crosshair; leave chart: fall back to lastBar
  const hv = hoverIdx != null ? kline[hoverIdx] : undefined;
  const hoverPreClose = (() => {
    if (hoverIdx == null || !hv) return null;
    // 日线: vs prev bar; 分时/5日: vs session pre_close from lastBar (same as realtime row)
    if (resolution === "1D") {
      return hoverIdx > 0 ? kline[hoverIdx - 1][2] : null;
    }
    const pc = lastBar?.["pre_close"];
    if (pc != null && Number.isFinite(Number(pc))) return Number(pc);
    return hoverIdx > 0 ? kline[hoverIdx - 1][2] : null;
  })();
  const lb: Record<string, unknown> | null = hv ? {
    close: hv[2], open: hv[1], high: hv[4], low: hv[3],
    oi: ois[hoverIdx!], vol: vols[hoverIdx!], trade_date: hv[0],
    pre_close: hoverPreClose,
  } : lastBar;
  // Round first to kill binary float residue (e.g. 2699.9999999995)
  const fmtN = (v: unknown, d = 2) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return Number(n.toFixed(d)).toLocaleString("zh-CN", { maximumFractionDigits: d });
  };
  const fmtHoverTime = (raw: unknown) => {
    const s = String(raw ?? "");
    if (!s) return "";
    if (resolution === "1D") {
      // YYYYMMDD or YYYY-MM-DD
      const d = s.replace(/-/g, "");
      return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : s;
    }
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/);
    return m ? `${m[2]}-${m[3]} ${m[4]}` : s;
  };
  const chg = lb && lb["close"] != null && lb["pre_close"] != null
    ? Number(lb["close"]) - Number(lb["pre_close"]) : null;
  const chgPct = chg != null && lb && Number(lb["pre_close"]) !== 0
    ? (chg! / Number(lb["pre_close"])) * 100 : null;

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); void refresh(); }} className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">合约代码</label>
          <div className="flex gap-1">
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="如 SC2609 / 510300 / MA"
              className="w-44 field-input" />
            <button type="button" onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2 text-sm hover:bg-muted/50">
              <Search className="h-3.5 w-3.5" /> 选择
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">周期</label>
          <div className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
            {RESOLUTIONS.map((r) => (
              <button key={r.v} type="button" onClick={() => setResolution(r.v)}
                className={cn("rounded-md px-2.5 py-1.5 text-xs", resolution === r.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" disabled={loading || refreshing || !symbol.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {loading || refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} 查询
        </button>
      </form>

      {pickerOpen && (
        <SymbolPicker
          onSelect={(s) => { setSymbol(s); setPickerOpen(false); void refresh(); }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <AutoRefreshBar auto={auto} setAuto={setAuto} ms={ms} setMs={setMs} lastUpdate={lastUpdate} onRefresh={refresh} refreshing={refreshing || loading} />

      {err ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" /> {err}</div>
      ) : (
        <div className="mt-3 space-y-3">
          {lb && (
            <GlassCard>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
                {hv ? (
                  <div className="tabular-nums text-muted-foreground">
                    <span className="text-[11px]">时间</span>{" "}
                    <b className="ml-1 text-foreground">{fmtHoverTime(lb["trade_date"])}</b>
                  </div>
                ) : null}
                <div>
                  <span className="text-muted-foreground">{hv ? "价格" : "最新价"}</span>{" "}
                  <b className="ml-1.5 tabular-nums text-lg text-primary">{fmtN(lb["close"])}</b>
                </div>
                <div className={cn("tabular-nums", chg != null && (chg > 0 ? "text-red-500" : chg < 0 ? "text-emerald-500" : ""))}>
                  {chg != null ? (chg > 0 ? "+" : "") + chg.toFixed(2) : "-"}
                  <span className="ml-1.5 text-xs">({chgPct != null ? (chgPct > 0 ? "+" : "") + chgPct.toFixed(2) + "%" : "-"})</span>
                </div>
                {hv && resolution === "1D" ? (
                  <div className="text-xs tabular-nums text-muted-foreground">
                    开 {fmtN(lb["open"])} · 高 {fmtN(lb["high"])} · 低 {fmtN(lb["low"])}
                  </div>
                ) : null}
                <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[10px]", hv ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground")}>
                  {hv ? "十字光标" : "实时"}
                </span>
              </div>
            </GlassCard>
          )}
          <GlassCard>
            <div ref={chartRef} className="h-[520px] w-full" />
          </GlassCard>
        </div>
      )}
    </div>
  );
}

// —— T 型报价 (dto 期权链) ——

