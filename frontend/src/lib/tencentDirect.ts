/** Browser-direct Tencent fallback when FastAPI is down or slow. */

import { quoteUrl, tencentMinuteUrl, tencentRankUrl } from "@/lib/tencentUrls";

export interface DirectQuote {
  symbol: string;
  name: string;
  price: number;
  pct: number;
  change: number;
  prev: number;
  amount: number;
  turnover: number;
}

export interface DirectBoard {
  code: string;
  raw_code: string;
  name: string;
  price: number;
  change: number;
  pct: number;
  lead_code: string;
  lead_name: string;
  lead_pct: number;
  pct5: number;
  pct20: number;
}

export interface DirectMinute {
  code: string;
  prec: number;
  points: Array<{ t: string; p: number }>;
}

const directCooldown = new Map<string, number>();
const DIRECT_COOLDOWN_MS = 5000;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function throttleDirect(key: string): boolean {
  const now = Date.now();
  const last = directCooldown.get(key) || 0;
  if (now - last < DIRECT_COOLDOWN_MS) return true;
  directCooldown.set(key, now);
  return false;
}

function hasTurnoverAmount(symbol: string): boolean {
  return /^(?:sh|sz|bj)\d{6}$/i.test(symbol) || /^hk[A-Za-z0-9]+$/i.test(symbol);
}

async function decodeGbk(buf: ArrayBuffer): Promise<string> {
  for (const enc of ["gbk", "gb18030"]) {
    try {
      return new TextDecoder(enc).decode(buf);
    } catch {
      /* encoding not supported */
    }
  }
  return new TextDecoder("utf-8").decode(buf);
}

export function parseTencentQuotes(text: string): Record<string, DirectQuote> {
  const out: Record<string, DirectQuote> = {};
  for (const raw of (text || "").split(";")) {
    const m = /v_([A-Za-z0-9_]+)="([^"]*)"/.exec(raw.trim());
    if (!m) continue;
    const symbol = m[1];
    const f = m[2].split("~");
    if (symbol.startsWith("wh") && f.length > 13) {
      const price = num(f[3]);
      const change = num(f[12]);
      out[symbol] = {
        symbol, name: f[1] || symbol, price, change, pct: num(f[13]),
        prev: price - change, amount: 0, turnover: 0,
      };
      continue;
    }
    if (f.length < 33) continue;
    const rawAmt = f.length > 37 ? num(f[37]) : 0;
    out[symbol] = {
      symbol,
      name: f[1] || symbol,
      price: num(f[3]),
      prev: num(f[4]),
      change: num(f[31]),
      pct: num(f[32]),
      amount: hasTurnoverAmount(symbol) && rawAmt ? rawAmt * 10000 : 0,
      turnover: f.length > 38 ? num(f[38]) : 0,
    };
  }
  return out;
}

export async function fetchDirectQuotes(codes: string[]): Promise<Record<string, DirectQuote>> {
  const fresh = codes.filter((c) => !throttleDirect(`q:${c}`));
  if (!fresh.length) return {};
  const r = await fetch(quoteUrl(fresh));
  return parseTencentQuotes(await decodeGbk(await r.arrayBuffer()));
}

export async function fetchDirectBoards(
  type: "01" | "02",
  dir: 0 | 1,
  n: number,
): Promise<DirectBoard[]> {
  if (throttleDirect(`b:${type}:${dir}`)) return [];
  const r = await fetch(tencentRankUrl(n, type, dir));
  const j = await r.json();
  return ((j?.data || []) as Record<string, string>[]).map((b) => ({
    code: String(b.bd_code || ""),
    raw_code: String(b.bd_code || ""),
    name: b.bd_name || "",
    price: num(b.bd_zxj),
    change: num(b.bd_zd),
    pct: num(b.bd_zdf),
    lead_code: b.nzg_code || "",
    lead_name: b.nzg_name || "",
    lead_pct: num(b.nzg_zdf),
    pct5: num(b.bd_zdf5),
    pct20: num(b.bd_zdf20),
  }));
}

export async function fetchDirectMinute(code: string): Promise<DirectMinute> {
  if (throttleDirect(`m:${code}`)) return { code, prec: 0, points: [] };
  const r = await fetch(tencentMinuteUrl(code));
  const j = await r.json();
  const d = j?.data?.[code];
  const arr: string[] = d?.data?.data || [];
  return {
    code,
    prec: num(d?.data?.prec || d?.qt?.[code]?.[4] || 0),
    points: arr.map((s) => {
      const p = s.split(" ");
      return { t: p[0], p: num(p[1]) };
    }),
  };
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => { window.clearTimeout(t); resolve(v); },
      (e) => { window.clearTimeout(t); reject(e); },
    );
  });
}

/** Server first; on fail/timeout, optional browser-direct Tencent. */
export async function withFallback<T>(
  serverFn: () => Promise<T>,
  directFn?: () => Promise<T>,
  timeoutMs = 4000,
): Promise<T> {
  try {
    return await withTimeout(serverFn(), timeoutMs);
  } catch (e) {
    if (directFn) return directFn();
    throw e;
  }
}
