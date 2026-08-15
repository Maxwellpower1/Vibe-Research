import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "@/lib/api";

/**
 * Cockpit quote hub: one 5s Tencent batch for every subscribed code.
 * Panels read the same snapshot so the same stock stays in the same frame.
 */

export interface HubQuote {
  name?: string;
  price: number;
  pct: number;
  amount?: number;
  turnover?: number;
  updated: number;
}

export const QUOTE_POLL_MS = 5000;
const CHUNK = 80;

const entries = new Map<string, HubQuote>();
const refCounts = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;
let timer: number | null = null;
let flushTimer: number | null = null;
let lastFlush = 0;

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getVersion() {
  return version;
}

function chunks(codes: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < codes.length; i += CHUNK) out.push(codes.slice(i, i + CHUNK));
  return out;
}

async function tick() {
  if (!refCounts.size) return;
  const codes = [...refCounts.keys()];
  const rs = await Promise.allSettled(chunks(codes).map((c) => api.marketQuotes(c)));
  const now = Date.now();
  let changed = false;
  for (const r of rs) {
    if (r.status !== "fulfilled") continue;
    for (const [code, q] of Object.entries(r.value || {})) {
      const next: HubQuote = {
        name: q.name,
        price: q.price,
        pct: q.pct,
        amount: q.amount,
        turnover: q.turnover,
        updated: now,
      };
      const old = entries.get(code);
      if (!old || old.price !== next.price || old.pct !== next.pct
        || old.amount !== next.amount || old.turnover !== next.turnover) {
        entries.set(code, next);
        changed = true;
      }
    }
  }
  if (changed) emit();
}

function onVisibility() {
  if (!document.hidden) void tick();
}

function ensureLoop() {
  if (timer != null) return;
  timer = window.setInterval(() => {
    if (!document.hidden) void tick();
  }, QUOTE_POLL_MS);
  document.addEventListener("visibilitychange", onVisibility);
}

function maybeStopLoop() {
  if (refCounts.size === 0 && timer != null) {
    window.clearInterval(timer);
    timer = null;
    document.removeEventListener("visibilitychange", onVisibility);
  }
}

function scheduleFlush() {
  if (flushTimer != null || document.hidden) return;
  const wait = Math.max(250, 2000 - (Date.now() - lastFlush));
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    lastFlush = Date.now();
    void tick();
  }, wait);
}

function useCodes(codes: string[]) {
  const key = codes.join(",");
  useEffect(() => {
    const uniq = [...new Set(key ? key.split(",") : [])].filter(Boolean);
    for (const c of uniq) refCounts.set(c, (refCounts.get(c) || 0) + 1);
    ensureLoop();
    scheduleFlush();
    return () => {
      for (const c of uniq) {
        const n = (refCounts.get(c) || 1) - 1;
        if (n <= 0) {
          refCounts.delete(c);
          entries.delete(c);
        } else {
          refCounts.set(c, n);
        }
      }
      maybeStopLoop();
    };
  }, [key]);
}

export function useQuote(code: string, enabled = true): HubQuote | null {
  useCodes(enabled && code ? [code] : []);
  return useSyncExternalStore(subscribe, () => (enabled && code ? entries.get(code) ?? null : null));
}

export function useQuotes(codes: string[]): Record<string, HubQuote> {
  useCodes(codes);
  const v = useSyncExternalStore(subscribe, getVersion);
  const key = codes.join(",");
  return useMemo(() => {
    const result: Record<string, HubQuote> = {};
    for (const c of codes) {
      const e = entries.get(c);
      if (e) result[c] = e;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, v]);
}
