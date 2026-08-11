import { useState, useCallback, useEffect, useRef } from "react";
import * as echarts from "echarts";
import { AlertCircle, Loader2, Search } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  api, ApiError, type OvlabPositionProducts, type OvlabFuturePositionDetails, type OvlabRankRow,
} from "@/lib/api";
import { AutoRefreshBar, useAutoRefresh } from "@/components/ovlab/shared";

type PosKind = "future" | "option";

export function RankChart({ title, rows, color }: { title: string; rows: OvlabRankRow[]; color: string }) {
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

export function PositionRankPanel() {
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
            className="field-input">
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
          }} className="field-input">
            {prodList.map((p) => (
              <option key={p.product} value={p.product}>{p.product} · {p.product_alias}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">合约</label>
          <select value={code} onChange={(e) => setCode(e.target.value)}
            className="field-input">
            {codes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {kind === "option" && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">方向</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as "C" | "P")}
              className="field-input">
              <option value="C">Call (C)</option>
              <option value="P">Put (P)</option>
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">日期</label>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
            className="w-36 field-input" />
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
          loading ? (
            <EmptyState loading title="加载持仓排名" skeleton="table" />
          ) : (
            <EmptyState title="选择品种与合约后查询持仓排名" description="先选品种，再选合约日期。" />
          )
        )
      ) : (
        <div className="mt-3">
          {hasOptData ? (
            <GlassCard>
              <h4 className="mb-2 text-sm font-bold">期权持仓明细 · {product} {code} {direction}（{day}）</h4>
              <pre className="max-h-[60vh] overflow-auto rounded-xl border border-border/60 bg-muted/20 p-3 text-xs">{JSON.stringify(optDetail, null, 2)}</pre>
            </GlassCard>
          ) : (
            loading ? (
              <EmptyState loading title="加载持仓明细" skeleton="table" />
            ) : (
              <EmptyState
                title="该合约无期权持仓明细"
                description="交易所未公布，或该合约暂无排名。"
              />
            )
          )}
        </div>
      )}
    </div>
  );
}


