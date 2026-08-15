import type { OrUsageDay } from "@/lib/api";

const TOP_N = 15;

export function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  const fmt = (n: number) => n.toFixed(1);
  let d = `M${fmt(pts[0].x)},${fmt(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const t = 0.3;
    d += `C${fmt(p1.x + (p2.x - p0.x) * t)},${fmt(p1.y + (p2.y - p0.y) * t)} ${fmt(p2.x - (p3.x - p1.x) * t)},${fmt(p2.y - (p3.y - p1.y) * t)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }
  return d;
}

export interface OrStackedDay {
  date: string;
  total: number;
  m: Record<string, number>;
  other: number;
}

export interface OrChart {
  W: number;
  H: number;
  PL: number;
  PR: number;
  PT: number;
  PB: number;
  areas: { name: string; d: string }[];
  yTicks: { v: number; y: number }[];
  xLabels: { label: string; x: number }[];
  last: number;
  chg: number;
  chgPct: number;
  dailyRate: number;
  avg7: number;
  avg: number;
  dayCount: number;
  stacked: OrStackedDay[];
  ord: string[];
  X: (i: number) => number;
  Y: (v: number) => number;
}

export function computeOrChart(
  allDays: OrUsageDay[],
  days: OrUsageDay[],
  mode: "vendor" | "country",
  size: { w: number; h: number },
): OrChart | null {
  if (!days || days.length < 2) return null;
  const { w: W, h: H } = size;
  if (!W || !H || W < 100 || H < 50) return null;
  const ch = H - 36;
  const PL = 50;
  const PR = 18;
  const PT = 8;
  const PB = 34;
  const iw = W - PL - PR;
  const ih = ch - PT - PB;
  if (iw < 40 || ih < 20) return null;
  const n = days.length;
  const source = mode === "country" ? "countries" : "providers";
  const cum: Record<string, number> = {};
  for (const d of allDays) {
    for (const p of d[source]) cum[p.name] = (cum[p.name] || 0) + p.tokens;
  }
  let topNames = Object.keys(cum).filter((v) => v !== "其他").sort((a, b) => cum[b] - cum[a]);
  topNames = topNames.filter((v) => v !== "openrouter");
  const keep = mode === "vendor" ? topNames.slice(0, TOP_N) : topNames;
  const keepSet = new Set(keep);
  const stacked = days.map((d) => {
    const m: Record<string, number> = {};
    let other = 0;
    for (const p of d[source]) {
      if (keepSet.has(p.name)) m[p.name] = p.tokens;
      else other += p.tokens;
    }
    return { date: d.date, total: d.total, m, other };
  });
  const allVals = stacked.flatMap((s) => [s.total, ...Object.values(s.m), s.other]);
  let lo = Math.min(...allVals) * 0.92;
  let hi = Math.max(...allVals) * 1.08;
  if (hi - lo < 1) {
    hi = lo + 1 || 1;
    lo = 0;
  }
  const X = (i: number) => PL + (i / Math.max(n - 1, 1)) * iw;
  const Y = (v: number) => PT + ih - ((v - lo) / (hi - lo)) * ih;
  const ord = [...keep, "其他"];
  const areas = ord.map((v) => {
    const top: { x: number; y: number }[] = [];
    const bot: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const s = stacked[i];
      let b = 0;
      for (const o of ord) {
        if (o === v) break;
        b += o === "其他" ? s.other : s.m[o] || 0;
      }
      const val = v === "其他" ? s.other : s.m[v] || 0;
      top.push({ x: X(i), y: Y(b + val) });
      bot.push({ x: X(i), y: Y(b) });
    }
    return { name: v, d: smoothPath(top) + smoothPath([...bot].reverse()).replace(/^M/, "L") + "Z" };
  });
  const yTicks: { v: number; y: number }[] = [];
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) / 4) * i;
    yTicks.push({ v, y: Y(v) });
  }
  const xStep = Math.max(1, Math.floor(n / 8));
  const xLabels: { label: string; x: number }[] = [];
  const span = n > 1 ? (new Date(days[n - 1].date).getTime() - new Date(days[0].date).getTime()) / 86400000 : 0;
  const fmt = span > 200 ? (d: string) => d.slice(0, 7) : (d: string) => d.slice(5);
  for (let i = 0; i < n; i += xStep) xLabels.push({ label: fmt(days[i].date), x: X(i) });
  const lastX = X(n - 1);
  if (!xLabels.length || xLabels[xLabels.length - 1].x < lastX - 20) {
    xLabels.push({ label: fmt(days[n - 1].date), x: lastX });
  }
  const last = stacked[n - 1].total;
  const first = stacked[0].total;
  const chg = last - first;
  const chgPct = first ? (last / first - 1) * 100 : 0;
  const dayCount = n - 1;
  const dailyRate = dayCount > 0 && first ? ((last / first) ** (1 / dayCount) - 1) * 100 : 0;
  const avg7 = stacked.slice(-7).reduce((s, d) => s + d.total, 0) / Math.min(7, n);
  const avg = stacked.reduce((s, d) => s + d.total, 0) / n;
  return { W, H, PL, PR, PT, PB, areas, yTicks, xLabels, last, chg, chgPct, dailyRate, avg7, avg, dayCount, stacked, ord, X, Y };
}
