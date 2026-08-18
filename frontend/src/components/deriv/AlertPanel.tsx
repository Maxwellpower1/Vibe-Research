import { useEffect, useMemo, useRef, useState } from "react";
import type { OvlabFlowAlert } from "@/lib/api";
import type { DerivData } from "@/hooks/useDerivData";
import { cn } from "@/lib/utils";
import { daysToExpiry, num } from "@/components/ovlab/shared";
import { storageGet, storageSet } from "@/lib/storage";
import { CellEmpty, useAlertSeen } from "./derivShared";

/** OpenVlab flow-alert rule_id -> 异动类型. Aligns with openvlab.cn/flow/option-flow. */
export const FLOW_RULE_LABEL: Record<string, string> = {
  r001_single_trade: "成交异动",
  r002_1m_pct_move: "走势异动",
  r003_repeated_aggressive_burst: "连续成交",
};

const RULE_HINT: Record<string, string> = {
  r001_single_trade: "3秒内的单笔成交手数",
  r002_1m_pct_move: "1分钟内的价格涨幅",
  r003_repeated_aggressive_burst: "2秒内连续5次以上同向成交且价格单调变化",
};

const RULE_TONE: Record<string, string> = {
  r001_single_trade: "text-amber-400",
  r002_1m_pct_move: "text-sky-400",
  r003_repeated_aggressive_burst: "text-fuchsia-400",
};

const THRESH_KEY = "deriv.alertThresh";
/** Floor matching live OpenVlab flow-alert (local filter can only tighten). */
const DEFAULT_THRESH = { lots: 50, pct: 10, prem: 50_000 };

type Thresh = { lots: number; pct: number; prem: number };

function clampThresh(t: Thresh): Thresh {
  return {
    lots: Math.max(DEFAULT_THRESH.lots, t.lots),
    pct: Math.max(DEFAULT_THRESH.pct, t.pct),
    prem: Math.max(DEFAULT_THRESH.prem, t.prem),
  };
}

function loadThresh(): Thresh {
  try {
    const o = JSON.parse(storageGet(THRESH_KEY) ?? "null") as Partial<Thresh> | null;
    if (!o || typeof o !== "object") return { ...DEFAULT_THRESH };
    const n = (v: unknown, fb: number) => {
      const x = Number(v);
      return Number.isFinite(x) && x >= 0 ? x : fb;
    };
    return clampThresh({
      lots: n(o.lots, DEFAULT_THRESH.lots),
      pct: n(o.pct, DEFAULT_THRESH.pct),
      prem: n(o.prem, DEFAULT_THRESH.prem),
    });
  } catch {
    return { ...DEFAULT_THRESH };
  }
}

function saveThresh(t: Thresh) {
  storageSet(THRESH_KEY, JSON.stringify(t));
}

function alertKey(a: Pick<OvlabFlowAlert, "contract_code" | "time" | "rule_id">): string {
  return `${a.contract_code ?? ""}|${a.time ?? ""}|${a.rule_id ?? ""}`;
}

/** Window pct (区间涨幅). pct_change is a percent string; fall back to start/end. */
export function intervalPct(a: OvlabFlowAlert): number | null {
  const p = num(String(a.pct_change ?? "").replace("%", ""));
  if (p !== null) return p;
  const s = num(a.price_start);
  const e = num(a.price_end);
  if (s != null && e != null && s !== 0) return ((e - s) / s) * 100;
  return null;
}

function fmtAmt(n: number): string {
  if (Math.abs(n) >= 10_000) {
    const wan = n / 10_000;
    const s = wan.toFixed(wan >= 10 || Number.isInteger(wan) ? 0 : 1);
    return `${s}万`;
  }
  return String(Math.round(n));
}

function triggerHint(a: OvlabFlowAlert): string {
  const rid = String(a.rule_id ?? "");
  const base = RULE_HINT[rid] ?? "";
  if (rid === "r001_single_trade") {
    const v = num(a.window_volume);
    return v != null ? `${base} ${Math.round(v)}手` : base;
  }
  if (rid === "r003_repeated_aggressive_burst") {
    const v = num(a.window_premium);
    const fill = a.fill_type === "descending_fill" ? "下行" : a.fill_type === "ascending_fill" ? "上行" : "";
    return v != null ? `${base} ${fmtAmt(v)}${fill ? ` ${fill}` : ""}` : base;
  }
  return base;
}

export function passesThresh(a: OvlabFlowAlert, t: Thresh): boolean {
  const rid = String(a.rule_id ?? "");
  if (!FLOW_RULE_LABEL[rid]) return false;
  const floor = clampThresh(t);
  if (rid === "r001_single_trade") return (num(a.window_volume) ?? 0) >= floor.lots;
  if (rid === "r002_1m_pct_move") return Math.abs(intervalPct(a) ?? 0) >= floor.pct;
  if (rid === "r003_repeated_aggressive_burst") return (num(a.window_premium) ?? 0) >= floor.prem;
  return false;
}

function ThreshField({
  label, suffix, value, min, onChange,
}: {
  label: string; suffix: string; value: number; min: number; onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
      <span className="shrink-0">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          step="any"
          value={Number.isFinite(value) ? value : min}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) ? n : min);
          }}
          className="field-input w-[4.6rem] !px-1.5 !py-0.5 text-right text-[11px] tabular-nums"
        />
        <span className="w-4 text-slate-600">{suffix}</span>
      </span>
    </label>
  );
}

/** 异动: flow-alert feed. Columns match OpenVlab option-flow; thresh is local tighten-only. */
export function AlertPanel({ d }: { d: DerivData }) {
  const [thresh, setThresh] = useState<Thresh>(loadThresh);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [autoTop, setAutoTop] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const cfgRef = useRef<HTMLDivElement>(null);

  const setAndSave = (next: Thresh) => {
    const clamped = clampThresh(next);
    setThresh(clamped);
    saveThresh(clamped);
  };

  const alerts = useMemo(() => {
    const raw = d.alerts ?? [];
    return raw.filter((a) => passesThresh(a, thresh)).slice(0, 80);
  }, [d.alerts, thresh]);
  const keys = useMemo(() => alerts.map(alertKey), [alerts]);
  const seen = useAlertSeen(keys);

  const firstKey = keys[0] ?? "";
  useEffect(() => {
    if (autoTop && listRef.current) listRef.current.scrollTop = 0;
  }, [firstKey, autoTop]);

  useEffect(() => {
    if (!cfgOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (cfgRef.current && !cfgRef.current.contains(e.target as Node)) setCfgOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [cfgOpen]);

  if (!d.alerts) return <CellEmpty text="更新中…" />;

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex shrink-0 items-center justify-end gap-2 border-b border-slate-800/60 px-2 py-0.5">
        <span className="mr-auto tabular-nums text-[11px] text-slate-500">{alerts.length}条</span>
        <div ref={cfgRef} className="relative">
          <button
            type="button"
            onClick={() => setCfgOpen((v) => !v)}
            className={cn("text-[11px]", cfgOpen ? "text-amber-400" : "text-slate-500 hover:text-slate-300")}
            title="自定义阈值 (只能再收紧上游榜)"
          >
            阈值
          </button>
          {cfgOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-[13.5rem] space-y-1.5 rounded border border-slate-700/80 bg-slate-900 p-2 shadow-lg">
              <ThreshField
                label="成交手数"
                suffix="手"
                min={DEFAULT_THRESH.lots}
                value={thresh.lots}
                onChange={(lots) => setAndSave({ ...thresh, lots })}
              />
              <ThreshField
                label="涨幅阈值"
                suffix="%"
                min={DEFAULT_THRESH.pct}
                value={thresh.pct}
                onChange={(pct) => setAndSave({ ...thresh, pct })}
              />
              <ThreshField
                label="成交金额"
                suffix="元"
                min={DEFAULT_THRESH.prem}
                value={thresh.prem}
                onChange={(prem) => setAndSave({ ...thresh, prem })}
              />
              <button
                type="button"
                onClick={() => setAndSave({ ...DEFAULT_THRESH })}
                className="w-full text-left text-[10px] text-slate-600 hover:text-slate-400"
              >
                恢复默认 {DEFAULT_THRESH.lots}手 / {DEFAULT_THRESH.pct}% / {fmtAmt(DEFAULT_THRESH.prem)}
              </button>
            </div>
          )}
        </div>
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
        {alerts.length > 0 && (
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-slate-400">
                <th className="sticky top-0 z-[1] bg-card px-1.5 py-1 text-left font-semibold">时间</th>
                <th className="sticky top-0 z-[1] bg-card px-1 py-1 text-left font-semibold">合约</th>
                <th className="sticky top-0 z-[1] bg-card px-1 py-1 text-left font-semibold" title="异动类型">类型</th>
                <th className="sticky top-0 z-[1] bg-card px-1 py-1 text-right font-semibold" title="剩余天数">剩余</th>
                <th className="sticky top-0 z-[1] bg-card px-1.5 py-1 text-right font-semibold" title="区间涨幅">区间</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => {
                const k = alertKey(a);
                const isNew = !seen.has(k);
                const rid = String(a.rule_id ?? "");
                const pct = intervalPct(a);
                const dte = daysToExpiry(a.exp_date);
                return (
                  <tr
                    key={k}
                    className={cn(
                      "border-b border-slate-800/40",
                      isNew && "bg-cyan-500/[0.04] shadow-[inset_2px_0_0_#22d3ee]",
                    )}
                    title={triggerHint(a)}
                  >
                    <td className="px-1.5 py-0.5 tabular-nums text-slate-500">
                      {String(a.time ?? "").slice(11, 16)}
                    </td>
                    <td className="max-w-[6.5rem] truncate px-1 py-0.5 text-slate-300" title={String(a.instrument ?? a.contract_code ?? "")}>
                      {String(a.contract_code ?? "-")}
                    </td>
                    <td className={cn("whitespace-nowrap px-1 py-0.5", RULE_TONE[rid] ?? "text-slate-500")}>
                      {FLOW_RULE_LABEL[rid] ?? rid}
                    </td>
                    <td className={cn(
                      "px-1 py-0.5 text-right tabular-nums",
                      dte != null && dte <= 7 ? "text-amber-400" : "text-slate-400",
                    )}>
                      {dte == null ? "-" : dte}
                    </td>
                    <td className={cn(
                      "px-1.5 py-0.5 text-right tabular-nums",
                      pct == null ? "text-slate-600" : pct > 0 ? "text-red-400" : pct < 0 ? "text-emerald-400" : "text-slate-500",
                    )}>
                      {pct == null ? "-" : `${pct > 0 ? "+" : ""}${Math.abs(pct) >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
