/** Map minute bars onto an X axis that respects the trading session. */

export type SparkSession = "ashare" | "h24" | "daily";

/** A-share continuous-auction minutes (09:30-11:30 + 13:00-15:00). */
export const ASHARE_SESSION_MIN = 240;

/** Minute index on the A-share session axis. 09:30=0, 11:30=13:00=120, 15:00=240. */
export function ashareSessionIdx(t: string): number {
  const m = toMinute(t);
  if (!Number.isFinite(m)) return NaN;
  const open = 9 * 60 + 30;
  const lunchS = 11 * 60 + 30;
  const lunchE = 13 * 60;
  let e = m - open;
  if (m >= lunchE) e -= lunchE - lunchS;
  return Math.max(0, Math.min(e, ASHARE_SESSION_MIN));
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
    xs = times.map((t) => (ashareSessionIdx(t || "") / ASHARE_SESSION_MIN) * (width - 2) + 1);
  }
  if (xs.some((x) => !Number.isFinite(x))) return even();
  return xs;
}
