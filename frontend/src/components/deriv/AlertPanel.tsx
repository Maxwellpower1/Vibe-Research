import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { DerivData } from "@/hooks/useDerivData";
import { cn } from "@/lib/utils";
import { num } from "@/components/ovlab/shared";
import { CellEmpty, useAlertSeen } from "./derivShared";

const RULE_LABEL: Record<string, string> = {
  r001_single_trade: "单笔异动",
  r002_volume_surge: "放量",
  r003_oi_surge: "持仓异动",
};

function alertKey(a: { contract_code?: string; time?: string; rule_id?: string }): string {
  return `${a.contract_code ?? ""}|${a.time ?? ""}|${a.rule_id ?? ""}`;
}

/** 异动 + 到期条: flow-alert feed with NEW badges; compact expiry chips on top. */
export function AlertPanel({ d }: { d: DerivData }) {
  const alerts = useMemo(() => (d.alerts ?? []).slice(0, 60), [d.alerts]);
  const keys = useMemo(() => alerts.map(alertKey), [alerts]);
  const seen = useAlertSeen(keys);
  const [autoTop, setAutoTop] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto scroll to top when fresh alerts land (same pattern as news cockpit).
  const firstKey = keys[0] ?? "";
  useEffect(() => {
    if (autoTop && listRef.current) listRef.current.scrollTop = 0;
  }, [firstKey, autoTop]);

  // Compact expiry strip: aggregate product-exps by date, mark <=7d red.
  const expiry = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const p of d.exps ?? []) {
      for (const e of p.exps ?? []) {
        const ds = String(e.expDate ?? "");
        if (!ds) continue;
        byDate.set(ds, (byDate.get(ds) ?? 0) + 1);
      }
    }
    const today = new Date();
    const t = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    return [...byDate.entries()]
      .filter(([ds]) => ds >= t)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([ds, count]) => {
        const exp = new Date(Number(ds.slice(0, 4)), Number(ds.slice(4, 6)) - 1, Number(ds.slice(6, 8)));
        const dte = Math.round((exp.getTime() - today.getTime()) / 86400000);
        return { ds, count, dte, label: `${Number(ds.slice(4, 6))}/${Number(ds.slice(6, 8))}` };
      });
  }, [d.exps]);

  if (!d.alerts) return <CellEmpty text="更新中…" />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-800/60 px-2 py-1">
        <span className="text-[10px] text-slate-500">到期</span>
        {expiry.length === 0 && <span className="text-[10px] text-slate-600">近期待无到期</span>}
        {expiry.map((e) => (
          <span
            key={e.ds}
            title={`${e.ds} · ${e.count} 个品种 · 剩 ${e.dte} 天`}
            className={cn(
              "rounded-full border px-1.5 py-px text-[10px] tabular-nums",
              e.dte <= 7
                ? "border-red-500/50 bg-red-500/10 text-red-400"
                : "border-slate-700/60 text-slate-400",
            )}
          >
            {e.label}<span className="ml-0.5 opacity-70">{e.count}</span>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setAutoTop((v) => !v)}
          className={cn("ml-auto text-[10px]", autoTop ? "text-cyan-400" : "text-slate-600 hover:text-slate-400")}
          title="新异动自动滚到顶"
        >
          滚顶{autoTop ? "开" : "关"}
        </button>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
        {alerts.length === 0 && <CellEmpty text="暂无异动" />}
        {alerts.map((a) => {
          const k = alertKey(a);
          const isNew = !seen.has(k);
          const pct = num(String(a.pct_change ?? "").replace("%", ""));
          return (
            <div
              key={k}
              className={cn(
                "flex items-center gap-1.5 border-b border-slate-800/40 px-2 py-[3px] text-[11px]",
                isNew && "border-l-2 border-l-cyan-400 bg-cyan-500/[0.04]",
              )}
            >
              <span className="shrink-0 tabular-nums text-slate-500">{String(a.time ?? "").slice(11, 16)}</span>
              <span className="min-w-0 flex-1 truncate text-slate-300" title={String(a.instrument ?? "")}>
                {String(a.contract_code ?? "-")}
              </span>
              <span className="shrink-0 text-[10px] text-slate-500">
                {RULE_LABEL[String(a.rule_id ?? "")] ?? String(a.rule_id ?? "异动")}
              </span>
              {pct !== null && (
                <span className={cn("shrink-0 tabular-nums", pct > 0 ? "text-red-400" : pct < 0 ? "text-emerald-400" : "text-slate-500")}>
                  {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
                </span>
              )}
              {isNew && (
                <span className="shrink-0 rounded-sm bg-cyan-500/20 px-1 py-px text-[9px] leading-none text-cyan-300">NEW</span>
              )}
            </div>
          );
        })}
      </div>
      <Link
        to="/derivatives?tab=flow"
        className="block shrink-0 border-t border-slate-800/60 px-2 py-1 text-center text-[10px] text-slate-500 hover:text-cyan-300"
      >
        全部异动 →
      </Link>
    </div>
  );
}
