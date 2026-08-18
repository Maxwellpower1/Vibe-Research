import { useState, useEffect, useCallback, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, CircleHelp, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";
import { derivSessionIdx, derivSessionSpan, kindOfUnd } from "@/lib/derivMinuteAxis";
import type { OvlabMarketRow, OvlabPriceVolSeriesItem } from "@/lib/api";

export function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
}

/** Remaining calendar days until expiry_date (YYYYMMDD or YYYY-MM-DD). Today = 0. */
export function daysToExpiry(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  if (/^\d{8}$/.test(s)) {
    y = Number(s.slice(0, 4)); m = Number(s.slice(4, 6)); d = Number(s.slice(6, 8));
  } else if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    y = Number(s.slice(0, 4)); m = Number(s.slice(5, 7)); d = Number(s.slice(8, 10));
  } else {
    return null;
  }
  if (!y || !m || !d) return null;
  const exp = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}

// —— 通用排序: 数值优先, 否则字符串. null/缺失排末尾 ——
export type SortState<T> = { key: keyof T | null; dir: "asc" | "desc" };

export function sortRows<T extends Record<string, unknown>>(rows: T[], sort: SortState<T>): T[] {
  if (!sort.key) return rows;
  const { key, dir } = sort;
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const an = num(a[key]), bn = num(b[key]);
    if (an !== null && bn !== null) return (an - bn) * mul;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    return String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * mul;
  });
}

export function nextSort<T>(cur: SortState<T>, key: keyof T): SortState<T> {
  if (cur.key !== key) return { key, dir: "desc" };
  if (cur.dir === "desc") return { key, dir: "asc" };
  return { key: null, dir: "desc" };
}

// —— 自动刷新 hook: 开关 + 间隔, 页面隐藏时暂停, 切回时立即刷新 ——
export function useAutoRefresh(load: () => Promise<void>, opts: { defaultOn?: boolean; defaultMs?: number } = {}) {
  const { defaultOn = true, defaultMs = 60000 } = opts;
  const [auto, setAuto] = useState(defaultOn);
  const [ms, setMs] = useState(defaultMs);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const doLoad = useCallback(async () => {
    await loadRef.current();
    setLastUpdate(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
  }, []);

  useEffect(() => {
    if (!auto) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (id) clearInterval(id); id = setInterval(() => void doLoad(), ms); };
    const onVis = () => {
      if (document.hidden) { if (id) { clearInterval(id); id = null; } }
      else { void doLoad(); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => { if (id) clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [auto, ms, doLoad]);

  return { auto, setAuto, ms, setMs, lastUpdate, doLoad };
}

export const INTERVALS = [
  { v: 30000, label: "30s" },
  { v: 60000, label: "1m" },
  { v: 120000, label: "2m" },
  { v: 300000, label: "5m" },
];

export function AutoRefreshBar({ auto, setAuto, ms, setMs, lastUpdate, onRefresh, refreshing }: {
  auto: boolean; setAuto: (v: boolean) => void;
  ms: number; setMs: (v: number) => void;
  lastUpdate: string | null; onRefresh: () => void; refreshing: boolean;
}) {
  // Keep interval select (Ovlab-specific); visual chrome matches FreshnessBar.
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <button
        type="button"
        onClick={() => setAuto(!auto)}
        className={cn(
          "btn-press inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5",
          auto
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground",
        )}
        title={auto ? "自动刷新开启中, 点击关闭" : "点击开启自动刷新"}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", auto ? "bg-primary animate-pulse" : "bg-muted-foreground/40")} />
        {auto ? "自动" : "手动"}
      </button>
      {auto && (
        <select
          value={ms}
          onChange={(e) => setMs(Number(e.target.value))}
          className="field-input !px-2 !py-1.5 text-xs"
          title="自动刷新间隔"
        >
          {INTERVALS.map((i) => <option key={i.v} value={i.v}>{i.label}</option>)}
        </select>
      )}
      {lastUpdate && (
        <span className="font-mono tabular-nums text-muted-foreground/70">
          <span className="text-muted-foreground/45">更新 </span>{lastUpdate}
        </span>
      )}
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="btn-press inline-flex items-center gap-1 rounded-lg border border-border/50 px-2 py-1 text-muted-foreground hover:bg-muted/40 hover:text-primary disabled:opacity-50"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        {refreshing ? "刷新中" : "刷新"}
      </button>
    </div>
  );
}

// —— 结构化渲染辅助: dto 视图 ——

export function fmt(v: unknown, digits = 2): string {
  const n = num(v);
  if (n === null) return "-";
  return n.toFixed(digits);
}

export function fmtInt(v: unknown): string {
  const n = num(v);
  if (n === null) return "-";
  return Math.round(n).toLocaleString("en-US");
}

// —— dto 结构化视图 ——
export interface DtoData {
  headline?: string | null;
  isDelayed?: boolean;
  requiresAgreement?: boolean;
  events?: { earnings?: unknown[]; dividends?: unknown[]; splits?: unknown[] };
  context?: {
    r?: Record<string, number>;
    i?: {
      s?: { tz?: string; r?: string; p?: string; a?: string }[];
      i?: { n?: string; s?: string; l?: number; p?: number; b?: number; a?: number; v?: number; ua?: string; x?: number; t?: number }[];
      c?: Record<string, unknown>;
    };
  };
}

export const RV_PERIODS = ["1d", "7d", "14d", "30d", "91d", "183d", "274d", "365d"];

export function DtoView({ data }: { data: DtoData }) {
  const ctx = data.context;
  const info = ctx?.i?.i?.[0];
  const sess = ctx?.i?.s?.[0];
  const rv = ctx?.r || {};
  const contracts = ctx?.i?.c;
  const events = data.events || {};
  const hasEvents = (events.earnings?.length || events.dividends?.length || events.splits?.length || 0) > 0;

  return (
    <div className="space-y-4">
      {info && (
        <GlassCard>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div className="text-base font-bold">{info.n || "-"}</div>
            <div className="text-sm text-muted-foreground">{info.s}</div>
            {info.l != null && <div className="text-sm">现价 <b className="tabular-nums">{fmt(info.l)}</b></div>}
            {info.p != null && <div className="text-xs text-muted-foreground">昨收 {fmt(info.p)}</div>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            {info.b != null && <div><span className="text-muted-foreground">买价:</span> <b className="tabular-nums">{fmt(info.b)}</b></div>}
            {info.a != null && <div><span className="text-muted-foreground">卖价:</span> <b className="tabular-nums">{fmt(info.a)}</b></div>}
            {info.v != null && <div><span className="text-muted-foreground">成交量:</span> <b className="tabular-nums">{fmtInt(info.v)}</b></div>}
            {info.x != null && <div><span className="text-muted-foreground">乘数:</span> <b className="tabular-nums">{fmtInt(info.x)}</b></div>}
          </div>
          {info.ua && <div className="mt-2 text-[11px] text-muted-foreground/60">更新于 {info.ua}</div>}
        </GlassCard>
      )}

      {Object.keys(rv).length > 0 && (
        <GlassCard>
          <h3 className="mb-3 text-sm font-bold">实现波动率 (Realized Vol)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>{RV_PERIODS.map((p) => <th key={p} className="px-3 py-1.5 text-right font-medium">{p}</th>)}</tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/40">
                  {RV_PERIODS.map((p) => {
                    const v = num(rv[p]);
                    return <td key={p} className="px-3 py-1.5 text-right tabular-nums">{v !== null ? (v * 100).toFixed(2) + "%" : "-"}</td>;
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {sess && (
        <GlassCard>
          <h3 className="mb-2 text-sm font-bold">交易时段</h3>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            {sess.tz && <div><span className="text-muted-foreground">时区:</span> {sess.tz}</div>}
            {sess.r && <div><span className="text-muted-foreground">交易:</span> {sess.r}</div>}
            {sess.p && <div><span className="text-muted-foreground">集合竞价:</span> {sess.p}</div>}
            {sess.a && <div><span className="text-muted-foreground">收盘集合竞价:</span> {sess.a}</div>}
          </div>
        </GlassCard>
      )}

      {hasEvents && (
        <GlassCard>
          <h3 className="mb-2 text-sm font-bold">事件</h3>
          <div className="space-y-2 text-xs">
            {events.earnings?.length ? <div><span className="text-muted-foreground">财报:</span> {events.earnings.length} 条</div> : null}
            {events.dividends?.length ? <div><span className="text-muted-foreground">分红:</span> {events.dividends.length} 条</div> : null}
            {events.splits?.length ? <div><span className="text-muted-foreground">拆分:</span> {events.splits.length} 条</div> : null}
          </div>
        </GlassCard>
      )}

      {contracts && Object.keys(contracts).length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-bold text-muted-foreground hover:text-foreground">
            期权链原始数据 (按合约月份 × 行权价分组, {Object.keys(contracts).length} 个标的)
          </summary>
          <div className="mt-2">
            <GlassCard>
              <pre className="max-h-[50vh] overflow-auto text-xs leading-relaxed text-foreground/90">{JSON.stringify(contracts, null, 2)}</pre>
            </GlassCard>
          </div>
        </details>
      )}
    </div>
  );
}

// 可排序表头; 有 title 说明时末尾带圈问号
export function SortableTh<T extends Record<string, unknown>>({ col, sort, onSort, large }: {
  col: { key: keyof T; label: string; cls?: string; sortable?: boolean; title?: string };
  sort: SortState<T>; onSort: (key: keyof T) => void;
  large?: boolean;
}) {
  const active = sort.key === col.key;
  const iconCls = large ? "h-3.5 w-3.5" : "h-3 w-3";
  const helpCls = large ? "h-3.5 w-3.5" : "h-3 w-3";
  return (
    <th
      title={col.title}
      onClick={col.sortable ? () => onSort(col.key) : undefined}
      className={cn(
        col.cls?.includes("text-right") && "num",
        col.sortable && "cursor-pointer select-none hover:text-foreground",
        active && "sort-active text-primary",
      )}
    >
      <span className="inline-flex items-center gap-1">
        {col.label}
        {col.title ? (
          <CircleHelp
            className={cn(helpCls, "shrink-0 text-muted-foreground/70", active && "text-primary/70")}
            aria-label="字段说明"
          />
        ) : null}
        {col.sortable && (
          active
            ? (sort.dir === "asc" ? <ArrowUp className={iconCls} /> : <ArrowDown className={iconCls} />)
            : <ArrowUpDown className={cn(iconCls, "opacity-30")} />
        )}
      </span>
    </th>
  );
}

// —— 走势配色: 驾驶舱与全市场表共用 ——

export const TREND_RED = "#ef4444";
export const TREND_GREEN = "#22c55e";
export const TREND_IV = "#a78bfa";

// A股 MinuteSpark 柔和配色: 分时 spark 与 /a-share 视觉对齐
export const SPARK_UP = "#fda4af";
export const SPARK_DOWN = "#6ee7b7";
export const SPARK_FLAT = "#cbd5e1";
export const SPARK_BASE = "#94a3b8";

/** Derive prev close/settle from price & ctn (涨跌幅%). Null when either missing. */
export function prevCloseOf(r: Pick<OvlabMarketRow, "price" | "ctn">): number | null {
  const p = num(r.price);
  const c = num(r.ctn);
  if (p === null || c === null || c <= -100) return null;
  const base = p / (1 + c / 100);
  return Number.isFinite(base) && base > 0 ? base : null;
}

// —— 走势预览 / 涨跌胶囊 / 百分位条: 驾驶舱与全市场表共用 ——

/** Build OpenVlab preview code: prodUnd:exp (e.g. MA:202609) */
export function previewCode(r: Pick<OvlabMarketRow, "prodUnd" | "exp">): string {
  const und = String(r.prodUnd ?? "").trim();
  const exp = String(r.exp ?? "").trim();
  return und && exp ? `${und}:${exp}` : "";
}

export type PreviewSeries = { prices: Array<[string, number]>; volatilities: Array<[string, number]> };

/** Key price-volatility-series response items by preview code (symbol). */
export function toSparkMap(items: OvlabPriceVolSeriesItem[] | null | undefined): Record<string, PreviewSeries> {
  const out: Record<string, PreviewSeries> = {};
  for (const it of items ?? []) {
    const sym = String(it.symbol ?? "").trim();
    if (!sym) continue;
    out[sym] = {
      prices: Array.isArray(it.prices) ? it.prices : [],
      volatilities: Array.isArray(it.volatilities) ? it.volatilities : [],
    };
  }
  return out;
}

/** Dual-line SVG spark: price vs base (prev close, fallback first print), A股 MinuteSpark palette; IV in violet. */
export function TrendSparkSvg({
  prices, volatilities, base, width = 88, height = 36, className, fill = false, und,
}: {
  prices: Array<[string, number]>;
  volatilities: Array<[string, number]>;
  /** Prev close/settle as baseline; falls back to first print. */
  base?: number | null;
  width?: number;
  height?: number;
  className?: string;
  /** Stretch to container width (MinuteSpark style): CSS controls size, strokes stay 1:1. */
  fill?: boolean;
  /** Underlying root (IF / AU / 510050). Picks session template. */
  und?: string;
}) {
  const pad = 2;
  const uid = useId().replace(/:/g, "");

  const pricePtsRaw = prices
    .map((p) => ({ t: String(p[0] ?? ""), v: Number(p[1]) }))
    .filter((p) => Number.isFinite(p.v));
  const volPtsRaw = volatilities
    .map((p) => ({ t: String(p[0] ?? ""), v: Number(p[1]) }))
    .filter((p) => Number.isFinite(p.v));
  const priceVals = pricePtsRaw.map((p) => p.v);
  const volVals = volPtsRaw.map((p) => p.v);

  const boxProps = fill
    ? { preserveAspectRatio: "none" as const, className: cn("block w-full", className) }
    : { width, height, className };

  if (priceVals.length < 2 && volVals.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} {...boxProps} aria-hidden>
        <line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke="currentColor" strokeDasharray="3 3" className="text-muted-foreground/40" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }

  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const kind = kindOfUnd(und, [...pricePtsRaw.map((p) => p.t), ...volPtsRaw.map((p) => p.t)]);
  const span = derivSessionSpan(kind);
  const xAtT = (t: string) => {
    const idx = derivSessionIdx(t, kind);
    if (!Number.isFinite(idx) || span <= 0) return pad;
    return pad + (idx / span) * innerW;
  };

  // Baseline = prev close when given, else first print; scale includes it so the line stays visible
  const zero = base != null && Number.isFinite(base) && base > 0 ? base : (priceVals[0] ?? 0);
  const pMin = priceVals.length ? Math.min(...priceVals, zero) : 0;
  const pMax = priceVals.length ? Math.max(...priceVals, zero) : 1;
  const pSpan = pMax - pMin || 1;
  const yPrice = (v: number) => pad + (1 - (v - pMin) / pSpan) * innerH;
  const zeroY = yPrice(zero);

  // Single tone by last vs baseline, same as MinuteSpark
  const lastP = priceVals.length ? priceVals[priceVals.length - 1] : null;
  const tone = lastP === null || zero <= 0 ? SPARK_FLAT : lastP > zero ? SPARK_UP : lastP < zero ? SPARK_DOWN : SPARK_FLAT;

  const pricePts = pricePtsRaw.map((p) => ({ x: xAtT(p.t), y: yPrice(p.v) }));
  const priceLine = pricePts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  // Area closes down to the bottom edge, gradient fades out (MinuteSpark style)
  const priceArea = pricePts.length >= 2
    ? `${priceLine} L${pricePts[pricePts.length - 1].x.toFixed(1)},${(height - pad).toFixed(1)} L${pricePts[0].x.toFixed(1)},${(height - pad).toFixed(1)} Z`
    : "";

  // IV: independent normalize
  let volLine = "";
  if (volVals.length >= 2) {
    const vMin = Math.min(...volVals);
    const vMax = Math.max(...volVals);
    const vSpan = vMax - vMin || 1;
    volLine = volPtsRaw.map((p, i) => {
      const x = xAtT(p.t);
      const y = pad + (1 - (p.v - vMin) / vSpan) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }

  const grad = `${uid}-g`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} {...boxProps} aria-hidden>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.38" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Baseline (prev close) */}
      {pricePts.length >= 2 && (
        <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke={SPARK_BASE} strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      )}

      {/* Price area + line, single tone */}
      {priceArea && (
        <>
          <path d={priceArea} fill={`url(#${grad})`} />
          <path d={priceLine} fill="none" stroke={tone} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </>
      )}

      {/* IV violet overlay */}
      {volLine ? (
        <path d={volLine} fill="none" stroke={TREND_IV} strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" opacity={0.9} vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}

/** Inline spark + hover enlarged overlay (price + IV), like openvlab.cn/market TrendPreviewCell. */
export function TrendPreviewCell({ series, loading, base, und }: {
  series?: PreviewSeries; loading?: boolean; base?: number | null; und?: string;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) { setHover(true); return; }
    const popW = 280;
    const popH = 180;
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (left < 8) left = 8;
    if (top + popH > window.innerHeight - 8) top = rect.top - popH - 6;
    setPos({ top, left });
    setHover(true);
  };

  if (loading && !series) {
    return (
      <div className="flex h-9 w-[5.5rem] items-center justify-center text-muted-foreground/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </div>
    );
  }
  const prices = series?.prices ?? [];
  const vols = series?.volatilities ?? [];
  const empty = prices.length < 2 && vols.length < 2;
  const lastP = prices.length ? num(prices[prices.length - 1][1]) : null;
  const firstP = prices.length ? num(prices[0][1]) : null;
  const lastV = vols.length ? num(vols[vols.length - 1][1]) : null;
  const firstV = vols.length ? num(vols[0][1]) : null;
  const refP = base != null && Number.isFinite(base) && base > 0 ? base : firstP;
  const pChg = lastP != null && refP != null && refP !== 0 ? ((lastP - refP) / refP) * 100 : null;
  const vChg = lastV != null && firstV != null ? lastV - firstV : null;

  return (
    <div
      ref={anchorRef}
      className="relative"
      onMouseEnter={show}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={cn(
        "flex h-9 w-[5.5rem] items-center justify-center rounded-md border border-transparent transition-colors",
        !empty && "hover:border-border/60 hover:bg-muted/30",
      )}>
        {empty
          ? <span className="text-xs text-muted-foreground/40">-</span>
          : <TrendSparkSvg prices={prices} volatilities={vols} base={base} und={und} />}
      </div>
      {hover && !empty && pos && createPortal(
        <div
          className="pointer-events-none fixed z-[100] w-[280px] rounded-xl border border-border/70 bg-background p-3 shadow-xl"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
            <span className="font-medium text-foreground">走势预览</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-2 rounded-full bg-red-500" />
                <span className="h-1.5 w-2 rounded-full bg-emerald-500" />
                价格
              </span>
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-violet-400" />隐波</span>
            </span>
          </div>
          <TrendSparkSvg prices={prices} volatilities={vols} base={base} width={256} height={96} und={und} />
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] tabular-nums">
            <div>
              <div className="text-muted-foreground">价格</div>
              <div className="font-medium">
                {lastP != null ? lastP.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "-"}
                {pChg != null && (
                  <span className={cn("ml-1", pChg > 0 ? "text-red-500" : pChg < 0 ? "text-emerald-500" : "text-muted-foreground")}>
                    {pChg > 0 ? "+" : ""}{pChg.toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">隐波</div>
              <div className="font-medium">
                {lastV != null ? lastV.toFixed(2) : "-"}
                {vChg != null && (
                  <span className={cn("ml-1", vChg > 0 ? "text-red-500" : vChg < 0 ? "text-emerald-500" : "text-muted-foreground")}>
                    {vChg > 0 ? "+" : ""}{vChg.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function PctPill({ value, digits = 2, suffix = "" }: { value: unknown; digits?: number; suffix?: string }) {
  // Missing upstream metrics default to 0 (e.g. new listings without IV)
  const n = num(value) ?? 0;
  const cls = n > 0 ? "up" : n < 0 ? "down" : "flat";
  const text = `${n > 0 ? "+" : ""}${n.toFixed(digits)}${suffix}`;
  return <span className={cn("pct-pill", cls)}>{text}</span>;
}

export function PercentileBar({ value }: { value: unknown }) {
  const n = num(value) ?? 0;
  const pv = Math.max(0, Math.min(100, n));
  const tone = pv >= 80 ? "from-red-500/80 to-red-400/50" : pv <= 20 ? "from-emerald-500/80 to-emerald-400/50" : "from-amber-500/70 to-amber-400/40";
  return (
    <div className="inline-flex min-w-[5.5rem] items-center gap-1.5">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted/50">
        <div className={cn("absolute inset-y-0 left-0 rounded-full bg-gradient-to-r", tone)} style={{ width: `${pv}%` }} />
      </div>
      <span className="w-8 text-right text-xs font-medium tabular-nums text-muted-foreground">{n.toFixed(0)}</span>
    </div>
  );
}

