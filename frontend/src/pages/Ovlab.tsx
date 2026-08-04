import { useState, useEffect, useCallback, useRef } from "react";
import * as echarts from "echarts";
import { RefreshCw, Loader2, AlertCircle, Search, Activity, Zap, History, ArrowUp, ArrowDown, ArrowUpDown, CandlestickChart, Table2, X, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, ApiError, type OvlabMarketRow, type OvlabFlowAlert, type OvlabWarehouseHistory, type OvlabPositionProducts, type OvlabFuturePositionDetails, type OvlabRankRow, type OvlabFlowDataRow, type OvlabProductExp, type OvlabSearchItem } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "market" | "detail" | "flow-alert" | "flow-data" | "warehouse" | "chart" | "vol-surface" | "position";

const TABS: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: "market", label: "市场概览", icon: Activity },
  { key: "chart", label: "轻量图表", icon: CandlestickChart },
  { key: "detail", label: "单品种详情", icon: Search },
  { key: "vol-surface", label: "T型报价", icon: Table2 },
  { key: "flow-alert", label: "异动榜", icon: Zap },
  { key: "flow-data", label: "异动资金流", icon: Zap },
  { key: "warehouse", label: "持仓历史", icon: History },
  { key: "position", label: "持仓排名", icon: Table2 },
];

// 市场概览表格列 (字段 -> 表头), 与后端 MARKET_OVERVIEW_COLUMNS 对齐
const MARKET_COLS: { key: keyof OvlabMarketRow; label: string; cls?: string; sortable?: boolean }[] = [
  { key: "product_alias", label: "品种", sortable: true },
  { key: "prodUnd", label: "标的", sortable: true },
  { key: "exchange", label: "交易所", sortable: true },
  { key: "sector_alias", label: "板块", sortable: true },
  { key: "price", label: "最新价", cls: "text-right tabular-nums", sortable: true },
  { key: "ctn", label: "涨跌幅", cls: "text-right tabular-nums", sortable: true },
  { key: "atmv_current", label: "平值隐波", cls: "text-right tabular-nums", sortable: true },
  { key: "atmv_percentile", label: "隐波百分位", cls: "text-right tabular-nums", sortable: true },
  { key: "rv22", label: "22日实波", cls: "text-right tabular-nums", sortable: true },
  { key: "carry", label: "Carry", cls: "text-right tabular-nums", sortable: true },
  { key: "skew_current", label: "偏度", cls: "text-right tabular-nums", sortable: true },
  { key: "skew_percentile", label: "偏度百分位", cls: "text-right tabular-nums", sortable: true },
  { key: "exp", label: "主力合约" },
  { key: "expiry_date", label: "到期日" },
  { key: "last_time", label: "更新时间" },
];

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
}

function pct(v: unknown, digits = 2): string {
  const n = num(v);
  if (n === null) return "-";
  return `${n.toFixed(digits)}`;
}

function pctColored(v: unknown): string {
  const n = num(v);
  if (n === null) return "-";
  return n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
}

// —— 通用排序: 数值优先, 否则字符串. null/缺失排末尾 ——
type SortState<T> = { key: keyof T | null; dir: "asc" | "desc" };

function sortRows<T extends Record<string, unknown>>(rows: T[], sort: SortState<T>): T[] {
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

function nextSort<T>(cur: SortState<T>, key: keyof T): SortState<T> {
  if (cur.key !== key) return { key, dir: "desc" };
  if (cur.dir === "desc") return { key, dir: "asc" };
  return { key: null, dir: "desc" };
}

// —— 自动刷新 hook: 开关 + 间隔, 页面隐藏时暂停, 切回时立即刷新 ——
function useAutoRefresh(load: () => Promise<void>, opts: { defaultOn?: boolean; defaultMs?: number } = {}) {
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

const INTERVALS = [
  { v: 30000, label: "30s" },
  { v: 60000, label: "1m" },
  { v: 120000, label: "2m" },
  { v: 300000, label: "5m" },
];

function AutoRefreshBar({ auto, setAuto, ms, setMs, lastUpdate, onRefresh, refreshing }: {
  auto: boolean; setAuto: (v: boolean) => void;
  ms: number; setMs: (v: number) => void;
  lastUpdate: string | null; onRefresh: () => void; refreshing: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <button
        onClick={() => setAuto(!auto)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-colors",
          auto ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground",
        )}
        title={auto ? "自动刷新开启中, 点击关闭" : "点击开启自动刷新"}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", auto ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40")} />
        自动
      </button>
      {auto && (
        <select
          value={ms}
          onChange={(e) => setMs(Number(e.target.value))}
          className="rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5 text-xs outline-none focus:border-primary/50"
        >
          {INTERVALS.map((i) => <option key={i.v} value={i.v}>{i.label}</option>)}
        </select>
      )}
      {lastUpdate && <span className="text-muted-foreground/60">更新于 {lastUpdate}</span>}
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 transition-colors hover:bg-muted/50 disabled:opacity-50"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        刷新
      </button>
    </div>
  );
}

// —— 结构化渲染辅助: dto 视图 ——

function fmt(v: unknown, digits = 2): string {
  const n = num(v);
  if (n === null) return "-";
  return n.toFixed(digits);
}

function fmtInt(v: unknown): string {
  const n = num(v);
  if (n === null) return "-";
  return Math.round(n).toLocaleString("en-US");
}

// —— dto 结构化视图 ——
interface DtoData {
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

const RV_PERIODS = ["1d", "7d", "14d", "30d", "91d", "183d", "274d", "365d"];

function DtoView({ data }: { data: DtoData }) {
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

// 可排序表头
function SortableTh<T extends Record<string, unknown>>({ col, sort, onSort }: {
  col: { key: keyof T; label: string; cls?: string; sortable?: boolean };
  sort: SortState<T>; onSort: (key: keyof T) => void;
}) {
  const active = sort.key === col.key;
  return (
    <th
      onClick={col.sortable ? () => onSort(col.key) : undefined}
      className={cn(
        col.cls?.includes("text-right") && "num",
        col.sortable && "cursor-pointer select-none hover:text-foreground",
        active && "text-primary",
      )}
    >
      <span className="inline-flex items-center gap-1">
        {col.label}
        {col.sortable && (
          active
            ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
            : <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

// —— 期权到期日历(内联, 显示在表格上方) ——
function ExpiryCalendar({ data, selectedDate, onPick }: {
  data: OvlabProductExp[];
  selectedDate: string | null;
  onPick: (date: string) => void;
}) {
  // 按 expDate 聚合: { "20260818": [{alias, und, ex}], ... }
  const byDate = new Map<string, { alias: string; und: string; ex: string }[]>();
  for (const p of data) {
    for (const e of p.exps ?? []) {
      const d = String(e.expDate ?? "");
      if (!d) continue;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push({ alias: String(p.product_alias ?? ""), und: String(p.product_und ?? ""), ex: String(p.exchange ?? "") });
    }
  }

  // 交易所代码 -> 中文简称(2字, 适配日历单元格)
  const EX_NAME: Record<string, string> = {
    SSE: "沪市", SHSE: "沪市", SZSE: "深市", SHSZ: "深市", SHFE: "上期", CZCE: "郑商", DCE: "大商",
    CFFEX: "中金", GFEX: "广期", INE: "能源", GLOBEX: "芝商",
    上交所: "沪市", 深交所: "深市", 上期所: "上期", 郑商所: "郑商", 大商所: "大商",
    中金所: "中金", 广期所: "广期", 能源所: "能源",
  };
  const exName = (ex: string) => EX_NAME[ex] || EX_NAME[ex.toUpperCase()] || ex;

  const [view, setView] = useState(() => {
    const d = selectedDate ? new Date(selectedDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")) : new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const monthLabel = `${view.y}年 ${view.m + 1}月`;
  const first = new Date(view.y, view.m, 1);
  const startWeekday = first.getDay(); // 0=周日
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const fmtD = (d: number) => `${view.y}${String(view.m + 1).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  const today = (() => { const n = new Date(); return `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, "0")}${String(n.getDate()).padStart(2, "0")}`; })();

  const prevMonth = () => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const nextMonth = () => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));
  return (
    <GlassCard>
      <div>
        {/* 顶部: 标题 + 月份导航 + 今日 */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold">期权到期日历</h3>
            {selectedDate && (
              <button onClick={() => onPick(selectedDate)} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/20">
                {selectedDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")} 到期过滤中 · 点此取消
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[84px] text-center text-sm font-semibold tabular-nums">{monthLabel}</span>
            <button onClick={nextMonth} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
            <button onClick={() => setView({ y: new Date().getFullYear(), m: new Date().getMonth() })}
              className="ml-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">今日</button>
          </div>
        </div>

        {/* 星期表头: 周末色调区分 */}
        <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
          {["日", "一", "二", "三", "四", "五", "六"].map((w, idx) => (
            <div key={w} className={cn("py-1 font-medium", idx === 0 || idx === 6 ? "text-red-400/70" : "text-muted-foreground")}>{w}</div>
          ))}
        </div>

        {/* 日期单元格 */}
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />;
            const ds = fmtD(d);
            const list = byDate.get(ds) ?? [];
            const isToday = ds === today;
            const isSelected = ds === selectedDate;
            const hasExpiry = list.length > 0;
            const exCodes = [...new Set(list.map((x) => x.ex))].filter(Boolean);
            const exItems = exCodes.map((ex) => ({ ex, name: exName(ex), items: list.filter((x) => x.ex === ex) }));
            const showEx = exItems.slice(0, 2);
            const more = exItems.length - showEx.length;
            return (
              <button key={i} onClick={() => onPick(ds)} disabled={!hasExpiry}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-start gap-1 rounded-xl border pt-1.5 px-0.5 text-xs transition-all",
                  !hasExpiry && "border-transparent text-muted-foreground/30 hover:border-transparent",
                  hasExpiry && !isSelected && "border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40",
                  isSelected && "border-primary bg-primary text-primary-foreground shadow-sm",
                  isToday && !isSelected && "ring-1 ring-primary/50",
                )}>
                {/* 今日标记点 */}
                {isToday && <span className={cn("absolute right-1 top-1 h-1.5 w-1.5 rounded-full", isSelected ? "bg-primary-foreground" : "bg-primary")} />}
                <span className={cn("leading-none", isToday && !isSelected && "font-bold text-primary", isSelected && "font-bold")}>{d}</span>
                {showEx.length > 0 && (
                  <span className="flex flex-wrap items-center justify-center gap-0.5 px-0.5 leading-none">
                    {showEx.map((it) => (
                      <span key={it.ex} className="group/ex relative cursor-default">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] leading-tight", isSelected ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/15 text-primary/90")}>{it.name}</span>
                        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-border/60 bg-background px-2.5 py-2 text-[10px] shadow-xl group-hover/ex:block">
                          <span className="font-semibold text-primary">{it.name}</span>
                          <span className="ml-1 text-muted-foreground">{ds.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}</span>
                          <span className="ml-1 rounded-full bg-muted/40 px-1.5 text-muted-foreground">{it.items.length}</span>
                          <span className="mt-1.5 block max-w-[220px] leading-relaxed text-muted-foreground">{it.items.map((p) => p.alias || p.und).join(" · ")}</span>
                        </span>
                      </span>
                    ))}
                    {more > 0 && <span className={cn("text-[11px]", isSelected ? "text-primary-foreground/70" : "text-muted-foreground/70")}>+{more}</span>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </GlassCard>
  );
}

function MarketPanel({ onPickSymbol }: { onPickSymbol?: (symbol: string) => void }) {
  const [rows, setRows] = useState<OvlabMarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [expData, setExpData] = useState<OvlabProductExp[]>([]);
  const [expDate, setExpDate] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<OvlabMarketRow>>({ key: null, dir: "desc" });

  const load = useCallback(async () => {
    setErr(null);
    try { setRows(await api.ovlabMarket()); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "加载失败"); }
    finally { setLoading(false); }
  }, []);

  const { auto, setAuto, ms, setMs, lastUpdate, doLoad } = useAutoRefresh(load, { defaultMs: 60000 });

  useEffect(() => { void doLoad(); }, [doLoad]);

  // 懒加载到期日历数据(只加载一次)
  useEffect(() => {
    if (expData.length === 0) {
      api.ovlabProductExps().then(setExpData).catch(() => { /* ignore */ });
    }
  }, [expData.length]);

  const refresh = async () => { setRefreshing(true); await doLoad(); setRefreshing(false); };

  // 选中到期日后, 过滤出有该到期日的品种
  const expUnds = new Set<string>();
  if (expDate) {
    for (const p of expData) {
      if ((p.exps ?? []).some((e) => String(e.expDate ?? "") === expDate)) {
        if (p.product_und) expUnds.add(p.product_und);
      }
    }
  }

  const f = filter.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (expDate && r.prodUnd && !expUnds.has(r.prodUnd)) return false;
    if (!f) return true;
    return [r.product_alias, r.prodUnd, r.exchange, r.sector_alias]
      .some((x) => String(x ?? "").toLowerCase().includes(f));
  });
  const shown = sortRows(filtered, sort);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[200px]">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="按品种 / 标的 / 交易所 / 板块过滤"
              className="w-full rounded-lg border border-border/60 bg-muted/30 py-2 pl-8 pr-3 text-sm outline-none focus:border-primary/50"
            />
          </div>
          {expDate && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
              到期 {expDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}
              <button onClick={() => setExpDate(null)} className="rounded p-0.5 hover:bg-primary/20"><X className="h-3 w-3" /></button>
            </span>
          )}
        </div>
        <AutoRefreshBar auto={auto} setAuto={setAuto} ms={ms} setMs={setMs} lastUpdate={lastUpdate} onRefresh={refresh} refreshing={refreshing || loading} />
      </div>

      <div className="mb-3">
        <ExpiryCalendar
          data={expData}
          selectedDate={expDate}
          onPick={setExpDate}
        />
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中...
        </div>
      ) : err ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      ) : shown.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">暂无数据</div>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-border/60">
          <table className="data-table">
            <thead>
              <tr>
                {MARKET_COLS.map((c) => (
                  <SortableTh key={c.key} col={c} sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const ctn = num(r.ctn);
                // 合约代码 = 标的 + 月份后4位 (如 MA+2609=MA2609, 510500+2608=5105002608)
                const sym = String(r.prodUnd ?? "") + String(r.exp ?? "").slice(-4);
                return (
                  <tr key={i} onClick={onPickSymbol && sym ? () => onPickSymbol(sym) : undefined}
                    className={onPickSymbol && sym ? "cursor-pointer hover:bg-muted/40" : undefined}>
                    {MARKET_COLS.map((c) => {
                      const v = r[c.key];
                      if (c.key === "ctn") {
                        return (
                          <td key={c.key} className={cn("num", ctn !== null && (ctn > 0 ? "text-emerald-500" : ctn < 0 ? "text-red-500" : ""))}>
                            {pctColored(v)}
                          </td>
                        );
                      }
                      const isPct = c.key === "atmv_percentile" || c.key === "skew_percentile";
                      const display = isPct ? pct(v) : String(v ?? "-");
                      return (
                        <td key={c.key} className={cn(c.cls?.includes("text-right") && "num", (display === "-" || display === "") && "nil")}>
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground/60">
        共 {shown.length} 个品种{expDate ? ` · 已按到期日 ${expDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")} 过滤` : ""} · 数据来自 openvlab.cn 公开接口, 缓存 5 分钟 · 点表头排序 · 点行跳转轻量图表
      </p>
    </div>
  );
}

function DetailPanel() {
  const [code, setCode] = useState("");
  const [exps, setExps] = useState("");
  const [data, setData] = useState<DtoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setLoading(true); setErr(null); setData(null);
    try { setData(await api.ovlabDetail(c, exps.trim() || undefined) as DtoData); }
    catch (e2) { setErr(e2 instanceof ApiError ? e2.message : "加载失败"); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">标的代码 (prodUnd)</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="如 510300"
            className="w-44 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">合约月份 (可选, 逗号分隔)</label>
          <input
            value={exps}
            onChange={(e) => setExps(e.target.value)}
            placeholder="留空取默认"
            className="w-56 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          查询
        </button>
      </form>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中...
        </div>
      ) : err ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      ) : data ? (
        <DtoView data={data} />
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground">输入标的代码后查询详情</p>
      )}
    </div>
  );
}

// —— 异动榜 ——
const FLOW_ALERT_COLS: { key: keyof OvlabFlowAlert; label: string; cls?: string; sortable?: boolean }[] = [
  { key: "time", label: "时间", sortable: true },
  { key: "contract_code", label: "合约", sortable: true },
  { key: "rule_id", label: "规则", sortable: true },
  { key: "side", label: "方向", sortable: true },
  { key: "price", label: "价格", cls: "text-right tabular-nums", sortable: true },
  { key: "ctn", label: "涨跌幅", cls: "text-right tabular-nums", sortable: true },
  { key: "open_interest", label: "持仓量", cls: "text-right tabular-nums", sortable: true },
  { key: "window_volume", label: "窗口成交量", cls: "text-right tabular-nums", sortable: true },
  { key: "window_premium", label: "窗口权利金", cls: "text-right tabular-nums", sortable: true },
  { key: "pct_change", label: "变化", cls: "text-right tabular-nums", sortable: true },
];

function FlowAlertPanel() {
  const [rows, setRows] = useState<OvlabFlowAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState<OvlabFlowAlert>>({ key: "time", dir: "desc" });

  const load = useCallback(async () => {
    setErr(null);
    try { setRows(await api.ovlabFlowAlert()); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "加载失败"); }
    finally { setLoading(false); }
  }, []);

  const { auto, setAuto, ms, setMs, lastUpdate, doLoad } = useAutoRefresh(load, { defaultMs: 60000 });

  useEffect(() => { void doLoad(); }, [doLoad]);

  const refresh = async () => { setRefreshing(true); await doLoad(); setRefreshing(false); };
  const [refreshing, setRefreshing] = useState(false);

  const f = filter.trim().toLowerCase();
  const filtered = f ? rows.filter((r) => [r.contract_code, r.instrument, r.rule_id].some((x) => String(x ?? "").toLowerCase().includes(f))) : rows;
  const shown = sortRows(filtered, sort).slice(0, 200);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="按合约 / 规则过滤"
            className="w-full rounded-lg border border-border/60 bg-muted/30 py-2 pl-8 pr-3 text-sm outline-none focus:border-primary/50" />
        </div>
        <AutoRefreshBar auto={auto} setAuto={setAuto} ms={ms} setMs={setMs} lastUpdate={lastUpdate} onRefresh={refresh} refreshing={refreshing || loading} />
      </div>
      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中...</div>
      ) : err ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" /> {err}</div>
      ) : shown.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">暂无异动</div>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-border/60">
          <table className="data-table">
            <thead>
              <tr>{FLOW_ALERT_COLS.map((c) => <SortableTh key={c.key} col={c} sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />)}</tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i}>
                  {FLOW_ALERT_COLS.map((c) => {
                    const v = String(r[c.key] ?? "-");
                    return <td key={c.key} className={cn(c.cls?.includes("text-right") && "num", v === "-" && "nil")}>{v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground/60">共 {filtered.length} 条 · 显示前 200 条 · 数据来自 openvlab.cn, 缓存 5 分钟 · 点表头排序</p>
    </div>
  );
}

// —— 异动资金流 (flow-data) ——
const FLOW_DATA_COLS: { key: keyof OvlabFlowDataRow; label: string; cls?: string; sortable?: boolean }[] = [
  { key: "full_name", label: "合约", sortable: true },
  { key: "product_alias", label: "品种", sortable: true },
  { key: "optType", label: "类型", sortable: true },
  { key: "strikePrice", label: "行权价", cls: "text-right tabular-nums", sortable: true },
  { key: "last_trade_price", label: "最新价", cls: "text-right tabular-nums", sortable: true },
  { key: "ctnPct", label: "涨跌幅%", cls: "text-right tabular-nums", sortable: true },
  { key: "underlying_price", label: "标的价格", cls: "text-right tabular-nums", sortable: true },
  { key: "oi", label: "持仓量", cls: "text-right tabular-nums", sortable: true },
  { key: "oiChange", label: "持仓变化", cls: "text-right tabular-nums", sortable: true },
  { key: "oiChangePct", label: "持仓变化%", cls: "text-right tabular-nums", sortable: true },
  { key: "volume", label: "成交量", cls: "text-right tabular-nums", sortable: true },
  { key: "volume_value", label: "成交额", cls: "text-right tabular-nums", sortable: true },
  { key: "ask_percentage", label: "买盘占比%", cls: "text-right tabular-nums", sortable: true },
  { key: "bid_percentage", label: "卖盘占比%", cls: "text-right tabular-nums", sortable: true },
  { key: "otmPct", label: "OTM%", cls: "text-right tabular-nums", sortable: true },
  { key: "dte", label: "DTE", cls: "text-right tabular-nums", sortable: true },
];

function FlowDataPanel() {
  const [rows, setRows] = useState<OvlabFlowDataRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [product, setProduct] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [sort, setSort] = useState<SortState<OvlabFlowDataRow>>({ key: "oiChangePct", dir: "desc" });

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await api.ovlabFlowData(product, page, pageSize);
      setRows(d.data ?? []);
      setTotal(d.totalCount ?? 0);
      setTotalPages(d.totalPages ?? 0);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "加载失败"); }
    finally { setLoading(false); }
  }, [product, page, pageSize]);

  const { auto, setAuto, ms, setMs, lastUpdate, doLoad } = useAutoRefresh(load, { defaultMs: 60000 });
  useEffect(() => { void doLoad(); }, [doLoad]);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); await doLoad(); setRefreshing(false); };

  const fmtN = (v: unknown, d = 2) => {
    const n = num(v);
    return n == null ? "-" : Number.isInteger(n) && d === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d });
  };
  const fmtPct = (v: unknown) => {
    const n = num(v);
    return n == null ? "-" : (n > 0 ? "+" : "") + n.toFixed(2);
  };
  const pctCls = (v: unknown) => {
    const n = num(v);
    return n != null && n !== 0 ? (n > 0 ? "text-red-500" : "text-emerald-500") : "";
  };

  const shown = sortRows(rows, sort);

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); setPage(1); void refresh(); }} className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">品种筛选 (可选)</label>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="如 CU / 510500"
            className="w-40 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50" />
        </div>
        <button type="submit" disabled={loading || refreshing}
          className="inline-flex items-center gap-1.5 self-end rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {loading || refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} 查询
        </button>
        <div className="self-end">
          <AutoRefreshBar auto={auto} setAuto={setAuto} ms={ms} setMs={setMs} lastUpdate={lastUpdate} onRefresh={refresh} refreshing={refreshing || loading} />
        </div>
      </form>

      {err ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" /> {err}</div>
      ) : loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中...</div>
      ) : shown.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">暂无异动资金流数据</div>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-border/60">
          <table className="data-table">
            <thead>
              <tr>{FLOW_DATA_COLS.map((c) => <SortableTh key={c.key} col={c} sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />)}</tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={(r.instrument ?? "") + i}>
                  {FLOW_DATA_COLS.map((c) => {
                    const k = c.key;
                    let v: string;
                    let cls = c.cls?.includes("text-right") ? "num" : "";
                    if (k === "ctnPct" || k === "oiChangePct") { v = fmtPct(r[k]); cls = cn(cls, pctCls(r[k])); }
                    else if (k === "ask_percentage" || k === "bid_percentage" || k === "otmPct" || k === "dte") { v = fmtN(r[k], 2); }
                    else if (k === "volume" || k === "oi" || k === "oiChange") { v = fmtN(r[k], 0); }
                    else if (k === "volume_value") { v = fmtN(r[k], 0); }
                    else if (k === "last_trade_price" || k === "underlying_price" || k === "strikePrice") { v = fmtN(r[k], 4); }
                    else { v = String(r[k] ?? "-"); }
                    return <td key={k} className={cn(cls, v === "-" && "nil")}>{v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>共 {total.toLocaleString()} 条 · 第 {page}/{totalPages || 1} 页</span>
          <div className="flex gap-1">
            <button onClick={() => { setPage((p) => Math.max(1, p - 1)); }} disabled={page <= 1}
              className="rounded-lg border border-border/60 px-3 py-1.5 disabled:opacity-40 hover:bg-muted/40">上一页</button>
            <button onClick={() => { setPage((p) => Math.min(totalPages || 1, p + 1)); }} disabled={page >= (totalPages || 1)}
              className="rounded-lg border border-border/60 px-3 py-1.5 disabled:opacity-40 hover:bg-muted/40">下一页</button>
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground/60">数据来自 openvlab.cn flow-data · 不缓存 · 涨幅/持仓变化红涨绿跌 (A股配色) · 点表头排序</p>
    </div>
  );
}

// —— 持仓历史 ——
type WhYear = { year: string; values: (number | null)[] };

function SeasonalityChart({ xLabels, series }: {
  xLabels: string[];
  series: { name: string; data: (number | null)[] }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); chartRef.current = null; };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    // 默认只选中最近 5 年, 其余 legend 灰显可手动开启
    const selected: Record<string, boolean> = {};
    series.forEach((s, i) => { selected[s.name] = i >= series.length - 5; });
    chartRef.current.setOption({
      backgroundColor: "transparent",
      grid: { left: 56, right: 18, top: 44, bottom: 64 },
      legend: {
        type: "scroll", top: 6, textStyle: { color: "hsl(var(--muted-foreground))", fontSize: 10 },
        selected,
      },
      tooltip: { trigger: "axis", axisPointer: { type: "line" }, valueFormatter: (v: unknown) => (v == null ? "-" : Number(v).toLocaleString()) },
      xAxis: {
        type: "category", data: xLabels, boundaryGap: false,
        axisLabel: { color: "hsl(var(--chart-text))", fontSize: 10, interval: Math.max(0, Math.floor(xLabels.length / 12)) },
        axisLine: { lineStyle: { color: "hsl(var(--chart-axis))" } },
      },
      yAxis: {
        type: "value", scale: true,
        axisLabel: { color: "hsl(var(--chart-text))", fontSize: 10 },
        splitLine: { lineStyle: { color: "hsl(var(--chart-grid))" } },
      },
      series: series.map((s) => ({
        name: s.name, type: "line", data: s.data, showSymbol: false,
        connectNulls: false, lineStyle: { width: 1.3 }, emphasis: { focus: "series" },
      })),
    }, { notMerge: true });
  }, [xLabels, series]);

  return <div ref={ref} className="h-[440px] w-full" />;
}

function WarehousePanel() {
  const [product, setProduct] = useState("MA");
  const [data, setData] = useState<OvlabWarehouseHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = product.trim();
    if (!p) return;
    setLoading(true); setErr(null); setData(null);
    try { setData(await api.ovlabWarehouseHistory(p)); }
    catch (e2) { setErr(e2 instanceof ApiError ? e2.message : "加载失败"); }
    finally { setLoading(false); }
  };

  // 解析数据
  const d = data as Record<string, unknown> | null;
  const cat = (d?.["category"] as string[] | undefined) ?? [];
  const dataCat = (d?.["dataCategory"] as string[] | undefined) ?? [];
  const valArr = (d?.["value"] as unknown[] | undefined) ?? [];
  const ratioData = (d?.["ratioData"] as Array<Record<string, unknown>> | undefined) ?? [];

  const yearKeys = d ? Object.keys(d).filter((k) => /^year\d{4}$/.test(k)).sort() : [];
  const yearSeries: WhYear[] = yearKeys.map((k) => {
    const arr = d![k] as unknown[];
    return { year: k.slice(4), values: arr.map((v) => (v === "NaN" || v == null || v === "" ? null : Number(v))) };
  });

  // 最新持仓 = value 数组最后一个非 NaN
  const lastVal = (() => {
    for (let i = valArr.length - 1; i >= 0; i--) {
      const v = valArr[i];
      if (v !== "NaN" && v != null && v !== "") return Number(v);
    }
    return null;
  })();
  const lastDate = (() => {
    for (let i = valArr.length - 1; i >= 0; i--) {
      if (valArr[i] !== "NaN" && valArr[i] != null && valArr[i] !== "") return cat[i];
    }
    return null;
  })();

  const chartSeries = yearSeries.map((y) => ({ name: y.year, data: y.values }));

  return (
    <div>
      <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">品种代码 (product)</label>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="如 MA / CU / RB"
            className="w-40 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50" />
        </div>
        <button type="submit" disabled={loading || !product.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} 查询
        </button>
      </form>
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中...</div>
      ) : err ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" /> {err}</div>
      ) : data ? (
        <div className="space-y-4">
          {/* 概要 */}
          <GlassCard>
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm">
              <div><span className="text-muted-foreground">品种</span> <b className="ml-1.5 text-base">{product}</b></div>
              <div>
                <span className="text-muted-foreground">最新持仓</span>{" "}
                <b className="ml-1.5 tabular-nums text-lg text-primary">{lastVal != null ? lastVal.toLocaleString() : "-"}</b>
                {lastDate && <span className="ml-2 text-xs text-muted-foreground">@ {lastDate}</span>}
              </div>
              <div><span className="text-muted-foreground">更新</span> <span className="ml-1.5 tabular-nums">{String(d?.["last_update_time"] ?? "-")}</span></div>
              <div><span className="text-muted-foreground">类别</span> <span className="ml-1.5">{String(d?.["category"] && Array.isArray(d?.["category"]) ? "时间序列" : (d?.["dataCategory"] ? "季节性" : "-"))}</span></div>
            </div>
          </GlassCard>

          {/* 季节性叠加图 */}
          {dataCat.length > 0 && yearSeries.length > 0 && (
            <GlassCard>
              <h3 className="mb-1 text-sm font-bold">持仓季节性对比 · 按月-日对齐多年叠加</h3>
              <p className="mb-2 text-[11px] text-muted-foreground">点击图例可切换年份; 默认显示最近 5 年, {yearSeries.length} 个年份可选</p>
              <SeasonalityChart xLabels={dataCat} series={chartSeries} />
            </GlassCard>
          )}

          {/* 月度比率表 */}
          {ratioData.length > 0 && (
            <GlassCard>
              <h3 className="mb-3 text-sm font-bold">月度持仓比率 (ratioData)</h3>
              <div className="max-h-[50vh] overflow-auto rounded-xl border border-border/60">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>年份</th>
                      {Array.from({ length: 12 }, (_, i) => <th key={i} className="num">{i + 1}月</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ratioData.map((r, i) => (
                      <tr key={i}>
                        <td className="font-medium">{String(r["year"] ?? "-")}</td>
                        {Array.from({ length: 12 }, (_, m) => {
                          const v = r[`month${m + 1}Ratio`];
                          const n = v == null ? null : Number(v);
                          return (
                            <td key={m} className={cn("num", n == null && "nil", n != null && n > 0 ? "text-emerald-500" : n != null && n < 0 ? "text-red-500" : "")}>
                              {n == null ? "-" : (n > 0 ? "+" : "") + n.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          )}
        </div>
      ) : <p className="py-16 text-center text-sm text-muted-foreground">输入品种代码后查询持仓历史</p>}
    </div>
  );
}

// —— 轻量行情图表: K 线主图 + ATM 隐波副图 + 实时刷新 ——
const RESOLUTIONS = [
  { v: "1", label: "分时" }, { v: "5", label: "5日" }, { v: "1D", label: "日线" },
];

// —— 合约搜索选择弹窗 ——
function SymbolPicker({ onSelect, onClose }: { onSelect: (s: string) => void; onClose: () => void }) {
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

function LightChartPanel({ initialSymbol }: { initialSymbol?: string } = {}) {
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

  const load = useCallback(async () => {
    const sym = symbol.trim();
    if (!sym) return;
    setLoading(true); setErr(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      // 分时(1): 当日0点; 5日(5): 5日前; 日线(1D): 1年前
      const from = resolution === "1"
        ? Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
        : resolution === "5" ? now - 5 * 86400 : now - 365 * 86400;
      const [kl, av] = await Promise.all([
        api.ovlabKlineHistory(sym, resolution, from, now),
        api.ovlabAtmvolHistory(sym, resolution, from, now),
      ]);
      // echarts K 线格式: [date, open, close, low, high]
      let bars: Array<[string, number, number, number, number]>;
      let volArr: Array<number | null>;
      let oiArr: Array<number | null>;
      if (resolution === "1D") {
        // 日线: 对象格式 {trade_date, open, close, low, high, vol, oi}
        bars = (kl?.data ?? []).map((b) => [
          String(b.trade_date ?? ""),
          Number(b.open ?? 0), Number(b.close ?? 0),
          Number(b.low ?? 0), Number(b.high ?? 0),
        ] as [string, number, number, number, number]);
        volArr = (kl?.data ?? []).map((b) => { const v = Number(b.vol); return Number.isFinite(v) && v > 0 ? v : null; });
        oiArr = (kl?.data ?? []).map((b) => { const v = Number(b.oi); return Number.isFinite(v) && v > 0 ? v : null; });
      } else {
        // 分时/5日: 数组格式 [datetime, price, pct, volume, open, high, low, oi]
        bars = (kl?.data ?? []).map((b: any) => [
          String(b[0] ?? ""),
          Number(b[4] ?? 0), Number(b[1] ?? 0),
          Number(b[6] ?? 0), Number(b[5] ?? 0),
        ] as [string, number, number, number, number]);
        volArr = (kl?.data ?? []).map((b: any) => { const v = Number(b[3]); return Number.isFinite(v) && v > 0 ? v : null; });
        oiArr = (kl?.data ?? []).map((b: any) => { const v = Number(b[7]); return Number.isFinite(v) && v > 0 ? v : null; });
      }
      setKline(bars);
      setVols(volArr);
      setOis(oiArr);
      // atmvol: [datetime, atmvol]; 日线日期 "2025-08-04" 统一成 "20250804" 对齐 kline
      setAtmvol((av?.data ?? []).map((a) => {
        let d = String(a[0] ?? "");
        if (resolution === "1D") d = d.replace(/-/g, "");
        return [d, Number(a[1])] as [string, number];
      }));
      try {
        const lb = await api.ovlabLastBar(sym);
        setLastBar(lb ?? null);
      } catch { setLastBar(null); }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "加载失败");
      setKline([]); setAtmvol([]); setVols([]); setOis([]); setLastBar(null);
    } finally { setLoading(false); }
  }, [symbol, resolution]);

  const { auto, setAuto, ms, setMs, lastUpdate, doLoad } = useAutoRefresh(load, { defaultOn: false, defaultMs: 60000 });

  useEffect(() => { void doLoad(); }, [doLoad]);

  const refresh = async () => { setRefreshing(true); await doLoad(); setRefreshing(false); };

  // K 线 + 隐波双图
  const chartRef = useRef<HTMLDivElement>(null);
  const echartRef = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    echartRef.current = chart;
    // hover 时更新信息卡 (用 hover 点数据替代 lastBar)
    chart.on("updateAxisPointer", (params: any) => {
      const di = params?.axesInfo?.[0]?.seriesDataIndices?.[0]?.dataIndex;
      setHoverIdx(Number.isInteger(di) ? di : null);
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(chartRef.current);
    return () => { ro.disconnect(); chart.dispose(); echartRef.current = null; };
  }, []);
  useEffect(() => {
    if (!echartRef.current) return;
    const upColor = "#ef5350", downColor = "#26a69a"; // A股红涨绿跌
    const dates = kline.map((b) => b[0]);
    // 隐波按 K 线日期对齐, 缺失用 null (不连接)
    const avMap = new Map<string, number>();
    atmvol.forEach((a) => avMap.set(a[0], a[1]));
    // 隐波按 K 线日期对齐, 缺失用前一个有效值填充 (forward fill)
    let prevAv: number | null = null;
    const avAligned = dates.map((d) => {
      const v = avMap.has(d) ? avMap.get(d)! : null;
      if (v != null) prevAv = v;
      return prevAv;
    });
    // 成交量柱: 按 K 线涨跌着色 (close>=open 红色 else 绿色)
    // 分时模式数据密集且数值接近, 从 0 开始更自然; 5日/日线从最小值开始突出差异
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
    echartRef.current.setOption({
      backgroundColor: "transparent",
      animation: false,
      // 悬浮 legend 横铺左上角
      legend: {
        show: true,
        orient: "horizontal",
        left: "right",
        top: 6,
        itemWidth: 14,
        itemHeight: 8,
        itemGap: 14,
        textStyle: { color: "hsl(var(--chart-text))", fontSize: 10 },
        icon: "roundRect",
        data: resolution === "1D" ? ["K线", "ATM隐波", "成交量", "持仓量"] : ["价格", "ATM隐波", "成交量", "持仓量"],
      },
      // 主图: 价格+隐波(双 yAxis); 副图: 成交量柱+持仓线
      grid: [
        { left: 64, right: 64, top: 30, height: "52%" },
        { left: 64, right: 64, top: "68%", height: "22%" },
      ],
      xAxis: [
        { type: "category", data: dates, scale: true, boundaryGap: false,
          axisLine: { lineStyle: { color: "hsl(var(--chart-axis))" } },
          axisLabel: { color: "hsl(var(--chart-text))", fontSize: 10,
            formatter: (v: string) => {
              if (resolution === "1D") return v.length === 8 ? v.slice(4, 6) + "-" + v.slice(6) : v;
              const m = v.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
              return m ? `${m[2]}-${m[3]} ${m[4]}` : v;
            } },
          splitLine: { show: false } },
        { type: "category", gridIndex: 1, data: dates, scale: true, boundaryGap: false,
          axisLabel: { show: false }, axisLine: { lineStyle: { color: "hsl(var(--chart-axis))" } }, splitLine: { show: false } },
      ],
      yAxis: [
        { scale: true, splitLine: { lineStyle: { color: "hsl(var(--chart-grid))", opacity: 0.25, width: 1 } }, axisLabel: { color: "hsl(var(--chart-text))", fontSize: 10 } },
        { scale: true, splitLine: { show: false }, axisLabel: { color: "hsl(var(--primary))", fontSize: 10, formatter: (v: number) => v.toFixed(1) + "%" } },
        { scale: true, gridIndex: 1, min: (v: { min?: number }) => { const mn = v.min ?? 0; return mn > 0 ? Math.floor(mn * 0.9) : 0; }, splitLine: { show: false }, axisLabel: { color: "hsl(var(--chart-text))", fontSize: 9 } },
      ],
      axisPointer: { link: { xAxisIndex: "all" }, label: { backgroundColor: "hsl(var(--primary))" } },
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: 60, end: 100 },
        { type: "slider", xAxisIndex: [0, 1], bottom: 6, height: 16, textStyle: { fontSize: 9 } },
      ],
      tooltip: { trigger: "axis", axisPointer: { type: "cross", crossStyle: { color: "hsl(var(--chart-axis))" }, label: { backgroundColor: "hsl(var(--primary))" } }, showContent: false },
      series: resolution === "1D" ? [
        {
          name: "K线", type: "candlestick", yAxisIndex: 0, z: 2,
          // echarts candlestick data = [open, close, low, high], x 轴日期由 xAxis.data 提供
          data: kline.map((b) => [b[1], b[2], b[3], b[4]]),
          itemStyle: { color: upColor, color0: downColor, borderColor: upColor, borderColor0: downColor },
          emphasis: { focus: "none" },
          blur: { itemStyle: { opacity: 1 } },
        },
        {
          name: "ATM隐波", type: "line", yAxisIndex: 1, z: 5,
          // line 配合 category x 轴用纯值数组, 按 K 线日期对齐
          data: avAligned,
          connectNulls: false,
          showSymbol: false, lineStyle: { width: 1.3, color: "#f59e0b" },
          emphasis: { focus: "none" },
          blur: { lineStyle: { opacity: 1 }, itemStyle: { opacity: 1 } },
        },
        volSeries, oiSeries,
      ] : [
        {
          name: "价格", type: "line", yAxisIndex: 0, z: 2,
          data: kline.map((b) => b[2]),
          showSymbol: false, lineStyle: { width: 1.3, color: "hsl(var(--primary))" },
          areaStyle: { opacity: 0.08 },
          emphasis: { focus: "none" },
          blur: { lineStyle: { opacity: 1 }, itemStyle: { opacity: 1 }, areaStyle: { opacity: 0.08 } },
        },
        {
          name: "ATM隐波", type: "line", yAxisIndex: 1, z: 5,
          data: avAligned,
          connectNulls: false,
          showSymbol: false, lineStyle: { width: 1.3, color: "#f59e0b" },
          emphasis: { focus: "none" },
          blur: { lineStyle: { opacity: 1 }, itemStyle: { opacity: 1 } },
        },
        volSeries, oiSeries,
      ],
    }, { notMerge: true });
  }, [kline, atmvol, vols, ois, resolution]);

  // hover 时显示 hover 点数据, 否则显示 lastBar 实时数据
  const hv = hoverIdx != null && kline[hoverIdx];
  const lb: Record<string, unknown> | null = hv ? {
    close: hv[2], open: hv[1], high: hv[4], low: hv[3],
    oi: ois[hoverIdx!], vol: vols[hoverIdx!], trade_date: hv[0],
    pre_close: hoverIdx! > 0 && kline[hoverIdx! - 1] ? kline[hoverIdx! - 1][2] : null,
  } : lastBar;
  const fmtN = (v: unknown) => (v == null || v === "" ? "-" : Number(v).toLocaleString());
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
              className="w-44 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50" />
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
              <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm">
                <div><span className="text-muted-foreground">{hv ? "价格" : "最新价"}</span> <b className="ml-1.5 tabular-nums text-lg text-primary">{fmtN(lb["close"])}</b></div>
                <div className={cn("tabular-nums", chg != null && (chg > 0 ? "text-red-500" : chg < 0 ? "text-emerald-500" : ""))}>
                  {chg != null ? (chg > 0 ? "+" : "") + chg.toFixed(2) : "-"}
                  <span className="ml-1.5 text-xs">({chgPct != null ? (chgPct > 0 ? "+" : "") + chgPct.toFixed(2) + "%" : "-"})</span>
                </div>
                <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[10px]", hv ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground")}>{hv ? "悬停" : "实时"}</span>
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
function VolSurfacePanel() {
  const [product, setProduct] = useState("SC");
  const [dto, setDto] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [exp, setExp] = useState<string>("");

  // dto.context.i.c = { 合约代码: { exp_month, fwd, ua, s: { strike: { c:{...}, p:{...} } } } }
  const ctx = dto ? (dto["context"] as Record<string, unknown> | undefined) : undefined;
  const i = ctx ? (ctx["i"] as Record<string, unknown> | undefined) : undefined;
  const ic = i ? (i["c"] as Record<string, Record<string, unknown>> | undefined) : undefined;
  const byMonth: Record<string, Record<string, unknown>> = {};
  if (ic) {
    for (const blk of Object.values(ic)) {
      const m = String(blk["exp_month"] ?? "");
      if (m && !byMonth[m]) byMonth[m] = blk;
    }
  }
  const exps = Object.keys(byMonth).sort();
  const block = exp ? byMonth[exp] : null;

  const load = useCallback(async () => {
    const p = product.trim();
    if (!p) return;
    setLoading(true); setErr(null);
    try {
      const d = await api.ovlabDetail(p);
      setDto(d as Record<string, unknown>);
      const dc = d ? (d["context"] as Record<string, unknown> | undefined) : undefined;
      const di = dc ? (dc["i"] as Record<string, unknown> | undefined) : undefined;
      const c = di ? (di["c"] as Record<string, Record<string, unknown>> | undefined) : undefined;
      const ms = c ? Object.values(c).map((b) => String(b["exp_month"] ?? "")).filter(Boolean).sort() : [];
      setExp((prev) => (ms.includes(prev) ? prev : ms[0] ?? ""));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "加载失败");
      setDto(null);
    } finally { setLoading(false); }
  }, [product]);

  const { auto, setAuto, ms, setMs, lastUpdate, doLoad } = useAutoRefresh(load, { defaultOn: false, defaultMs: 120000 });
  useEffect(() => { void doLoad(); }, [doLoad]);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); await doLoad(); setRefreshing(false); };

  // 解析期权报价: dto block.s[strike] = { c:{a,b,p,c,v,iv,de,cc}, p:{...} }
  type Q = { a: number | null; b: number | null; p: number | null; c: number | null; v: number | null; iv: number | null; de: number | null; cc: string | null };
  const parseQ = (q: unknown): Q => {
    const o = (q ?? {}) as Record<string, unknown>;
    return {
      a: num(o["a"]), b: num(o["b"]), p: num(o["p"]), c: num(o["c"]),
      v: num(o["v"]), iv: num(o["iv"]), de: num(o["de"]), cc: o["cc"] != null ? String(o["cc"]) : null,
    };
  };
  const rows = (() => {
    if (!block) return [] as Array<{ strike: number; call: Q; put: Q }>;
    const s = (block["s"] ?? {}) as Record<string, unknown>;
    return Object.entries(s).map(([k, qp]) => {
      const o = (qp ?? {}) as Record<string, unknown>;
      return { strike: Number(k), call: parseQ(o["c"]), put: parseQ(o["p"]) };
    }).sort((a, b) => a.strike - b.strike);
  })();

  const fmtP = (v: number | null, d = 2) => (v == null ? "-" : v.toFixed(d));
  const fmtI = (v: number | null) => (v == null ? "-" : v.toLocaleString());
  const fmtPct = (v: number | null) => (v == null ? "-" : (v > 0 ? "+" : "") + (v * 100).toFixed(2) + "%");
  const fwd = block ? num(block["fwd"]) : null;

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); void refresh(); }} className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">标的代码 (product)</label>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="如 SC / CU / 510300"
            className="w-40 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50" />
        </div>
        {exps.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">到期月</label>
            <select value={exp} onChange={(e) => setExp(e.target.value)}
              className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50">
              {exps.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        )}
        <button type="submit" disabled={loading || refreshing || !product.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {loading || refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} 查询
        </button>
      </form>

      <AutoRefreshBar auto={auto} setAuto={setAuto} ms={ms} setMs={setMs} lastUpdate={lastUpdate} onRefresh={refresh} refreshing={refreshing || loading} />

      {err ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" /> {err}</div>
      ) : !block ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{loading ? "加载中..." : "输入标的代码后查询 T 型报价"}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {/* 汇总卡 */}
          <GlassCard>
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm">
              <div><span className="text-muted-foreground">标的</span> <b className="ml-1.5">{product}</b></div>
              <div><span className="text-muted-foreground">到期月</span> <b className="ml-1.5 text-base">{exp}</b></div>
              {fwd != null && fwd > 0 && <div><span className="text-muted-foreground">远期价</span> <span className="ml-1.5 tabular-nums">{fmtP(fwd)}</span></div>}
              <div><span className="text-muted-foreground">行权价数</span> <span className="ml-1.5 tabular-nums">{rows.length}</span></div>
              {block && block["ua"] != null && <div className="text-xs text-muted-foreground">@ {String(block["ua"])}</div>}
            </div>
          </GlassCard>

          {/* T 型报价表: 行权价居中, 左 Call 右 Put */}
          <GlassCard>
            <h3 className="mb-2 text-sm font-bold">T 型报价 · {exp}（按行权价, 左 Call / 右 Put）</h3>
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-border/60">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="num">Call卖价</th>
                    <th className="num">Call买价</th>
                    <th className="num">Call最新</th>
                    <th className="num">Call涨幅</th>
                    <th className="num">Call量</th>
                    <th className="num">Call隐波</th>
                    <th className="num">Callδ</th>
                    <th className="num font-bold text-foreground">行权价</th>
                    <th className="num">Putδ</th>
                    <th className="num">Put隐波</th>
                    <th className="num">Put量</th>
                    <th className="num">Put涨幅</th>
                    <th className="num">Put最新</th>
                    <th className="num">Put买价</th>
                    <th className="num">Put卖价</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const atm = fwd != null && fwd > 0 && Math.abs(r.strike - fwd) < (r.strike * 0.02);
                    const cChgCls = r.call.c != null && r.call.c !== 0 ? (r.call.c > 0 ? "text-red-500" : "text-emerald-500") : "";
                    const pChgCls = r.put.c != null && r.put.c !== 0 ? (r.put.c > 0 ? "text-red-500" : "text-emerald-500") : "";
                    return (
                      <tr key={r.strike} className={atm ? "bg-primary/10" : undefined}>
                        <td className="num">{fmtP(r.call.a)}</td>
                        <td className="num">{fmtP(r.call.b)}</td>
                        <td className="num">{fmtP(r.call.p)}</td>
                        <td className={cn("num", cChgCls)}>{fmtPct(r.call.c)}</td>
                        <td className="num">{fmtI(r.call.v)}</td>
                        <td className="num">{fmtP(r.call.iv)}</td>
                        <td className="num">{fmtP(r.call.de, 3)}</td>
                        <td className="num font-bold text-foreground">{r.strike.toFixed(1)}</td>
                        <td className="num">{fmtP(r.put.de, 3)}</td>
                        <td className="num">{fmtP(r.put.iv)}</td>
                        <td className="num">{fmtI(r.put.v)}</td>
                        <td className={cn("num", pChgCls)}>{fmtPct(r.put.c)}</td>
                        <td className="num">{fmtP(r.put.p)}</td>
                        <td className="num">{fmtP(r.put.b)}</td>
                        <td className="num">{fmtP(r.put.a)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">行权价居中, 左 Call 右 Put; 高亮行 ≈ ATM（远期价附近）; 涨幅红涨绿跌（A股配色）。空值表示该档位无该侧报价（如深度虚值 call 无买一卖一）。</p>
          </GlassCard>
        </div>
      )}
    </div>
  );
}

// —— 持仓排名 (option-position / future-position) ——
type PosKind = "future" | "option";

function RankTable({ title, rows, colorCls }: { title: string; rows: OvlabRankRow[]; colorCls?: string }) {
  if (!rows || rows.length === 0) return null;
  return (
    <GlassCard>
      <h4 className={cn("mb-2 text-sm font-bold", colorCls)}>{title}</h4>
      <div className="max-h-[40vh] overflow-auto rounded-xl border border-border/60">
        <table className="data-table">
          <thead>
            <tr>
              <th className="num">排名</th>
              <th>期货公司</th>
              <th className="num">持仓</th>
              <th className="num">增减</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const inc = num(r["indicatorIncrease"]);
              const incCls = inc != null && inc !== 0 ? (inc > 0 ? "text-red-500" : "text-emerald-500") : "";
              return (
                <tr key={`${r.memberName ?? ""}-${i}`}>
                  <td className="num">{r.rank ?? i + 1}</td>
                  <td>{r.memberName ?? "-"}</td>
                  <td className="num tabular-nums">{r.indicator != null ? Number(r.indicator).toLocaleString() : "-"}</td>
                  <td className={cn("num tabular-nums", incCls)}>
                    {inc != null ? (inc > 0 ? "+" : "") + inc.toLocaleString() : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

function PositionRankPanel() {
  const [kind, setKind] = useState<PosKind>("future");
  const [products, setProducts] = useState<OvlabPositionProducts | null>(null);
  const [product, setProduct] = useState("RB");
  const [code, setCode] = useState("");
  const [day, setDay] = useState("");
  const [direction, setDirection] = useState<"C" | "P">("C");
  const [futDetail, setFutDetail] = useState<OvlabFuturePositionDetails | null>(null);
  const [optDetail, setOptDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 加载品种列表
  const loadProducts = useCallback(async (k: PosKind) => {
    try {
      const d = k === "future" ? await api.ovlabFuturePositionProducts() : await api.ovlabOptionPositionProducts();
      setProducts(d);
      const ps = d.products ?? [];
      if (ps.length > 0) {
        const cur = ps.find((p) => p.product === product);
        const target = cur ?? ps[0];
        setProduct(target.product);
        setCode(target.codes[0] ?? "");
        setDay(d.last_trading_day ?? "");
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "加载品种失败");
      setProducts(null);
    }
  }, [product]);

  useEffect(() => { void loadProducts(kind); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind]);

  const load = useCallback(async () => {
    const p = product.trim();
    const c = code.trim();
    const dy = day.trim();
    if (!p || !c || !dy) return;
    setLoading(true); setErr(null);
    try {
      if (kind === "future") {
        const d = await api.ovlabFuturePositionDetails(p, c, dy);
        setFutDetail(d);
        setOptDetail(null);
      } else {
        const d = await api.ovlabOptionPositionDetails(p, c, direction, dy);
        setOptDetail(d);
        setFutDetail(null);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "加载失败");
      setFutDetail(null); setOptDetail(null);
    } finally { setLoading(false); }
  }, [kind, product, code, day, direction]);

  const { auto, setAuto, ms, setMs, lastUpdate, doLoad } = useAutoRefresh(load, { defaultOn: false, defaultMs: 300000 });
  useEffect(() => { void doLoad(); }, [doLoad]);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); await doLoad(); setRefreshing(false); };

  const prodList = products?.products ?? [];
  const curProd = prodList.find((p) => p.product === product);
  const codes = curProd?.codes ?? [];

  const fmtName = (v: unknown) => (v != null ? String(v) : "-");
  const hasOptData = optDetail != null && Object.keys(optDetail).length > 0;

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); void refresh(); }} className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">类型</label>
          <select value={kind} onChange={(e) => { setKind(e.target.value as PosKind); }}
            className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50">
            <option value="future">期货持仓</option>
            <option value="option">期权持仓</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">品种</label>
          <select value={product} onChange={(e) => {
            const np = e.target.value;
            setProduct(np);
            const p = prodList.find((x) => x.product === np);
            if (p && p.codes[0]) setCode(p.codes[0]);
          }} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50">
            {prodList.map((p) => (
              <option key={p.product} value={p.product}>{p.product} · {p.product_alias}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">合约</label>
          <select value={code} onChange={(e) => setCode(e.target.value)}
            className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50">
            {codes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {kind === "option" && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">方向</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as "C" | "P")}
              className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50">
              <option value="C">Call (C)</option>
              <option value="P">Put (P)</option>
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">日期</label>
          <input value={day} onChange={(e) => setDay(e.target.value)} placeholder="YYYY-MM-DD"
            className="w-36 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50" />
        </div>
        <button type="submit" disabled={loading || refreshing || !product.trim() || !code.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {loading || refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} 查询
        </button>
      </form>

      <AutoRefreshBar auto={auto} setAuto={setAuto} ms={ms} setMs={setMs} lastUpdate={lastUpdate} onRefresh={refresh} refreshing={refreshing || loading} />

      {err ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" /> {err}</div>
      ) : kind === "future" ? (
        futDetail ? (
          <div className="mt-3 space-y-3">
            <GlassCard>
              <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm">
                <div><span className="text-muted-foreground">合约</span> <b className="ml-1.5">{fmtName(futDetail.futureName)}</b> <span className="ml-1 text-xs text-muted-foreground">{futDetail.instrument}</span></div>
                <div><span className="text-muted-foreground">交易日</span> <span className="ml-1.5 tabular-nums">{futDetail.tradingDay ?? day}</span></div>
                {futDetail.maxNetLong?.memberName && <div><span className="text-emerald-500">净多第一</span> <b className="ml-1.5">{futDetail.maxNetLong.memberName}</b> <span className="ml-1 tabular-nums">{futDetail.maxNetLong.netIndicator?.toLocaleString()}</span></div>}
                {futDetail.maxNetShort?.memberName && <div><span className="text-red-500">净空第一</span> <b className="ml-1.5">{futDetail.maxNetShort.memberName}</b> <span className="ml-1 tabular-nums">{futDetail.maxNetShort.netIndicator?.toLocaleString()}</span></div>}
              </div>
            </GlassCard>
            <div className="grid gap-3 lg:grid-cols-2">
              <RankTable title="买方持仓排名 (多头)" rows={futDetail.long_rank_table ?? []} colorCls="text-emerald-500" />
              <RankTable title="卖方持仓排名 (空头)" rows={futDetail.short_rank_table ?? []} colorCls="text-red-500" />
              <RankTable title="净多头排名" rows={futDetail.net_long_rank_table ?? []} colorCls="text-emerald-500" />
              <RankTable title="净空头排名" rows={futDetail.net_short_rank_table ?? []} colorCls="text-red-500" />
            </div>
            <p className="text-[11px] text-muted-foreground">数据来自期货交易所每日公布的持仓排名榜; 增减相对前一交易日; 红涨绿跌 (A股配色)。</p>
          </div>
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">{loading ? "加载中..." : "选择品种与合约后查询持仓排名"}</p>
        )
      ) : (
        <div className="mt-3">
          {hasOptData ? (
            <GlassCard>
              <h4 className="mb-2 text-sm font-bold">期权持仓明细 · {product} {code} {direction}（{day}）</h4>
              <pre className="max-h-[60vh] overflow-auto rounded-xl border border-border/60 bg-muted/20 p-3 text-xs">{JSON.stringify(optDetail, null, 2)}</pre>
            </GlassCard>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">{loading ? "加载中..." : "该合约无期权持仓明细数据 (交易所未公布或该合约无排名)"}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function Ovlab() {
  const [tab, setTab] = useState<Tab>("market");
  const [chartSymbol, setChartSymbol] = useState("");

  return (
    <div>
      <PageHeader
        title="期权 / 期货波动率"
        subtitle="OpenVlab 公开数据 · 市场概览 / 详情 / 期权&期货期限结构 / 异动榜 / 持仓历史 · 只客观呈现, 不推荐不预测"
      />

      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/20 p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors",
              tab === key
                ? "bg-primary/15 font-medium text-primary shadow-glow"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "market" && <MarketPanel onPickSymbol={(s) => { setChartSymbol(s); setTab("chart"); }} />}
      {tab === "detail" && <DetailPanel />}
      {tab === "flow-alert" && <FlowAlertPanel />}
      {tab === "flow-data" && <FlowDataPanel />}
      {tab === "warehouse" && <WarehousePanel />}
      {tab === "chart" && <LightChartPanel initialSymbol={chartSymbol} />}
      {tab === "vol-surface" && <VolSurfacePanel />}
      {tab === "position" && <PositionRankPanel />}

      <Disclaimer />
    </div>
  );
}
