import { useEffect, useMemo, useRef, useState } from "react";
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

/** 异动: flow-alert feed with NEW badges. */
export function AlertPanel({ d }: { d: DerivData }) {
  const alerts = useMemo(() => (d.alerts ?? []).slice(0, 60), [d.alerts]);
  const keys = useMemo(() => alerts.map(alertKey), [alerts]);
  const seen = useAlertSeen(keys);
  const [autoTop, setAutoTop] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const firstKey = keys[0] ?? "";
  useEffect(() => {
    if (autoTop && listRef.current) listRef.current.scrollTop = 0;
  }, [firstKey, autoTop]);

  if (!d.alerts) return <CellEmpty text="更新中…" />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end border-b border-slate-800/60 px-2 py-0.5">
        <button
          type="button"
          onClick={() => setAutoTop((v) => !v)}
          className={cn("text-[11px]", autoTop ? "text-cyan-400" : "text-slate-600 hover:text-slate-400")}
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
                "flex items-center gap-1.5 border-b border-slate-800/40 px-2 py-1 text-[12px]",
                isNew && "border-l-2 border-l-cyan-400 bg-cyan-500/[0.04]",
              )}
            >
              <span className="shrink-0 tabular-nums text-slate-500">{String(a.time ?? "").slice(11, 16)}</span>
              <span className="min-w-0 flex-1 truncate text-slate-300" title={String(a.instrument ?? "")}>
                {String(a.contract_code ?? "-")}
              </span>
              <span className="shrink-0 text-[11px] text-slate-500">
                {RULE_LABEL[String(a.rule_id ?? "")] ?? String(a.rule_id ?? "异动")}
              </span>
              {pct !== null && (
                <span className={cn("shrink-0 tabular-nums", pct > 0 ? "text-red-400" : pct < 0 ? "text-emerald-400" : "text-slate-500")}>
                  {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
                </span>
              )}
              {isNew && (
                <span className="shrink-0 rounded-sm bg-cyan-500/20 px-1 py-px text-[10px] leading-none text-cyan-300">NEW</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
