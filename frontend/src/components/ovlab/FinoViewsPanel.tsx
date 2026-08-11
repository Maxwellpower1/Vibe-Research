import { useState, useCallback, useEffect, useRef } from "react";
import * as echarts from "echarts";
import {
  AlertCircle, Loader2, MessagesSquare, Minus, Search, TrendingDown, TrendingUp, X,
} from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { api, ApiError, type FinoOverviewRow, type FinoDetailRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AutoRefreshBar, useAutoRefresh } from "@/components/ovlab/shared";

// —— Fino 机构观点 ——
export const FINO_BULL = "#e4260c";
export const FINO_NEU = "#9ca3af";
export const FINO_BEAR = "#53a12a";

export function finoTotal(r: FinoOverviewRow): number {
  return (Number(r.bull_count) || 0) + (Number(r.neutral_count) || 0) + (Number(r.bear_count) || 0);
}

export function finoRatingMeta(rating: unknown): { label: string; cls: string; Icon: typeof TrendingUp } {
  const s = String(rating ?? "").trim();
  if (s === "+1" || s === "1") return { label: "看涨", cls: "border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-400", Icon: TrendingUp };
  if (s === "-1") return { label: "看跌", cls: "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", Icon: TrendingDown };
  return { label: "震荡", cls: "border-border/70 bg-muted/40 text-muted-foreground", Icon: Minus };
}

export function FinoSentimentBar({ bull, neu, bear }: { bull: number; neu: number; bear: number }) {
  const t = bull + neu + bear || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
      <div style={{ width: `${(bull / t) * 100}%` }} className="bg-[#e4260c] transition-all" />
      <div style={{ width: `${(neu / t) * 100}%` }} className="bg-[#9ca3af] transition-all" />
      <div style={{ width: `${(bear / t) * 100}%` }} className="bg-[#53a12a] transition-all" />
    </div>
  );
}

export function FinoViewsPanel() {
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

  const inputCls = "field-input";

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
        loading ? (
          <EmptyState loading title="加载机构观点" skeleton="lines" />
        ) : (
          <EmptyState title="该日期无机构观点数据" description="可换日期或清空品种过滤后重试。" />
        )
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

