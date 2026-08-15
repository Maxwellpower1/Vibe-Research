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
  return /^(sh|sz|bj|hk)/i.test(code) || /^\d{6}$/.test(code);
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
        6000,
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

/** One HTTP for many codes. Seeds the per-code 55s cache. */
export async function loadLightKlineBatch(
  codes: string[],
  resolution = "1",
  num = 240,
): Promise<Record<string, AShareLightKline | null>> {
  const uniq = [...new Set(codes.map((c) => c.trim()).filter(Boolean))].slice(0, 40);
  if (!uniq.length) return {};
  const map = await withFallback(
    () => api.ashareLightKlineBatch(uniq, resolution, num),
    resolution === "1"
      ? async () => {
        const out: Record<string, AShareLightKline | null> = {};
        await Promise.all(uniq.filter(canDirectMinute).map(async (code) => {
          try { out[code] = await directKline(code); } catch { out[code] = null; }
        }));
        return out;
      }
      : undefined,
    8000,
  );
  for (const [code, data] of Object.entries(map || {})) {
    seedLightKline(code, data, resolution, num);
  }
  return map || {};
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
