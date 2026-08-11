import { useState, useEffect, useRef } from "react";
import * as echarts from "echarts";
import { AlertCircle, Loader2, Search } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { api, ApiError, type OvlabWarehouseHistory } from "@/lib/api";
import { cn } from "@/lib/utils";

type WhYear = { year: string; values: (number | null)[] };

export function SeasonalityChart({ xLabels, series }: {
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

export function WarehousePanel() {
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
            className="w-40 field-input" />
        </div>
        <button type="submit" disabled={loading || !product.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} 查询
        </button>
      </form>
      {loading ? (
        <EmptyState loading title="加载持仓历史" skeleton="lines" />
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

