/** Map minute bars onto an X axis that respects the trading session. */

export type SparkSession = "ashare" | "hk" | "jp" | "kr" | "h24" | "daily";

/** A-share continuous-auction minutes (09:30-11:30 + 13:00-15:00). */
export const ASHARE_SESSION_MIN = 240;

/** HK continuous-auction minutes (09:30-12:00 + 13:00-16:00). */
export const HK_SESSION_MIN = 330;

/** Nikkei minutes on the printed clock (Eastmoney Beijing = JST-1h): 08:00-10:30 + 11:30-14:30. */
export const JP_SESSION_MIN = 330;

/** KOSPI minutes on the printed clock (Eastmoney Beijing = KST-1h): 08:00-14:30, no lunch. */
export const KR_SESSION_MIN = 390;

function sessionIdx(t: string, open: number, lunchS: number, lunchE: number, span: number): number {
  const m = toMinute(t);
  if (!Number.isFinite(m)) return NaN;
  let e = m - open;
  if (lunchE > lunchS && m >= lunchE) e -= lunchE - lunchS;
  return Math.max(0, Math.min(e, span));
}

/** Minute index on the A-share session axis. 09:30=0, 11:30=13:00=120, 15:00=240. */
export function ashareSessionIdx(t: string): number {
  return sessionIdx(t, 9 * 60 + 30, 11 * 60 + 30, 13 * 60, ASHARE_SESSION_MIN);
}

/** Minute index on the HK session axis. 09:30=0, 12:00=13:00=150, 16:00=330. */
export function hkSessionIdx(t: string): number {
  return sessionIdx(t, 9 * 60 + 30, 12 * 60, 13 * 60, HK_SESSION_MIN);
}

/** Minute index on the Nikkei axis (Beijing stamp). 08:00=0, 10:30=11:30=150, 14:30=330. */
export function jpSessionIdx(t: string): number {
  return sessionIdx(t, 8 * 60, 10 * 60 + 30, 11 * 60 + 30, JP_SESSION_MIN);
}

/** Minute index on the KOSPI axis (Beijing stamp). 08:00=0, 14:30=390. */
export function krSessionIdx(t: string): number {
  return sessionIdx(t, 8 * 60, 0, 0, KR_SESSION_MIN);
}

export function toMinute(t: string): number {
  const s = (t || "").trim();
  const colon = s.match(/(\d{1,2}):(\d{2})/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const compact = s.match(/(?:^|[\sT])(\d{4})(?:\D|$)/);
  if (compact) {
    const hhmm = compact[1];
    return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
  }
  return NaN;
}

const FIXED_AXIS: Partial<Record<SparkSession, { idx: (t: string) => number; span: number }>> = {
  ashare: { idx: ashareSessionIdx, span: ASHARE_SESSION_MIN },
  hk: { idx: hkSessionIdx, span: HK_SESSION_MIN },
  jp: { idx: jpSessionIdx, span: JP_SESSION_MIN },
  kr: { idx: krSessionIdx, span: KR_SESSION_MIN },
};

export function sparkXs(
  times: Array<string | undefined> | undefined,
  n: number,
  width: number,
  session: SparkSession = "ashare",
): number[] {
  const even = () => Array.from({ length: n }, (_, i) => (n <= 1 ? 1 : 1 + (i / (n - 1)) * (width - 2)));
  if (n < 2) return even();
  if (session === "daily" || !times || times.length !== n) return even();

  let xs: number[];
  if (session === "h24") {
    const gapMin = 5;
    const tl = [0];
    for (let i = 1; i < n; i++) {
      let d = toMinute(times[i] || "") - toMinute(times[i - 1] || "");
      if (d < -720) d += 1440;
      if (d < 0 || d > gapMin) d = 1;
      tl.push(tl[i - 1] + d);
    }
    const span = Math.max(tl[tl.length - 1], 1);
    xs = tl.map((v) => (v / span) * (width - 2) + 1);
  } else {
    const ax = FIXED_AXIS[session];
    if (!ax) return even();
    xs = times.map((t) => (ax.idx(t || "") / ax.span) * (width - 2) + 1);
  }
  if (xs.some((x) => !Number.isFinite(x))) return even();
  return xs;
}

const REGION_SESSION: Record<string, SparkSession> = {
  CN: "ashare",
  HK: "hk",
  JP: "jp",
  KR: "kr",
};

export function sparkSessionForRegion(region: string): SparkSession {
  return REGION_SESSION[region] ?? "h24";
}
