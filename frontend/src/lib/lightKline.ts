import { api, type AShareLightKline } from "@/lib/api";

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
      const data = await api.ashareLightKline(code, resolution, num);
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
