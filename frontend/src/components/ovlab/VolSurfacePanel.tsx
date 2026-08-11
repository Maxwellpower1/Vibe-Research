import { useState, useCallback, useEffect } from "react";
import { AlertCircle, Loader2, Search } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AutoRefreshBar, num, useAutoRefresh } from "@/components/ovlab/shared";

export function VolSurfacePanel() {
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
            className="w-40 field-input" />
        </div>
        {exps.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">到期月</label>
            <select value={exp} onChange={(e) => setExp(e.target.value)}
              className="field-input">
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
        loading ? (
          <EmptyState loading title="加载 T 型报价" skeleton="table" />
        ) : (
          <EmptyState title="输入标的代码后查询 T 型报价" description="例如主连或具体合约代码。" />
        )
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

