import { useState, useEffect, useCallback, useRef, useMemo, useId } from "react";
import { createPortal } from "react-dom";
import * as echarts from "echarts";
import { RefreshCw, Loader2, AlertCircle, Search, Activity, Zap, History, ArrowUp, ArrowDown, ArrowUpDown, CandlestickChart, Table2, X, ChevronLeft, ChevronRight, MessagesSquare, TrendingUp, TrendingDown, Minus, Moon, CircleHelp, CalendarDays, ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, ApiError, type OvlabMarketRow, type OvlabFlowAlert, type OvlabWarehouseHistory, type OvlabPositionProducts, type OvlabFuturePositionDetails, type OvlabRankRow, type OvlabFlowDataRow, type OvlabProductExp, type OvlabSearchItem, type OvlabPriceVolSeriesItem, type FinoOverviewRow, type FinoDetailRow } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "market" | "detail" | "flow-alert" | "flow-data" | "warehouse" | "chart" | "vol-surface" | "position" | "fino";

const TABS: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: "market", label: "市场概览", icon: Activity },
  { key: "chart", label: "轻量图表", icon: CandlestickChart },
  { key: "detail", label: "单品种详情", icon: Search },
  { key: "vol-surface", label: "T型报价", icon: Table2 },
  { key: "flow-alert", label: "异动榜", icon: Zap },
  { key: "flow-data", label: "异动资金流", icon: Zap },
  { key: "warehouse", label: "持仓历史", icon: History },
  { key: "position", label: "持仓排名", icon: Table2 },
  { key: "fino", label: "机构观点", icon: MessagesSquare },
];

// 市场概览表格列 (字段 -> 表头), 与后端 MARKET_OVERVIEW_COLUMNS 对齐
const MARKET_COLS: { key: keyof OvlabMarketRow; label: string; cls?: string; sortable?: boolean; title?: string }[] = [
  { key: "product_alias", label: "品种", sortable: true },
  { key: "price", label: "最新价", cls: "text-right tabular-nums", sortable: true },
  { key: "ctn", label: "标的涨跌幅", cls: "text-right tabular-nums", sortable: true, title: "标的价格涨跌幅\n展示标的价格的涨跌幅, 其值基于标的当前最新价格和前一交易日收盘价计算得出。\n\n标的价格涨跌幅帮助您了解标的资产的短期和长期走势。" },
  { key: "expiry_date", label: "剩余天数", cls: "text-right tabular-nums", sortable: true, title: "主力合约距到期日的剩余自然日 (今天=0; 已过期为负)" },
  { key: "atmv_current", label: "平值隐波", cls: "text-right tabular-nums", sortable: true, title: "当月的平值期权所对应的隐含波动率。\n一般来讲, 并没有恰好对应平值价格的行权价可以交易,\n所以我们会选择最接近平值价格的两个行权价的隐波进行加权平均。\n\n该项指标反映标的资产的预期波动水平。\n\n特别说明:\n各平台计算平值隐波的方法存在差异, 绝对值可能不同。\n建议关注隐波走势的连贯性, 而非与其他平台数值的对比。\n\n隐含波动率的意义:\n1. 市场预期: 反映市场对未来标的价格波动幅度的预期\n2. 风险指标: 隐波越高, 市场预期风险越大\n3. 期权定价: 是期权BS定价模型中的关键参数\n4. 交易信号: 隐波的变化趋势可用于判断市场情绪\n\n判断隐波是否合理的方法:\n1. 与历史波动率对比: 隐波通常高于历史波动率\n2. 检查隐波期限结构: 通常应呈现平滑曲线\n3. 关注隐波百分位: 极高或极低值可能预示反转\n4. 对比波动率溢价: 溢价过高表示隐波可能被高估" },
  { key: "atmv_1dchg", label: "隐波变化", cls: "text-right tabular-nums", sortable: true },
  { key: "rv22", label: "实波", cls: "text-right tabular-nums", sortable: true, title: "实际波动率 (1个月滚动窗口)\n选定过去一个月(22个交易日)滚动窗口,\n标的资产的实际波动率。\n\n该项指标反映标的资产的历史波动水平。" },
  { key: "valphaT", label: "隐波涨速", cls: "text-right tabular-nums", sortable: true, title: "隐波涨速\n隐含波动率增大或减小的速度, 时间窗口为过去5到10分钟左右。\n\n如果隐波涨速>0, 且数值越大, 则当前隐波向上增长越快。\n如果隐波涨速<0, 且数值越小, 则当前隐波向下衰减越快。\n\n该项指标反映隐含波动率的涨跌速度。" },
  { key: "carry", label: "溢价", cls: "text-right tabular-nums", sortable: true, title: "波动率溢价\n隐含波动率与实际波动率的差值。\n隐含波动率代表期权的价格, 实际波动率代表期权的价值。\n\n如果溢价>0, 则期权被高估, 建议做义务方, 或者叫期权卖方。\n如果溢价<0, 则期权被低估, 建议做权利方, 或者叫期权买方。\n\n该项指标反映期权的性价比。" },
  { key: "skew_current", label: "偏度", cls: "text-right tabular-nums", sortable: true, title: "偏度\n当月的虚值看涨(delta=0.25)与虚值看跌(delta=-0.25)期权所对应的IV的差值。\n\n如果该值为>0, 则预期标的资产上涨;\n如果该值为<0, 则预期标的资产下跌。\n\n该项指标反映对于标的资产的未来方向预期。" },
  { key: "skew_1dchg", label: "偏度日变化", cls: "text-right tabular-nums", sortable: true },
  { key: "atmv_percentile", label: "隐波百分位", cls: "text-right tabular-nums", sortable: true, title: "平值隐波百分位\n平值隐波(1个月滚动窗口)的现值处于过去一年历史数据中的百分位。\n这个指标对应的就是海外流行的IVP指标(Implied Volatility Percentile)。\n\n该值处于0%至100%之间。\n越接近0%表示隐波越便宜, 建议以买权为主。\n越接近100%表示隐波越贵, 建议以卖权为主。\n\n该项指标反映隐含波动率的相对水平。" },
  { key: "skew_percentile", label: "偏度百分位", cls: "text-right tabular-nums", sortable: true, title: "隐波偏度百分位\n隐波偏度(1个月滚动窗口)的现值处于过去一年历史数据中的百分位。\n\n该值处于0%至100%之间。\n越接近0%表示标的资产下跌预期越强烈,\n越接近100%表示标的资产上涨预期越强烈。\n\n该项指标反映隐波偏度的相对水平。" },
  { key: "frontfwd_mom", label: "近远月动量", cls: "text-right tabular-nums", sortable: true },
];

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
}

/** Remaining calendar days until expiry_date (YYYYMMDD or YYYY-MM-DD). Today = 0. */
function daysToExpiry(v: unknown): number | null {
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

// 可排序表头; 有 title 说明时末尾带圈问号
function SortableTh<T extends Record<string, unknown>>({ col, sort, onSort, large }: {
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
function ExpiryCalendar({ data, selectedDate, onPick, onClear }: {
  data: OvlabProductExp[];
  selectedDate: string | null;
  onPick: (date: string) => void;
  onClear: () => void;
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

  const [expanded, setExpanded] = useState(false);
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
  const expiryDays = byDate.size;

  // Upcoming expiry dates (today and after), for compact chips
  const upcoming = [...byDate.keys()].filter((d) => d >= today).sort().slice(0, 6);

  const fmtChip = (ds: string) => {
    const m = ds.slice(4, 6);
    const day = ds.slice(6, 8);
    const n = byDate.get(ds)?.length ?? 0;
    return { label: `${Number(m)}/${Number(day)}`, count: n };
  };

  return (
    <GlassCard className="!py-2.5 !px-3">
      {/* Compact bar: always visible */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
          aria-expanded={expanded}
        >
          <CalendarDays className="h-4 w-4 text-primary" />
          期权到期
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")} />
        </button>
        <span className="text-xs tabular-nums text-muted-foreground">{expiryDays} 个到期日</span>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {upcoming.map((ds) => {
            const { label, count } = fmtChip(ds);
            const active = ds === selectedDate;
            return (
              <button
                key={ds}
                type="button"
                title={`${ds.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")} · ${count} 个品种`}
                onClick={() => (active ? onClear() : onPick(ds))}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs tabular-nums transition-colors",
                  active
                    ? "border-primary/50 bg-primary/15 font-medium text-primary"
                    : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/35 hover:text-foreground",
                )}
              >
                {label}
                <span className="ml-1 opacity-60">{count}</span>
              </button>
            );
          })}
          {upcoming.length === 0 && (
            <span className="text-xs text-muted-foreground/70">近期待无到期</span>
          )}
        </div>

        {selectedDate && (
          <button type="button" onClick={onClear}
            className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/20">
            清除筛选 <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Full month grid: only when expanded */}
      {expanded && (
        <div className="mt-3 border-t border-border/40 pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500/80" /> 单品种</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500/80" /> 多交易所</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={prevMonth} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[96px] text-center text-sm font-semibold tabular-nums">{monthLabel}</span>
              <button type="button" onClick={nextMonth} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
              <button type="button" onClick={() => setView({ y: new Date().getFullYear(), m: new Date().getMonth() })}
                className="ml-1 rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">今日</button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
            {["日", "一", "二", "三", "四", "五", "六"].map((w, idx) => (
              <div key={w} className={cn("py-0.5 font-medium", idx === 0 || idx === 6 ? "text-red-400/70" : "text-muted-foreground")}>{w}</div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (d === null) return <div key={i} />;
              const ds = fmtD(d);
              const list = byDate.get(ds) ?? [];
              const isToday = ds === today;
              const isSelected = ds === selectedDate;
              const hasExpiry = list.length > 0;
              const exCodes = [...new Set(list.map((x) => x.ex))].filter(Boolean);
              const exItems = exCodes.map((ex) => {
                const items = list.filter((x) => x.ex === ex);
                const single = items.length === 1;
                const label = single ? (items[0].alias || items[0].und) : exName(ex);
                return { ex, name: exName(ex), items, single, label: label.length > 4 ? label.slice(0, 4) : label };
              });
              const showEx = exItems.slice(0, 2);
              const more = exItems.length - showEx.length;
              return (
                <button key={i} type="button" onClick={() => { if (hasExpiry) onPick(ds); else onClear(); }}
                  className={cn(
                    "relative flex h-12 flex-col items-center justify-start gap-0.5 rounded-lg border pt-1 px-0.5 text-xs transition-all",
                    !hasExpiry && "border-transparent text-muted-foreground/30 hover:border-border/40 hover:bg-muted/30",
                    hasExpiry && !isSelected && "border-primary/25 bg-primary/[0.03] hover:bg-primary/10 hover:border-primary/45",
                    isSelected && "border-primary bg-primary text-primary-foreground shadow-glow",
                  )}>
                  {isToday && !isSelected ? (
                    <span className="absolute left-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-blue-500 bg-blue-500/15 text-[11px] leading-none font-bold text-blue-600 dark:text-blue-400">{d}</span>
                  ) : (
                    <span className={cn("absolute left-1 top-0.5 text-[11px] leading-none", isSelected && "font-bold")}>{d}</span>
                  )}
                  {showEx.length > 0 && (
                    <span className="mt-3.5 flex w-full flex-wrap items-center justify-center gap-0.5 px-0.5 leading-none">
                      {showEx.map((it) => (
                        <span key={it.ex} className="group/ex relative cursor-default">
                          <span className={cn(
                            "rounded-full px-1.5 py-px text-[10px] leading-tight",
                            isSelected
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : it.single
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                          )}>{it.label}</span>
                          <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-border/60 bg-background px-2.5 py-2 text-[10px] shadow-xl group-hover/ex:block">
                            <span className="font-semibold text-primary">{it.name}</span>
                            <span className="ml-1 text-muted-foreground">{ds.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}</span>
                            <span className="ml-1 rounded-full bg-muted/40 px-1.5 text-muted-foreground">{it.items.length}</span>
                            <span className="mt-1.5 block max-w-[220px] leading-relaxed text-muted-foreground">{it.items.map((p) => p.alias || p.und).join(" · ")}</span>
                          </span>
                        </span>
                      ))}
                      {more > 0 && <span className={cn("text-[10px]", isSelected ? "text-primary-foreground/70" : "text-muted-foreground/70")}>+{more}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </GlassCard>
  );
}

/** Build OpenVlab preview code: prodUnd:exp (e.g. MA:202609) */
function previewCode(r: Pick<OvlabMarketRow, "prodUnd" | "exp">): string {
  const und = String(r.prodUnd ?? "").trim();
  const exp = String(r.exp ?? "").trim();
  return und && exp ? `${und}:${exp}` : "";
}

type PreviewSeries = { prices: Array<[string, number]>; volatilities: Array<[string, number]> };

const TREND_RED = "#ef4444";
const TREND_GREEN = "#22c55e";
const TREND_PINK = "#f472b6";

/** Dual-line SVG spark: price vs zero-axis (first print) with red/green area; IV in pink. */
function TrendSparkSvg({
  prices, volatilities, width = 88, height = 36, className,
}: {
  prices: Array<[string, number]>;
  volatilities: Array<[string, number]>;
  width?: number;
  height?: number;
  className?: string;
}) {
  const pad = 2;
  const uid = useId().replace(/:/g, "");

  const priceVals = prices.map((p) => Number(p[1])).filter((n) => Number.isFinite(n));
  const volVals = volatilities.map((p) => Number(p[1])).filter((n) => Number.isFinite(n));

  if (priceVals.length < 2 && volVals.length < 2) {
    return (
      <svg width={width} height={height} className={cn("text-muted-foreground/40", className)} aria-hidden>
        <line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke="currentColor" strokeDasharray="3 3" />
      </svg>
    );
  }

  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  // Price: zero axis = first print; scale includes zero so baseline stays visible
  const zero = priceVals[0] ?? 0;
  const pMin = priceVals.length ? Math.min(...priceVals, zero) : 0;
  const pMax = priceVals.length ? Math.max(...priceVals, zero) : 1;
  const pSpan = pMax - pMin || 1;
  const xAt = (i: number, n: number) => pad + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const yPrice = (v: number) => pad + (1 - (v - pMin) / pSpan) * innerH;
  const zeroY = yPrice(zero);

  const pricePts = priceVals.map((v, i) => ({ x: xAt(i, priceVals.length), y: yPrice(v), v }));
  const priceLine = pricePts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  // Close area down/up to zero axis
  const priceArea = pricePts.length >= 2
    ? `${priceLine} L${pricePts[pricePts.length - 1].x.toFixed(1)},${zeroY.toFixed(1)} L${pricePts[0].x.toFixed(1)},${zeroY.toFixed(1)} Z`
    : "";

  // IV: independent normalize
  let volLine = "";
  if (volVals.length >= 2) {
    const vMin = Math.min(...volVals);
    const vMax = Math.max(...volVals);
    const vSpan = vMax - vMin || 1;
    volLine = volVals.map((v, i) => {
      const x = xAt(i, volVals.length);
      const y = pad + (1 - (v - vMin) / vSpan) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }

  const clipUp = `${uid}-up`;
  const clipDn = `${uid}-dn`;
  const gradUp = `${uid}-gup`;
  const gradDn = `${uid}-gdn`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <defs>
        {/* Screen-up (price above zero) = y smaller than zeroY */}
        <clipPath id={clipUp}><rect x={0} y={0} width={width} height={Math.max(0, zeroY)} /></clipPath>
        <clipPath id={clipDn}><rect x={0} y={zeroY} width={width} height={Math.max(0, height - zeroY)} /></clipPath>
        <linearGradient id={gradUp} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TREND_RED} stopOpacity="0.45" />
          <stop offset="100%" stopColor={TREND_RED} stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id={gradDn} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={TREND_GREEN} stopOpacity="0.45" />
          <stop offset="100%" stopColor={TREND_GREEN} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Zero axis */}
      {pricePts.length >= 2 && (
        <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="currentColor" className="text-muted-foreground/30" strokeWidth="1" strokeDasharray="2 2" />
      )}

      {/* Price area + line: red above zero, green below */}
      {priceArea && (
        <>
          <path d={priceArea} fill={`url(#${gradUp})`} clipPath={`url(#${clipUp})`} />
          <path d={priceArea} fill={`url(#${gradDn})`} clipPath={`url(#${clipDn})`} />
          <path d={priceLine} fill="none" stroke={TREND_RED} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${clipUp})`} />
          <path d={priceLine} fill="none" stroke={TREND_GREEN} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${clipDn})`} />
        </>
      )}

      {/* IV pink overlay */}
      {volLine ? (
        <path d={volLine} fill="none" stroke={TREND_PINK} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />
      ) : null}
    </svg>
  );
}

/** Inline spark + hover enlarged overlay (price + IV), like openvlab.cn/market TrendPreviewCell. */
function TrendPreviewCell({ series, loading }: { series?: PreviewSeries; loading?: boolean }) {
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
  const pChg = lastP != null && firstP != null && firstP !== 0 ? ((lastP - firstP) / firstP) * 100 : null;
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
          : <TrendSparkSvg prices={prices} volatilities={vols} />}
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
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-pink-400" />隐波</span>
            </span>
          </div>
          <TrendSparkSvg prices={prices} volatilities={vols} width={256} height={96} />
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

function PctPill({ value, digits = 2, suffix = "" }: { value: unknown; digits?: number; suffix?: string }) {
  // Missing upstream metrics default to 0 (e.g. new listings without IV)
  const n = num(value) ?? 0;
  const cls = n > 0 ? "up" : n < 0 ? "down" : "flat";
  const text = `${n > 0 ? "+" : ""}${n.toFixed(digits)}${suffix}`;
  return <span className={cn("pct-pill", cls)}>{text}</span>;
}

function PercentileBar({ value }: { value: unknown }) {
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

function MarketPanel({ onPickSymbol }: { onPickSymbol?: (symbol: string) => void }) {
  const [rows, setRows] = useState<OvlabMarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [expData, setExpData] = useState<OvlabProductExp[]>([]);
  const [expLoading, setExpLoading] = useState(false);
  const [expErr, setExpErr] = useState<string | null>(null);
  const [expDate, setExpDate] = useState<string | null>(null);
  const [onlyNight, setOnlyNight] = useState(false);
  const [sector, setSector] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<OvlabMarketRow>>({ key: "ctn", dir: "desc" });
  const [seriesMap, setSeriesMap] = useState<Record<string, PreviewSeries>>({});
  const [seriesLoading, setSeriesLoading] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try { setRows(await api.ovlabMarket()); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "加载失败"); }
    finally { setLoading(false); }
  }, []);

  const { auto, setAuto, ms, setMs, lastUpdate, doLoad } = useAutoRefresh(load, { defaultMs: 60000 });

  useEffect(() => { void doLoad(); }, [doLoad]);

  // Lazy-load expiry calendar once (surface errors; do not swallow)
  useEffect(() => {
    let cancelled = false;
    setExpLoading(true);
    setExpErr(null);
    api.ovlabProductExps()
      .then((d) => { if (!cancelled) setExpData(Array.isArray(d) ? d : []); })
      .catch((e) => { if (!cancelled) setExpErr(e instanceof ApiError ? e.message : "到期日历加载失败"); })
      .finally(() => { if (!cancelled) setExpLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Batch-load price+IV preview series (same source as openvlab.cn/market TrendPreview)
  const previewCodes = useMemo(
    () => [...new Set(rows.map((r) => previewCode(r)).filter(Boolean))].sort(),
    [rows],
  );
  const previewCodesKey = previewCodes.join("|");

  useEffect(() => {
    if (previewCodes.length === 0) return;
    let cancelled = false;
    const codes = previewCodes;
    const loadSeries = () => {
      setSeriesLoading(true);
      api.ovlabPriceVolatilitySeries(codes)
        .then((items: OvlabPriceVolSeriesItem[]) => {
          if (cancelled) return;
          const next: Record<string, PreviewSeries> = {};
          for (const it of items ?? []) {
            const sym = String(it.symbol ?? "").trim();
            if (!sym) continue;
            next[sym] = {
              prices: Array.isArray(it.prices) ? it.prices as Array<[string, number]> : [],
              volatilities: Array.isArray(it.volatilities) ? it.volatilities as Array<[string, number]> : [],
            };
          }
          for (const c of codes) {
            if (!(c in next)) next[c] = { prices: [], volatilities: [] };
          }
          setSeriesMap(next);
        })
        .catch((e) => {
          console.warn("[trend-preview] load failed:", e instanceof ApiError ? e.message : e);
        })
        .finally(() => { if (!cancelled) setSeriesLoading(false); });
    };
    loadSeries();
    const id = window.setInterval(loadSeries, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by previewCodesKey
  }, [previewCodesKey]);

  const refresh = async () => { setRefreshing(true); await doLoad(); setRefreshing(false); };

  const expUnds = new Set<string>();
  if (expDate) {
    for (const p of expData) {
      if ((p.exps ?? []).some((e) => String(e.expDate ?? "") === expDate)) {
        if (p.product_und) expUnds.add(p.product_und);
      }
    }
  }

  const sectors = (() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const s = String(r.sector_alias || "").trim();
      if (!s) continue;
      m.set(s, (m.get(s) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"));
  })();

  const f = filter.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (onlyNight && !Number(r.has_night_trading)) return false;
    if (sector && String(r.sector_alias || "") !== sector) return false;
    if (expDate && r.prodUnd && !expUnds.has(r.prodUnd)) return false;
    if (!f) return true;
    return [r.product_alias, r.prodUnd, r.exchange, r.sector_alias]
      .some((x) => String(x ?? "").toLowerCase().includes(f));
  });
  const shown = (() => {
    if (sort.key !== "expiry_date") return sortRows(filtered, sort);
    // Sort by remaining days, not raw date string
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const an = daysToExpiry(a.expiry_date);
      const bn = daysToExpiry(b.expiry_date);
      if (an !== null && bn !== null) return (an - bn) * mul;
      if (an !== null) return -1;
      if (bn !== null) return 1;
      return 0;
    });
  })();

  return (
    <div>
      <GlassCard className="mb-3 !p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[200px]">
            <div className="relative flex-1 min-w-[200px] max-w-lg">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="搜索品种 / 标的 / 交易所 / 板块"
                className="w-full rounded-xl border border-border/60 bg-background/40 py-2.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary/50 focus:bg-background/60"
              />
            </div>
            {expDate && (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">
                到期 {expDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}
                <button type="button" onClick={() => setExpDate(null)} className="rounded p-0.5 hover:bg-primary/20"><X className="h-3.5 w-3.5" /></button>
              </span>
            )}
            <button type="button" onClick={() => setOnlyNight((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors",
                onlyNight ? "border-primary/50 bg-primary/15 text-primary" : "border-border/60 bg-background/30 text-muted-foreground hover:text-foreground",
              )}
              title="只显示有夜盘的品种">
              <Moon className="h-4 w-4" /> 仅夜盘
            </button>
          </div>
          <AutoRefreshBar auto={auto} setAuto={setAuto} ms={ms} setMs={setMs} lastUpdate={lastUpdate} onRefresh={refresh} refreshing={refreshing || loading} />
        </div>

        {sectors.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-3">
            <button type="button" onClick={() => setSector(null)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                !sector ? "border-primary/50 bg-primary/15 font-medium text-primary" : "border-border/50 bg-muted/20 text-muted-foreground hover:text-foreground",
              )}>
              全部 {rows.length}
            </button>
            {sectors.map(([name, cnt]) => (
              <button key={name} type="button" onClick={() => setSector((s) => (s === name ? null : name))}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  sector === name ? "border-primary/50 bg-primary/15 font-medium text-primary" : "border-border/50 bg-muted/20 text-muted-foreground hover:text-foreground",
                )}>
                {name} <span className="opacity-70">{cnt}</span>
              </button>
            ))}
          </div>
        )}
      </GlassCard>

      <div className="mb-3">
        {expLoading && expData.length === 0 ? (
          <GlassCard className="!py-2.5 !px-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载期权到期...
            </div>
          </GlassCard>
        ) : expErr && expData.length === 0 ? (
          <GlassCard className="!py-2.5 !px-3">
            <div className="flex items-center justify-between gap-2 text-sm text-destructive">
              <span className="inline-flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> {expErr}</span>
              <button type="button" className="rounded-lg border border-border/60 px-2.5 py-1 text-xs text-foreground hover:bg-muted/40"
                onClick={() => {
                  setExpLoading(true); setExpErr(null);
                  api.ovlabProductExps()
                    .then((d) => setExpData(Array.isArray(d) ? d : []))
                    .catch((e) => setExpErr(e instanceof ApiError ? e.message : "到期日历加载失败"))
                    .finally(() => setExpLoading(false));
                }}>重试</button>
            </div>
          </GlassCard>
        ) : (
          <ExpiryCalendar
            data={expData}
            selectedDate={expDate}
            onPick={setExpDate}
            onClear={() => setExpDate(null)}
          />
        )}
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
        <GlassCard className="!p-0 overflow-hidden">
          <div className="market-toolbar">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">市场报价</span>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium tabular-nums text-primary">
                {shown.length}/{rows.length}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">悬停走势看价格+隐波 · 点行跳转轻量图表 · 首列冻结</span>
          </div>
          <div className="max-h-[62vh] overflow-auto">
            <table className="data-table market-table">
              <thead>
                <tr>
                  {MARKET_COLS.map((c) => (
                    <SortableTh key={c.key} col={c} sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} large />
                  )).flatMap((th, idx) => {
                    // Insert "走势" header after 品种 (first col)
                    if (idx !== 0) return [th];
                    return [
                      th,
                      <th key="trend-preview" title="当日分时价格与平值隐波叠加预览 (悬停放大)" className="text-center">
                        <span className="inline-flex items-center gap-1">
                          走势
                          <CircleHelp className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-label="字段说明" />
                        </span>
                      </th>,
                    ];
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const sym = String(r.prodUnd ?? "") + String(r.exp ?? "").slice(-4);
                  const pCode = previewCode(r);
                  const night = Number(r.has_night_trading) === 1;
                  const overseas = Number(r.is_overseas) === 1;
                  return (
                    <tr key={`${r.prodUnd ?? i}-${r.exp ?? ""}`}
                      onClick={onPickSymbol && sym ? () => onPickSymbol(sym) : undefined}
                      className={onPickSymbol && sym ? "cursor-pointer" : undefined}>
                      {MARKET_COLS.flatMap((c) => {
                        const v = r[c.key];
                        const sortCls = sort.key === c.key ? "sort-active" : undefined;
                        if (c.key === "product_alias") {
                          // Market overview rows carry main-contract month in `exp`
                          const mainExp = String(r.exp ?? "").trim();
                          const mainShort = mainExp.length >= 4 ? mainExp.slice(-4) : mainExp;
                          return [
                            <td key={c.key} className={sortCls}>
                              <div className="flex min-w-[7rem] flex-col gap-0.5">
                                <div className="flex items-center gap-1.5">
                                  {mainExp ? (
                                    <span
                                      className="inline-flex shrink-0 items-center rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-bold leading-none text-primary"
                                      title={`主力合约 ${mainExp}`}
                                    >
                                      主
                                    </span>
                                  ) : null}
                                  <span className="text-[15px] font-semibold tracking-tight">{String(r.product_alias ?? "-")}</span>
                                  {r.prodUnd ? <span className="rounded bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{String(r.prodUnd)}</span> : null}
                                  {night ? <Moon className="h-3.5 w-3.5 text-sky-400/90" aria-label="夜盘" /> : null}
                                  {overseas ? <span className="rounded border border-border/60 px-1 text-[11px] text-muted-foreground">外</span> : null}
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  {mainShort ? <span className="tabular-nums text-primary/80">{mainShort}</span> : null}
                                  {r.sector_alias ? <span>{mainShort ? "· " : ""}{String(r.sector_alias)}</span> : null}
                                  {r.exchange ? <span className="opacity-70">· {String(r.exchange)}</span> : null}
                                </div>
                              </div>
                            </td>,
                            <td key="trend-preview" className="text-center">
                              <TrendPreviewCell
                                series={pCode ? seriesMap[pCode] : undefined}
                                loading={seriesLoading && !(pCode && seriesMap[pCode])}
                              />
                            </td>,
                          ];
                        }
                        if (c.key === "price") {
                          const n = num(v);
                          return (
                            <td key={c.key} className={cn("num font-medium", sortCls)}>
                              {n === null
                                ? <span className="nil">-</span>
                                : Number(n.toFixed(2)).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
                            </td>
                          );
                        }
                        if (c.key === "ctn") {
                          // Upstream ctn is a decimal ratio (e.g. -0.0031); show as percent with 2 decimals
                          const n = num(v) ?? 0;
                          return <td key={c.key} className={cn("num", sortCls)}><PctPill value={n * 100} suffix="%" /></td>;
                        }
                        if (c.key === "atmv_1dchg" || c.key === "skew_1dchg" || c.key === "frontfwd_mom" || c.key === "valphaT" || c.key === "carry") {
                          return <td key={c.key} className={cn("num", sortCls)}><PctPill value={v} /></td>;
                        }
                        if (c.key === "atmv_current" || c.key === "rv22" || c.key === "skew_current") {
                          const n = num(v) ?? 0;
                          return (
                            <td key={c.key} className={cn("num tabular-nums", sortCls)}>
                              {n.toFixed(2)}
                            </td>
                          );
                        }
                        if (c.key === "atmv_percentile" || c.key === "skew_percentile") {
                          return <td key={c.key} className={cn("num", sortCls)}><PercentileBar value={v} /></td>;
                        }
                        if (c.key === "expiry_date") {
                          const dte = daysToExpiry(v);
                          if (dte === null) return <td key={c.key} className={cn("num nil", sortCls)}>-</td>;
                          const tip = String(v ?? "");
                          const tone = dte < 0
                            ? "text-muted-foreground"
                            : dte <= 7
                              ? "text-red-500 font-semibold"
                              : dte <= 30
                                ? "text-amber-500"
                                : "text-muted-foreground";
                          const label = dte < 0 ? `已过${-dte}天` : dte === 0 ? "今天" : `${dte}天`;
                          return (
                            <td key={c.key} className={cn("num tabular-nums", tone, sortCls)} title={tip}>
                              {label}
                            </td>
                          );
                        }
                        const display = String(v ?? "-");
                        return (
                          <td key={c.key} className={cn(c.cls?.includes("text-right") && "num", (display === "-" || display === "") && "nil", sortCls)}>
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
        </GlassCard>
      )}
      {shown.length < rows.length && (
        <p className="mt-2 text-xs text-muted-foreground/70">有筛选生效</p>
      )}
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
    const cPtr = cssHsl("--primary", "#f35d2b");

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
          fillerColor: "rgba(243,93,43,0.15)",
          handleStyle: { color: cPtr },
          moveHandleStyle: { color: cPtr },
          dataBackground: { lineStyle: { color: cAxis }, areaStyle: { color: "rgba(148,163,184,0.15)" } },
          selectedDataBackground: { lineStyle: { color: cPtr }, areaStyle: { color: "rgba(243,93,43,0.12)" } },
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

function RankChart({ title, rows, color }: { title: string; rows: OvlabRankRow[]; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    instRef.current = echarts.init(ref.current);
    const onResize = () => instRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); instRef.current?.dispose(); instRef.current = null; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;
    const data = [...rows].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    const names = data.map((r) => String(r.memberName ?? "-"));
    const vals = data.map((r) => Number(r.indicator ?? 0));
    const maxV = vals.length ? Math.max(...vals) : 0;
    const xMax = maxV > 0 ? Math.ceil((maxV * 1.05) / 1000) * 1000 : undefined;
    inst.setOption({
      title: { text: title, left: 8, top: 4, textStyle: { fontSize: 13, fontWeight: "bold", color } },
      grid: { left: 8, right: 16, top: 28, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: { dataIndex: number }) => {
          const r = data[p.dataIndex];
          const inc = r.indicatorIncrease;
          const incStr = inc != null ? (inc > 0 ? "+" : "") + Number(inc).toLocaleString() : "-";
          const incColor = inc != null && inc !== 0 ? (inc > 0 ? "#ef4444" : "#10b981") : "hsl(var(--muted-foreground))";
          return `${r.memberName ?? "-"}<br/>排名 ${r.rank ?? p.dataIndex + 1}<br/>持仓 <b>${Number(r.indicator ?? 0).toLocaleString()}</b><br/>增减 <span style="color:${incColor}">${incStr}</span>`;
        },
      },
      xAxis: { type: "value", max: xMax, axisLabel: { color: "hsl(var(--muted-foreground))", fontSize: 10 }, splitLine: { lineStyle: { color: "hsl(var(--border))", opacity: 0.25 } } },
      yAxis: { type: "category", data: names, inverse: true, axisLabel: { color: "hsl(var(--foreground))", fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } },
      series: [{
        type: "bar",
        data: vals,
        itemStyle: { color, borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: "right", formatter: (p: { value: number }) => Number(p.value).toLocaleString(), fontSize: 10, color: "hsl(var(--muted-foreground))" },
        barMaxWidth: 24,
      }],
    }, true);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [rows, title, color]);
  if (!rows || rows.length === 0) return null;
  return (
    <GlassCard>
      <div ref={ref} style={{ height: Math.max(160, rows.length * 26 + 36) }} />
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
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
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
              <RankChart title="买方持仓排名 (多头)" rows={futDetail.long_rank_table ?? []} color="#10b981" />
              <RankChart title="卖方持仓排名 (空头)" rows={futDetail.short_rank_table ?? []} color="#ef4444" />
              <RankChart title="净多头排名" rows={futDetail.net_long_rank_table ?? []} color="#10b981" />
              <RankChart title="净空头排名" rows={futDetail.net_short_rank_table ?? []} color="#ef4444" />
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
      {tab === "fino" && <FinoViewsPanel />}

      <Disclaimer />
    </div>
  );
}

// —— Fino 机构观点 ——
const FINO_BULL = "#e4260c";
const FINO_NEU = "#9ca3af";
const FINO_BEAR = "#53a12a";

function finoTotal(r: FinoOverviewRow): number {
  return (Number(r.bull_count) || 0) + (Number(r.neutral_count) || 0) + (Number(r.bear_count) || 0);
}

function finoRatingMeta(rating: unknown): { label: string; cls: string; Icon: typeof TrendingUp } {
  const s = String(rating ?? "").trim();
  if (s === "+1" || s === "1") return { label: "看涨", cls: "border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-400", Icon: TrendingUp };
  if (s === "-1") return { label: "看跌", cls: "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", Icon: TrendingDown };
  return { label: "震荡", cls: "border-border/70 bg-muted/40 text-muted-foreground", Icon: Minus };
}

function FinoSentimentBar({ bull, neu, bear }: { bull: number; neu: number; bear: number }) {
  const t = bull + neu + bear || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
      <div style={{ width: `${(bull / t) * 100}%` }} className="bg-[#e4260c] transition-all" />
      <div style={{ width: `${(neu / t) * 100}%` }} className="bg-[#9ca3af] transition-all" />
      <div style={{ width: `${(bear / t) * 100}%` }} className="bg-[#53a12a] transition-all" />
    </div>
  );
}

function FinoViewsPanel() {
  const [reportType, setReportType] = useState<"daily" | "weekly">("daily");
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [codes, setCodes] = useState("");
  const [rows, setRows] = useState<FinoOverviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<FinoOverviewRow | null>(null);
  const [details, setDetails] = useState<FinoDetailRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFilter, setDetailFilter] = useState<"all" | "bull" | "neu" | "bear">("all");

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const d = await api.finoOverview(reportType, day, day, codes.trim());
      // Sort: active (>=5 houses) by bull+neu desc, then sparse by bull%
      const withTotal = d.map((r) => ({
        r,
        total: finoTotal(r),
        bull: Number(r.bull_percentage) || 0,
        neu: Number(r.neutral_percentage) || 0,
      }));
      const high = withTotal.filter((x) => x.total >= 5).sort((a, b) => (b.bull + b.neu) - (a.bull + a.neu) || b.bull - a.bull);
      const low = withTotal.filter((x) => x.total < 5).sort((a, b) => b.bull - a.bull);
      const sorted = [...high, ...low].map((x) => x.r);
      setRows(sorted);
      setSel((prev) => {
        if (!sorted.length) return null;
        if (prev) {
          const keep = sorted.find((r) => r.product_code === prev.product_code && r.product_name === prev.product_name);
          if (keep) return keep;
        }
        return sorted[0];
      });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "加载机构观点失败");
      setRows([]);
      setSel(null);
    } finally { setLoading(false); }
  }, [reportType, day, codes]);

  const { auto, setAuto, ms, setMs, lastUpdate, doLoad } = useAutoRefresh(load, { defaultOn: false, defaultMs: 600000 });
  useEffect(() => { void doLoad(); }, [doLoad]);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); await doLoad(); setRefreshing(false); };

  // Load per-house details when selection changes
  useEffect(() => {
    const code = (sel?.product_code || "").trim();
    if (!sel || !day.trim()) { setDetails([]); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDetailFilter("all");
    api.finoDetail(reportType, day, day, code)
      .then((d) => { if (!cancelled) setDetails(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setDetails([]); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [sel, reportType, day]);

  const chartRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);
  const selIdx = sel ? rows.findIndex((r) => r.product_code === sel.product_code && r.product_name === sel.product_name) : -1;

  useEffect(() => {
    if (!chartRef.current || rows.length === 0) return;
    if (!instRef.current) instRef.current = echarts.init(chartRef.current);
    const inst = instRef.current;
    const onResize = () => inst.resize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); };
  }, [rows.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => { instRef.current?.dispose(); instRef.current = null; };
  }, []);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst || rows.length === 0) return;
    const names = rows.map((r) => r.product_code ? `${r.product_name}(${r.product_code})` : (r.product_name ?? "-"));
    const bull = rows.map((r) => Number(r.bull_percentage) || 0);
    const neu = rows.map((r) => Number(r.neutral_percentage) || 0);
    const bear = rows.map((r) => Number(r.bear_percentage) || 0);
    const bullN = rows.map((r) => Number(r.bull_count) || 0);
    const neuN = rows.map((r) => Number(r.neutral_count) || 0);
    const bearN = rows.map((r) => Number(r.bear_count) || 0);
    // Keep ~72 rows in view per screen
    const visibleRows = 72;
    const needZoom = rows.length > visibleRows;
    const endPct = Math.min(100, (visibleRows / Math.max(rows.length, 1)) * 100);
    inst.resize();
    inst.setOption({
      animationDuration: 280,
      grid: { left: 4, right: needZoom ? 22 : 16, top: 44, bottom: 12, containLabel: true },
      tooltip: {
        trigger: "item",
        backgroundColor: "#ffffff",
        borderColor: "#e5e7eb",
        borderWidth: 1,
        padding: [10, 12],
        extraCssText: "box-shadow:0 8px 24px rgba(0,0,0,.12); opacity:1;",
        textStyle: { color: "#111827", fontSize: 12 },
        formatter: (p: { dataIndex: number; seriesName: string }) => {
          const r = rows[p.dataIndex];
          if (!r) return "";
          const tag = p.seriesName;
          const cnt = tag === "看涨" ? r.bull_count : tag === "震荡" ? r.neutral_count : r.bear_count;
          return `<div style="min-width:160px"><b>${r.product_name ?? "-"}${r.product_code ? " (" + r.product_code + ")" : ""}</b>`
            + `<br/><span style="color:#6b7280">机构数 ${finoTotal(r)}</span>`
            + `<br/>${tag}: <b>${cnt ?? 0} 家</b> · ${Number(tag === "看涨" ? r.bull_percentage : tag === "震荡" ? r.neutral_percentage : r.bear_percentage || 0).toFixed(1)}%`
            + `<br/><span style="color:#9ca3af;font-size:11px">点击查看逐条观点</span></div>`;
        },
      },
      legend: {
        data: ["看涨", "震荡", "看跌"],
        top: 6,
        right: 8,
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { fontSize: 11, color: "hsl(var(--muted-foreground))" },
      },
      dataZoom: needZoom ? [
        { type: "inside", yAxisIndex: 0, start: 0, end: endPct, zoomOnMouseWheel: false, moveOnMouseWheel: true },
        { type: "slider", yAxisIndex: 0, width: 12, right: 2, start: 0, end: endPct, brushSelect: false, showDetail: false },
      ] : [],
      xAxis: {
        type: "value",
        max: 100,
        axisLabel: { color: "hsl(var(--muted-foreground))", fontSize: 10, formatter: "{value}%" },
        splitLine: { lineStyle: { color: "hsl(var(--border))", opacity: 0.22, type: "dashed" } },
      },
      yAxis: {
        type: "category",
        data: names,
        inverse: true,
        axisLabel: {
          color: (_val: string, idx: number) => (idx === selIdx ? "hsl(var(--primary))" : "hsl(var(--foreground))"),
          fontSize: 12,
        },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      series: [
        {
          name: "看涨", type: "bar", stack: "v", data: bull,
          itemStyle: { color: FINO_BULL, borderRadius: [4, 0, 0, 4] },
          label: { show: true, formatter: (p: { dataIndex: number }) => bullN[p.dataIndex] || "", fontSize: 11, color: "#fff" },
          barMaxWidth: 34, barCategoryGap: "18%",
          emphasis: { focus: "series" },
        },
        {
          name: "震荡", type: "bar", stack: "v", data: neu,
          itemStyle: { color: FINO_NEU },
          label: { show: true, formatter: (p: { dataIndex: number }) => neuN[p.dataIndex] || "", fontSize: 11, color: "#fff" },
          barMaxWidth: 34,
        },
        {
          name: "看跌", type: "bar", stack: "v", data: bear,
          itemStyle: { color: FINO_BEAR, borderRadius: [0, 4, 4, 0] },
          label: { show: true, formatter: (p: { dataIndex: number }) => bearN[p.dataIndex] || "", fontSize: 11, color: "#fff" },
          barMaxWidth: 34,
          markLine: selIdx >= 0 ? {
            silent: true, symbol: "none",
            data: [{ yAxis: names[selIdx] }],
            lineStyle: { color: "hsl(var(--primary))", width: 1.5, type: "solid", opacity: 0.55 },
            label: { show: false },
          } : undefined,
        },
      ],
    }, true);
    inst.off("click");
    inst.on("click", (p: { dataIndex: number }) => { if (rows[p.dataIndex]) setSel(rows[p.dataIndex]); });
  }, [rows, selIdx]);

  const fmtDate = (d: string) => {
    const s = (d || "").trim();
    return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
  };

  const summary = (() => {
    if (!rows.length) return null;
    const totals = rows.map((r) => ({ r, t: finoTotal(r), bull: Number(r.bull_percentage) || 0, bear: Number(r.bear_percentage) || 0 }));
    const active = totals.filter((x) => x.t > 0);
    const avgBull = active.length ? active.reduce((s, x) => s + x.bull, 0) / active.length : 0;
    const avgBear = active.length ? active.reduce((s, x) => s + x.bear, 0) / active.length : 0;
    const mostBull = [...active].sort((a, b) => b.bull - a.bull)[0]?.r;
    const mostBear = [...active].sort((a, b) => b.bear - a.bear)[0]?.r;
    const houseSum = active.reduce((s, x) => s + x.t, 0);
    return { avgBull, avgBear, mostBull, mostBear, houseSum, n: rows.length };
  })();

  const filteredDetails = details.filter((d) => {
    const s = String(d.rating ?? "").trim();
    if (detailFilter === "bull") return s === "+1" || s === "1";
    if (detailFilter === "bear") return s === "-1";
    if (detailFilter === "neu") return s === "0" || s === "";
    return true;
  });

  const inputCls = "rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50";

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); void refresh(); }} className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">报告类型</label>
          <div className="inline-flex rounded-lg border border-border/60 bg-muted/20 p-0.5">
            {(["daily", "weekly"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setReportType(k)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  reportType === k ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground",
                )}>
                {k === "daily" ? "日报" : "周报"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">日期</label>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={cn(inputCls, "w-36")} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">品种过滤 (逗号分隔, 空=全量)</label>
          <input value={codes} onChange={(e) => setCodes(e.target.value)} placeholder="如 CU,RB" className={cn(inputCls, "w-48")} />
        </div>
        <button type="submit" disabled={loading || refreshing || !day.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {loading || refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} 查询
        </button>
      </form>

      <AutoRefreshBar auto={auto} setAuto={setAuto} ms={ms} setMs={setMs} lastUpdate={lastUpdate} onRefresh={refresh} refreshing={refreshing || loading} />

      {err ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" /> {err}</div>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{loading ? "加载中..." : "该日期无机构观点数据"}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {summary && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <GlassCard className="!p-3.5">
                <div className="text-[11px] text-muted-foreground">覆盖品种</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{summary.n}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">观点条目合计 {summary.houseSum}</div>
              </GlassCard>
              <GlassCard className="!p-3.5">
                <div className="text-[11px] text-muted-foreground">平均看涨 / 看跌占比</div>
                <div className="mt-1 flex items-baseline gap-2 text-xl font-semibold tabular-nums">
                  <span className="text-red-600 dark:text-red-400">{summary.avgBull.toFixed(1)}%</span>
                  <span className="text-sm text-muted-foreground">/</span>
                  <span className="text-emerald-600 dark:text-emerald-400">{summary.avgBear.toFixed(1)}%</span>
                </div>
                <FinoSentimentBar bull={summary.avgBull} neu={Math.max(0, 100 - summary.avgBull - summary.avgBear)} bear={summary.avgBear} />
              </GlassCard>
              <GlassCard className="!p-3.5 cursor-pointer hover:border-primary/40" onClick={() => summary.mostBull && setSel(summary.mostBull)}>
                <div className="text-[11px] text-muted-foreground">看涨占比最高</div>
                <div className="mt-1 truncate text-base font-semibold">
                  {summary.mostBull?.product_name ?? "-"}
                  {summary.mostBull?.product_code ? <span className="ml-1 text-xs font-normal text-muted-foreground">{summary.mostBull.product_code}</span> : null}
                </div>
                <div className="mt-0.5 text-sm tabular-nums text-red-600 dark:text-red-400">{Number(summary.mostBull?.bull_percentage || 0).toFixed(1)}%</div>
              </GlassCard>
              <GlassCard className="!p-3.5 cursor-pointer hover:border-primary/40" onClick={() => summary.mostBear && setSel(summary.mostBear)}>
                <div className="text-[11px] text-muted-foreground">看跌占比最高</div>
                <div className="mt-1 truncate text-base font-semibold">
                  {summary.mostBear?.product_name ?? "-"}
                  {summary.mostBear?.product_code ? <span className="ml-1 text-xs font-normal text-muted-foreground">{summary.mostBear.product_code}</span> : null}
                </div>
                <div className="mt-0.5 text-sm tabular-nums text-emerald-600 dark:text-emerald-400">{Number(summary.mostBear?.bear_percentage || 0).toFixed(1)}%</div>
              </GlassCard>
            </div>
          )}

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <GlassCard className="!p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-sm font-bold">机构观点分布 · {fmtDate(day)}</h4>
                <span className="text-[11px] text-muted-foreground">点击条形查看右侧明细 · 红涨灰震绿跌</span>
              </div>
              <div
                ref={chartRef}
                className="w-full"
                style={{ height: Math.max(1280, Math.min(rows.length, 72) * 16 + 72) }}
              />
            </GlassCard>

            <GlassCard className="!p-4 xl:sticky xl:top-3 xl:self-start xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
              {sel ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate text-base font-bold">
                        {sel.product_name ?? "-"}
                        {sel.product_code ? <span className="ml-1.5 text-sm font-normal text-muted-foreground">{sel.product_code}</span> : null}
                      </h4>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        共 {finoTotal(sel)} 家机构 · {reportType === "daily" ? "日报" : "周报"} · {fmtDate(day)}
                      </div>
                    </div>
                    <button type="button" onClick={() => setSel(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground" aria-label="关闭">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "看涨", n: sel.bull_count, pct: sel.bull_percentage, tone: "text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/5" },
                      { label: "震荡", n: sel.neutral_count, pct: sel.neutral_percentage, tone: "text-muted-foreground border-border/60 bg-muted/30" },
                      { label: "看跌", n: sel.bear_count, pct: sel.bear_percentage, tone: "text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5" },
                    ].map((x) => (
                      <div key={x.label} className={cn("rounded-xl border px-2.5 py-2", x.tone)}>
                        <div className="text-[11px] opacity-80">{x.label}</div>
                        <div className="mt-0.5 text-lg font-semibold tabular-nums">{x.n ?? 0}</div>
                        <div className="text-[11px] tabular-nums opacity-80">{Number(x.pct || 0).toFixed(1)}%</div>
                      </div>
                    ))}
                  </div>
                  <FinoSentimentBar
                    bull={Number(sel.bull_percentage) || 0}
                    neu={Number(sel.neutral_percentage) || 0}
                    bear={Number(sel.bear_percentage) || 0}
                  />

                  {(sel.consensus_views || sel.disagreement_views || sel.bull_views || sel.neutral_views || sel.bear_views) && (
                    <div className="space-y-2">
                      {sel.consensus_views && (
                        <div className="rounded-xl border border-border/60 bg-muted/15 px-3 py-2.5">
                          <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">一致性</div>
                          <p className="text-xs leading-relaxed text-foreground/90">{String(sel.consensus_views)}</p>
                        </div>
                      )}
                      {sel.disagreement_views && (
                        <div className="rounded-xl border border-border/60 bg-muted/15 px-3 py-2.5">
                          <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">分歧点</div>
                          <p className="text-xs leading-relaxed text-foreground/90">{String(sel.disagreement_views)}</p>
                        </div>
                      )}
                      {[
                        { k: "bull_views", label: "看涨归因", cls: "border-red-500/25 bg-red-500/5" },
                        { k: "neutral_views", label: "震荡归因", cls: "border-border/60 bg-muted/20" },
                        { k: "bear_views", label: "看跌归因", cls: "border-emerald-500/25 bg-emerald-500/5" },
                      ].map(({ k, label, cls }) => {
                        const txt = sel[k];
                        if (!txt) return null;
                        return (
                          <div key={k} className={cn("rounded-xl border px-3 py-2.5", cls)}>
                            <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">{label}</div>
                            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">{String(txt)}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold">逐条机构观点</div>
                      <div className="inline-flex rounded-lg border border-border/60 bg-muted/20 p-0.5">
                        {([
                          ["all", "全部"],
                          ["bull", "看涨"],
                          ["neu", "震荡"],
                          ["bear", "看跌"],
                        ] as const).map(([k, lab]) => (
                          <button key={k} type="button" onClick={() => setDetailFilter(k)}
                            className={cn(
                              "rounded-md px-2 py-1 text-[11px] transition-colors",
                              detailFilter === k ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                            )}>
                            {lab}
                          </button>
                        ))}
                      </div>
                    </div>
                    {detailLoading ? (
                      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> 加载逐条观点...</div>
                    ) : filteredDetails.length === 0 ? (
                      <p className="py-8 text-center text-xs text-muted-foreground">暂无逐条观点 (上游可能仅返回汇总)</p>
                    ) : (
                      <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                        {filteredDetails.map((d, i) => {
                          const meta = finoRatingMeta(d.rating);
                          const Icon = meta.Icon;
                          return (
                            <div key={String(d.uni_id ?? i)} className="rounded-xl border border-border/50 bg-background/40 px-3 py-2.5 transition-colors hover:border-border">
                              <div className="mb-1.5 flex items-center gap-2">
                                <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", meta.cls)}>
                                  <Icon className="h-3 w-3" /> {meta.label}
                                </span>
                                <span className="truncate text-[11px] text-muted-foreground">
                                  {d.source
                                    ? String(d.source)
                                    : d.uni_id
                                      ? `机构#${String(d.uni_id)}`
                                      : "未知机构"}
                                </span>
                              </div>
                              <div className="text-sm font-medium leading-snug">{d.viewpoint ? String(d.viewpoint) : "—"}</div>
                              {d.detail ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{String(d.detail)}</p> : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <MessagesSquare className="h-8 w-8 opacity-40" />
                  点击左侧条形查看品种机构观点
                </div>
              )}
            </GlassCard>
          </div>

          <p className="text-[11px] text-muted-foreground">客观呈现机构观点统计与原文摘要, 不构成投资建议; 红涨绿跌 (A股配色); 缓存 10 分钟。</p>
        </div>
      )}
    </div>
  );
}
