import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AlertCircle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleHelp,
  Loader2, Moon, Search, X,
} from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { GlanceStrip, type GlanceMetric } from "@/components/ui/GlanceStrip";
import {
  api, ApiError, type OvlabMarketRow, type OvlabProductExp, type OvlabPriceVolSeriesItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  AutoRefreshBar, PctPill, PercentileBar, prevCloseOf, SortableTh, TrendPreviewCell,
  daysToExpiry, nextSort, num, previewCode, sortRows, useAutoRefresh,
  type PreviewSeries, type SortState,
} from "@/components/ovlab/shared";

export const MARKET_COLS: { key: keyof OvlabMarketRow; label: string; cls?: string; sortable?: boolean; title?: string }[] = [
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

export function ExpiryCalendar({ data, selectedDate, onPick, onClear }: {
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
                    isSelected && "border-primary bg-primary text-primary-foreground",
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

export function MarketPanel({ onPickSymbol }: { onPickSymbol?: (symbol: string) => void }) {
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

  const nightCnt = rows.filter((r) => Number(r.has_night_trading)).length;
  const byCtn = [...rows].filter((r) => r.ctn != null && Number.isFinite(Number(r.ctn)));
  byCtn.sort((a, b) => Number(b.ctn) - Number(a.ctn));
  const topUp = byCtn[0];
  const topDn = byCtn[byCtn.length - 1];
  const glanceMetrics: GlanceMetric[] = [
    { label: "品种数", value: rows.length || "—", tone: "primary" },
    { label: "当前筛选", value: shown.length || "—", sub: filter || sector || onlyNight || expDate ? "已过滤" : "全部", tone: "muted" },
    { label: "夜盘品种", value: nightCnt || "—", tone: "muted" },
    { label: "板块数", value: sectors.length || "—", tone: "muted" },
    {
      label: "标的涨幅榜首",
      value: topUp ? (topUp.product_alias || topUp.prodUnd || "—") : "—",
      sub: topUp?.ctn != null ? `${Number(topUp.ctn) > 0 ? "+" : ""}${Number(topUp.ctn).toFixed(2)}%` : undefined,
      tone: topUp?.ctn != null && Number(topUp.ctn) > 0 ? "up" : "flat",
    },
    {
      label: "标的跌幅榜首",
      value: topDn ? (topDn.product_alias || topDn.prodUnd || "—") : "—",
      sub: topDn?.ctn != null ? `${Number(topDn.ctn) > 0 ? "+" : ""}${Number(topDn.ctn).toFixed(2)}%` : undefined,
      tone: topDn?.ctn != null && Number(topDn.ctn) < 0 ? "down" : "flat",
    },
  ];

  return (
    <div>
      <GlanceStrip
        title="市场一眼"
        subtitle="摘要常开 · 下方报价表按需筛选"
        metrics={glanceMetrics}
        onRefresh={() => void refresh()}
        refreshing={refreshing || loading}
      />

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
        <EmptyState loading title="加载市场概览" skeleton="table" />
      ) : err ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState title="暂无市场数据" description="可切换品种过滤或点刷新重试。" />
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
                                base={prevCloseOf(r)}
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


