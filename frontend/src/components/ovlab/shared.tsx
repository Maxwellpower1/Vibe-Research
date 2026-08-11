import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, CircleHelp } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";

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

// —— 期权到期日历: 默认收起为一行快捷条, 需要时再展开完整月历 ——

export const TREND_RED = "#ef4444";
export const TREND_GREEN = "#22c55e";
export const TREND_PINK = "#f472b6";

