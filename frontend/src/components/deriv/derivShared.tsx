import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { OvlabMarketRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { num } from "@/components/ovlab/shared";
import { formatAge } from "@/lib/freshness";
import { storageGet, storageSet } from "@/lib/storage";

/** K-line symbol for DerivLightChart: prodUnd + exp tail (e.g. IF2608). */
export function klineSym(r: Pick<OvlabMarketRow, "prodUnd" | "exp">): string {
  const und = String(r.prodUnd ?? "").trim();
  const tail = String(r.exp ?? "").trim().slice(-4);
  return und && tail ? `${und}${tail}` : "";
}

/** Main-contract code for display: futures prodUnd + exp tail (IM2609); pure-digit underlying (ETF) shows itself. */
export function contractCode(r: Pick<OvlabMarketRow, "prodUnd" | "exp">): string {
  const und = String(r.prodUnd ?? "").trim();
  if (!und) return "";
  return /^\d+$/.test(und) ? und : klineSym(r);
}

/** Panel header right slot: freshness age label, same language as A-share cells. */
export function FreshTag({ updated, extra }: { updated: number; extra?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const age = updated ? formatAge(updated) : null;
  return (
    <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
      {extra ? <span className="mr-1.5">{extra}</span> : null}
      {age ?? "更新中…"}
    </span>
  );
}

/** Per-cell empty state: one cell fails quietly, never drags the screen down. */
export function CellEmpty({ text = "未取到" }: { text?: string }) {
  return (
    <div className="flex h-full min-h-[60px] items-center justify-center text-[11px] text-slate-600">
      {text}
    </div>
  );
}

export function NightMoon({ show }: { show?: boolean }) {
  return (
    <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      {show ? (
        <span
          className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-sky-400/50 bg-sky-400/10 text-[10px] leading-none text-sky-400/90"
          aria-label="夜盘"
        >
          夜
        </span>
      ) : null}
    </span>
  );
}

/** Header-right toggle: keep only night-trading products. */
export function NightOnlySwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-[10px] text-slate-500">仅夜盘</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        title="只看有夜盘的品种"
        onClick={() => onChange(!on)}
        className={cn(
          "relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-sky-500/70" : "bg-slate-700/70",
        )}
      >
        <span
          className={cn(
            "inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform",
            on ? "translate-x-[12px]" : "translate-x-[2px]",
          )}
        />
      </button>
    </span>
  );
}

type DerivSession = { label: string; tone: string; live: boolean };
const SESSION_DAY: DerivSession = { label: "日盘", tone: "text-emerald-400", live: true };
const SESSION_NOON: DerivSession = { label: "午休", tone: "text-amber-400", live: false };
const SESSION_NIGHT: DerivSession = { label: "夜盘", tone: "text-sky-400", live: true };
const SESSION_CLOSED: DerivSession = { label: "休市", tone: "text-slate-500", live: false };

/** Coarse futures session from local time: 日盘 09:00-15:00 (午休 11:30-13:30), 夜盘 21:00-02:30. */
export function derivSession(now = new Date()): DerivSession {
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  // 凌晨夜盘段属于前一交易日: 周二~周六 00:00-02:30
  if (mins < 150) return day >= 2 && day <= 6 ? SESSION_NIGHT : SESSION_CLOSED;
  if (day === 0 || day === 6) return SESSION_CLOSED;
  if (mins >= 540 && mins < 690) return SESSION_DAY;
  if (mins >= 690 && mins < 810) return SESSION_NOON;
  if (mins >= 810 && mins < 900) return SESSION_DAY;
  if (mins >= 1260) return SESSION_NIGHT;
  return SESSION_CLOSED;
}

/** Header badge: current futures session, re-ticks every 30s. */
export function SessionBadge() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const s = derivSession();
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded border border-slate-700/60 px-2 text-[11px]", s.tone)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.live ? "animate-pulse bg-current" : "bg-slate-600")} />
      {s.label}
    </span>
  );
}

/** ctn is a decimal ratio upstream; render as signed percent with A-share red/green. */
export function CtnText({ value, boldOver }: { value: unknown; boldOver?: number }) {
  const n = num(value);
  if (n === null) return <span className="text-slate-600">-</span>;
  const pct = n * 100;
  const bold = boldOver != null && Math.abs(pct) >= boldOver;
  return (
    <span
      className={cn(
        "tabular-nums",
        pct > 0 ? "text-red-400" : pct < 0 ? "text-emerald-400" : "text-slate-400",
        bold && "font-bold",
      )}
    >
      {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

const SEEN_KEY = "deriv.alertSeen";
const SEEN_CAP = 300;

function loadSeen(): Set<string> {
  try {
    const arr = JSON.parse(storageGet(SEEN_KEY) ?? "[]");
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

/**
 * Local seen-set for flow alerts, mirroring NewsCockpitPanel's NEW badge.
 * New keys keep the badge until `flushMs` after they first rendered.
 */
export function useAlertSeen(keys: string[], flushMs = 10_000) {
  const [seen, setSeen] = useState<Set<string>>(loadSeen);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (keys.length === 0) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setSeen((prev) => {
        const next = new Set(prev);
        for (const k of keys) next.add(k);
        const arr = [...next].slice(-SEEN_CAP);
        storageSet(SEEN_KEY, JSON.stringify(arr));
        return new Set(arr);
      });
    }, flushMs);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [keys.join("|"), flushMs]); // eslint-disable-line react-hooks/exhaustive-deps

  return seen;
}

/** Numeric first, else zh string. Missing values go last. */
export function cmpVal(a: unknown, b: unknown, dir: "asc" | "desc"): number {
  const mul = dir === "asc" ? 1 : -1;
  const an = num(a);
  const bn = num(b);
  if (an !== null && bn !== null) return (an - bn) * mul;
  if (an !== null) return -1;
  if (bn !== null) return 1;
  return String(a ?? "").localeCompare(String(b ?? ""), "zh") * mul;
}

/** Flex header button: click cycles desc -> asc -> off. */
export function SortableHd<K extends string>({
  k, label, sort, onSort, className, title,
}: {
  k: K;
  label: string;
  sort: { key: K | null; dir: "asc" | "desc" };
  onSort: (k: K) => void;
  className?: string;
  title?: string;
}) {
  const active = sort.key === k;
  return (
    <button
      type="button"
      title={title}
      onClick={() => onSort(k)}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 select-none hover:text-slate-100",
        active ? "text-cyan-300" : "text-slate-300",
        className,
      )}
    >
      {label}
      {active
        ? (sort.dir === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />)
        : <ArrowUpDown className="h-2.5 w-2.5 opacity-30" />}
    </button>
  );
}

export const IV_SORT_COLS = [
  { key: "atmv_current" as const, label: "隐波", cls: "w-[2.7rem] justify-end text-right", title: "平值隐波" },
  { key: "atmv_percentile" as const, label: "IV分位", cls: "w-[5.4rem] justify-center", title: "隐波百分位, 左便宜 / 右贵" },
  { key: "carry" as const, label: "溢价", cls: "w-[2.6rem] justify-end text-right", title: "IV溢价 = 隐波 - 实波" },
];

/** IV percentile: spectrum marker + number. Green=cheap, red=expensive. */
export function IvpBar({ value }: { value: unknown }) {
  const n = num(value);
  if (n === null) {
    return <span className="inline-block w-[5.4rem] shrink-0 text-center text-[11px] text-slate-600">-</span>;
  }
  const pv = Math.max(0, Math.min(100, n));
  const tick = pv >= 90 ? "bg-red-300" : pv <= 10 ? "bg-emerald-300" : "bg-white";
  const left = 3 + pv * 0.94;
  const numCls = pv >= 90 ? "text-red-400" : pv <= 10 ? "text-emerald-400" : "text-slate-300";
  return (
    <span className="inline-flex w-[5.4rem] shrink-0 items-center gap-1" title={`IV分位 ${pv.toFixed(0)}`}>
      <span className="relative h-1.5 min-w-0 flex-1 overflow-visible rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500">
        <span
          className={cn("absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-sm shadow-[0_0_4px_rgba(0,0,0,0.8)]", tick)}
          style={{ left: `${left}%` }}
        />
      </span>
      <span className={cn("w-[1.55rem] shrink-0 text-right text-[11px] tabular-nums", numCls, (pv >= 90 || pv <= 10) && "font-semibold")}>
        {pv.toFixed(0)}
      </span>
    </span>
  );
}

/** Compact 隐波 / IV分位 / 溢价 cells for 股指 and 商品 rows. */
export function IvTriple({ row }: { row: Pick<OvlabMarketRow, "atmv_current" | "atmv_percentile" | "carry"> }) {
  const iv = num(row.atmv_current);
  const carry = num(row.carry);
  return (
    <>
      <span className="w-[2.7rem] shrink-0 text-right text-[11px] tabular-nums text-slate-300" title="平值隐波">
        {iv !== null ? iv.toFixed(2) : "-"}
      </span>
      <IvpBar value={row.atmv_percentile} />
      <span
        className={cn(
          "w-[2.6rem] shrink-0 text-right text-[11px] tabular-nums",
          carry !== null && carry > 0 ? "text-red-400" : carry !== null && carry < 0 ? "text-emerald-400" : "text-slate-400",
        )}
        title="IV溢价 = 隐波 - 实波"
      >
        {carry !== null ? carry.toFixed(1) : "-"}
      </span>
    </>
  );
}
