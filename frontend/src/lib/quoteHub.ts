import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "@/lib/api";

/**
 * Cockpit quote hub: 5s loop. Equities/indices and futures are fetched in parallel
 * so a slow Sina/Binance tick cannot stall index prices.
 */

export interface HubQuote {
  name?: string;
  price: number;
  pct: number;
  amount?: number;
  turnover?: number;
  prev?: number;
  pe_ttm?: number;
  pb?: number;
  mcap_yi?: number;
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

export function isFuturesCode(code: string): boolean {
  return /^(hf_|nf_)/i.test(code) || code === "BTCUSDT";
}

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

function applyQuote(
  code: string,
  q: {
    name?: string; price: number; pct: number; amount?: number; turnover?: number;
    prev?: number; pe_ttm?: number; pb?: number; mcap_yi?: number;
  },
  now: number,
): boolean {
  if (!q || !Number.isFinite(q.price) || q.price <= 0) return false;
  const next: HubQuote = {
    name: q.name,
    price: q.price,
    pct: q.pct,
    amount: q.amount,
    turnover: q.turnover,
    prev: q.prev,
    pe_ttm: q.pe_ttm,
    pb: q.pb,
    mcap_yi: q.mcap_yi,
    updated: now,
  };
  const old = entries.get(code);
  if (!old || old.price !== next.price || old.pct !== next.pct
    || old.amount !== next.amount || old.turnover !== next.turnover
    || old.pe_ttm !== next.pe_ttm || old.pb !== next.pb || old.mcap_yi !== next.mcap_yi) {
    entries.set(code, next);
    return true;
  }
  return false;
}

async function tick() {
  if (!refCounts.size) return;
  const codes = [...refCounts.keys()];
  const stocks = codes.filter((c) => !isFuturesCode(c));
  const futures = codes.filter(isFuturesCode);
  const jobs: Promise<Record<string, { name?: string; price: number; pct: number; amount?: number; turnover?: number; prev?: number }>>[] = [];
  for (const c of chunks(stocks)) jobs.push(api.marketQuotes(c));
  if (futures.length) jobs.push(api.commodities(futures.join(",")));
  const rs = await Promise.allSettled(jobs);
  const now = Date.now();
  let changed = false;
  for (const r of rs) {
    if (r.status !== "fulfilled") continue;
    for (const [code, q] of Object.entries(r.value || {})) {
      if (applyQuote(code, q, now)) changed = true;
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

/** Read the hub without subscribing. Used when packing the current cockpit for AI. */
export function peekQuotes(codes: string[]): Record<string, HubQuote> {
  const result: Record<string, HubQuote> = {};
  for (const c of codes) {
    const e = entries.get(c);
    if (e) result[c] = e;
  }
  return result;
}
