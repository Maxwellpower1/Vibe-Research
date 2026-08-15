import { useEffect, useSyncExternalStore } from "react";
import { api, type StockBoards } from "@/lib/api";
import { watchDigits } from "@/lib/watchlist";

/** Visible-row industry/concept tags. 5 min memory cache, batched 12. */

const TTL = 5 * 60 * 1000;
const CHUNK = 12;

const cache = new Map<string, { at: number; data: StockBoards | null }>();
const wanted = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let timer: number | null = null;

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function snapshot(key: string): StockBoards | null {
  return cache.get(key)?.data ?? null;
}

async function flush() {
  timer = null;
  const now = Date.now();
  const codes = [...wanted].filter((c) => {
    const hit = cache.get(c);
    return !hit || now - hit.at >= TTL;
  }).slice(0, 40);
  wanted.clear();
  if (!codes.length) return;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const chunk = codes.slice(i, i + CHUNK);
    try {
      const map = await api.stockBoardsBatch(chunk);
      for (const c of chunk) {
        const row = map[c] || map[c.replace(/^(sh|sz|bj)/i, "")] || null;
        cache.set(c, { at: Date.now(), data: row });
      }
    } catch {
      for (const c of chunk) {
        if (!cache.has(c)) cache.set(c, { at: Date.now(), data: null });
      }
    }
  }
  emit();
}

function schedule() {
  if (timer != null) return;
  timer = window.setTimeout(() => { void flush(); }, 400);
}

export function useStockBoards(code: string, enabled = true): StockBoards | null {
  const key = watchDigits(code);
  useEffect(() => {
    if (!enabled || !key) return;
    const hit = cache.get(key);
    if (!hit || Date.now() - hit.at >= TTL) {
      wanted.add(key);
      schedule();
    }
  }, [key, enabled]);
  useSyncExternalStore(subscribe, () => version, () => 0);
  return enabled && key ? snapshot(key) : null;
}
