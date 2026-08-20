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
  volume?: number;
  bid?: number;
  ask?: number;
  bid_vol?: number;
  ask_vol?: number;
  open?: number;
  high?: number;
  low?: number;
  amplitude?: number;
  vol_ratio?: number;
  float_mcap_yi?: number;
  limit_up?: number;
  limit_down?: number;
  pe_static?: number;
  pe_ttm?: number;
  pb?: number;
  mcap_yi?: number;
  is_stale?: boolean;
  stale_reason?: string;
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
        volume: 0, bid: 0, ask: 0, bid_vol: 0, ask_vol: 0,
        open: 0, high: 0, low: 0, amplitude: 0, vol_ratio: 0,
        float_mcap_yi: 0, limit_up: 0, limit_down: 0, pe_static: 0,
        pe_ttm: 0, pb: 0, mcap_yi: 0,
      };
      continue;
    }
    if (f.length < 33) continue;
    const rawAmt = f.length > 37 ? num(f[37]) : 0;
    const price = num(f[3]);
    const prev = num(f[4]);
    const isStale = rawAmt === 0 && price === prev && price > 0;
    const digits = /^(?:sh|sz|bj)(\d{6})$/i.exec(symbol)?.[1] || "";
    const staleReason = !isStale
      ? ""
      : (["43", "83", "87"].includes(digits.slice(0, 2))
        ? "北交所老号段, 多数已迁至 920xxx, 请按名称反查现行代码"
        : "成交量为 0 (停牌 / 未开盘 / 废码), 报价非当日真实成交");
    out[symbol] = {
      symbol,
      name: f[1] || symbol,
      price,
      prev,
      change: num(f[31]),
      pct: num(f[32]),
      volume: num(f[6]),
      bid: num(f[9]),
      bid_vol: num(f[10]),
      ask: f.length > 19 ? num(f[19]) : 0,
      ask_vol: f.length > 20 ? num(f[20]) : 0,
      amount: hasTurnoverAmount(symbol) && rawAmt ? rawAmt * 10000 : 0,
      turnover: f.length > 38 ? num(f[38]) : 0,
      open: num(f[5]),
      high: f.length > 33 ? num(f[33]) : 0,
      low: f.length > 34 ? num(f[34]) : 0,
      pe_ttm: f.length > 39 ? num(f[39]) : 0,
      amplitude: f.length > 43 ? num(f[43]) : 0,
      pb: f.length > 46 ? num(f[46]) : 0,
      // 45=总市值(亿); 44 is float mcap and can be much smaller on STAR names.
      mcap_yi: f.length > 45 ? num(f[45]) : 0,
      float_mcap_yi: f.length > 44 ? num(f[44]) : 0,
      limit_up: f.length > 47 ? num(f[47]) : 0,
      limit_down: f.length > 48 ? num(f[48]) : 0,
      vol_ratio: f.length > 49 ? num(f[49]) : 0,
      pe_static: f.length > 52 ? num(f[52]) : 0,
      is_stale: isStale,
      stale_reason: staleReason,
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

/** True when withTimeout fired. Backend may still be in-flight. */
export function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && e.message === "timeout";
}

/** Server first. Direct Tencent only if the server is gone, not on timeout. */
export async function withFallback<T>(
  serverFn: () => Promise<T>,
  directFn?: () => Promise<T>,
  timeoutMs = 12_000,
): Promise<T> {
  try {
    return await withTimeout(serverFn(), timeoutMs);
  } catch (e) {
    if (directFn && !isTimeoutError(e)) return directFn();
    throw e;
  }
}
