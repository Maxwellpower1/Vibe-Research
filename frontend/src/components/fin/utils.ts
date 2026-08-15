import { fmtAmt } from "@/components/review/format";

export const TNUM = { fontVariantNumeric: "tabular-nums" as const };

export function fmtPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

export function fmtYiYuan(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}万`;
  return fmtAmt(v);
}

export function quarterLabel(s: string): string {
  const m = s.match(/(\d{4})-(\d{2})-/);
  if (m) {
    const q = ({ "03": "Q1", "06": "Q2", "09": "Q3", "12": "Q4" } as Record<string, string>)[m[2]];
    if (q) return `${m[1].slice(2)}${q}`;
  }
  return s;
}

const FORECAST_GOOD = new Set(["预增", "略增", "扭亏", "减亏"]);
const FORECAST_BAD = new Set(["预减", "略减", "首亏", "增亏"]);

export function forecastTone(type: string): "good" | "bad" | "neutral" {
  if (FORECAST_GOOD.has(type)) return "good";
  if (FORECAST_BAD.has(type)) return "bad";
  return "neutral";
}

export function prefixCode(code: string): string {
  const c = (code || "").replace(/^(sh|sz|bj)/i, "");
  if (!/^\d{6}$/.test(c)) return code;
  if (c.startsWith("6") || c.startsWith("9") || c.startsWith("5")) return `sh${c}`;
  if (c.startsWith("8")) return `bj${c}`;
  return `sz${c}`;
}

export function bareCode(code: string): string {
  const m = (code || "").match(/(\d{6})/);
  return m ? m[1] : code;
}
