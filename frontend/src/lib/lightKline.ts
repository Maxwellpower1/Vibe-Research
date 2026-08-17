import { api, type AShareLightKline } from "@/lib/api";
import { fetchDirectMinute, withFallback } from "@/lib/tencentDirect";

function toTencentSym(code: string): string {
  if (/^(sh|sz|bj|hk|us|wh)/i.test(code)) return code;
  if (/^\d{6}$/.test(code)) {
    const p = /^(6|9|5)/.test(code) ? "sh" : code.startsWith("8") ? "bj" : "sz";
    return `${p}${code}`;
  }
  return code;
}

function canDirectMinute(code: string): boolean {
  return /^(sh|sz|bj|hk|us)/i.test(code) || /^\d{6}$/.test(code);
}

function hasBars(kl: AShareLightKline | null | undefined): boolean {
  return (kl?.bars?.length ?? 0) >= 2;
}

function minuteToKline(code: string, prec: number, points: Array<{ t: string; p: number }>): AShareLightKline | null {
  const valid = points.filter((p) => p.p > 0 && p.t);
  if (valid.length < 2) return null;
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    code,
    resolution: "1",
    prev_close: prec || null,
    bars: valid.map((p) => {
      const hh = p.t.slice(0, 2);
      const mm = p.t.slice(2, 4);
      return {
        datetime: `${day} ${hh}:${mm}`,
        open: p.p, high: p.p, low: p.p, close: p.p, volume: 0,
      };
    }),
  };
}

async function directKline(code: string): Promise<AShareLightKline> {
  const sym = toTencentSym(code);
  const m = await fetchDirectMinute(sym);
  const kl = minuteToKline(code, m.prec, m.points);
  if (!kl) throw new Error("direct minute empty");
  return kl;
}

const TTL_MS = 55_000;
const MAX_INFLIGHT = 4;

const cache = new Map<string, { at: number; data: AShareLightKline }>();
const pending = new Map<string, Promise<AShareLightKline>>();
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_INFLIGHT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

/** Shared 55s cache + concurrency 4. Same code/res/num collapses to one fetch. */
export function loadLightKline(
  code: string,
  resolution = "1",
  num = 240,
): Promise<AShareLightKline> {
  const key = `${code}:${resolution}:${num}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    await acquire();
    try {
      const again = cache.get(key);
      if (again && Date.now() - again.at < TTL_MS) return again.data;
      const data = await withFallback(
        () => api.ashareLightKline(code, resolution, num),
        resolution === "1" && canDirectMinute(code) ? () => directKline(code) : undefined,
      );
      cache.set(key, { at: Date.now(), data });
      return data;
    } finally {
      pending.delete(key);
      release();
    }
  })();
  pending.set(key, p);
  return p;
}

export function seedLightKline(
  code: string,
  data: AShareLightKline | null,
  resolution = "1",
  num = 240,
): void {
  if (!data) return;
  cache.set(`${code}:${resolution}:${num}`, { at: Date.now(), data });
}

/** One HTTP for many codes. Seeds the per-code cache. maxAgeMs skips still-fresh rows. */
export async function loadLightKlineBatch(
  codes: string[],
  resolution = "1",
  num = 240,
  maxAgeMs = TTL_MS,
): Promise<Record<string, AShareLightKline | null>> {
  const uniq = [...new Set(codes.map((c) => c.trim()).filter(Boolean))].slice(0, 40);
  if (!uniq.length) return {};
  const out: Record<string, AShareLightKline | null> = {};
  const need: string[] = [];
  const now = Date.now();
  for (const c of uniq) {
    const hit = cache.get(`${c}:${resolution}:${num}`);
    if (hit && now - hit.at < maxAgeMs) out[c] = hit.data;
    else need.push(c);
  }
  if (!need.length) return out;
  const map = await withFallback(
    () => api.ashareLightKlineBatch(need, resolution, num),
    resolution === "1"
      ? async () => {
        const fresh: Record<string, AShareLightKline | null> = {};
        await Promise.all(need.filter(canDirectMinute).map(async (code) => {
          try { fresh[code] = await directKline(code); } catch { fresh[code] = null; }
        }));
        return fresh;
      }
      : undefined,
  );
  const merged: Record<string, AShareLightKline | null> = { ...(map || {}) };
  if (resolution === "1") {
    const holes = need.filter((c) => !hasBars(merged[c]) && canDirectMinute(c));
    await Promise.all(holes.map(async (code) => {
      try { merged[code] = await directKline(code); } catch { merged[code] = merged[code] ?? null; }
    }));
  }
  for (const [code, data] of Object.entries(merged)) {
    seedLightKline(code, data, resolution, num);
    out[code] = data;
  }
  return out;
}

export function sparkFromKline(kl: AShareLightKline | null | undefined): {
  closes: number[];
  times: string[];
  prevClose?: number | null;
} | null {
  if (!kl) return null;
  const bars = kl.bars || [];
  return {
    closes: bars.map((b) => b.close).filter((n) => Number.isFinite(n)),
    times: bars.map((b) => b.datetime),
    prevClose: kl.prev_close,
  };
}

export function klineFromBatch(
  map: Record<string, AShareLightKline | null> | null | undefined,
  ...keys: Array<string | undefined>
): AShareLightKline | null {
  if (!map) return null;
  for (const k of keys) {
    if (k && map[k]) return map[k];
  }
  return null;
}
