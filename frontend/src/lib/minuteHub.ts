import { useEffect, useMemo, useSyncExternalStore } from "react";
import { loadLightKlineBatch } from "@/lib/lightKline";
import type { AShareLightKline } from "@/lib/api";

/**
 * Merge cockpit minute-spark subscriptions into one 20s batch.
 * Backend TTL is 20s for indices and 120s for stocks, so extra stock polls hit cache.
 */

export const MINUTE_POLL_MS = 20_000;
const CHUNK = 40;
const MAX_AGE_MS = 15_000;

const entries = new Map<string, AShareLightKline | null>();
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
  const rs = await Promise.allSettled(
    chunks(codes).map((c) => loadLightKlineBatch(c, "1", 240, MAX_AGE_MS)),
  );
  let changed = false;
  for (const r of rs) {
    if (r.status !== "fulfilled") continue;
    for (const [code, kl] of Object.entries(r.value || {})) {
      const old = entries.get(code);
      if (old !== kl) {
        entries.set(code, kl);
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
  }, MINUTE_POLL_MS);
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

export function useMinutes(codes: string[]): Record<string, AShareLightKline | null> {
  useCodes(codes);
  const v = useSyncExternalStore(subscribe, getVersion);
  const key = codes.join(",");
  return useMemo(() => {
    const result: Record<string, AShareLightKline | null> = {};
    for (const c of codes) {
      if (entries.has(c)) result[c] = entries.get(c) ?? null;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, v]);
}
