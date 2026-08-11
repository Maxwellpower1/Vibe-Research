import { useState, useCallback, useEffect } from "react";
import { AlertCircle, Loader2, Search } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { api, ApiError, type OvlabFlowAlert, type OvlabFlowDataRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  AutoRefreshBar, SortableTh, nextSort, num, sortRows, useAutoRefresh, type SortState,
} from "@/components/ovlab/shared";

export const FLOW_ALERT_COLS: { key: keyof OvlabFlowAlert; label: string; cls?: string; sortable?: boolean }[] = [
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

export function FlowAlertPanel() {
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
            className="field-input w-full !py-2 pl-8 pr-3" />
        </div>
        <AutoRefreshBar auto={auto} setAuto={setAuto} ms={ms} setMs={setMs} lastUpdate={lastUpdate} onRefresh={refresh} refreshing={refreshing || loading} />
      </div>
      {loading && rows.length === 0 ? (
        <EmptyState loading title="加载异动榜" skeleton="table" />
      ) : err ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" /> {err}</div>
      ) : shown.length === 0 ? (
        <EmptyState title="暂无异动" description="当前阈值下没有命中，可放宽条件后重试。" />
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

export function FlowDataPanel() {
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
            className="w-40 field-input" />
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
        <EmptyState loading title="加载异动资金流" skeleton="table" />
      ) : shown.length === 0 ? (
        <EmptyState title="暂无异动资金流" description="可调整日期或阈值后重试。" />
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

