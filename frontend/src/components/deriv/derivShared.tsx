import { useEffect, useRef, useState } from "react";
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
          className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-sky-400/50 bg-sky-400/10 text-[9px] leading-none text-sky-400/90"
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
      <span className="text-[9px] text-slate-500">仅夜盘</span>
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
    <span className={cn("inline-flex h-6 items-center gap-1 rounded border border-slate-700/60 px-2 text-[10px]", s.tone)}>
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
