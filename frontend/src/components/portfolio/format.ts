/** Shared portfolio number formatting (A-share red-up / green-down). */

export const REFRESH_MS = 30 * 60 * 1000;

export const pnlColor = (v: number) =>
  (v > 0 ? "text-danger" : v < 0 ? "text-success" : "text-muted-foreground");

export const fmt = (v: number) =>
  v.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export const fmtPx = (v: number) =>
  v.toLocaleString("zh-CN", { maximumFractionDigits: 4 });

export const signed = (v: number) => (v > 0 ? "+" : "") + fmt(v);

export const pctInt = (v: number) => `${Math.round(v * 100)}%`;

export const wanInt = (v: number) => `${Math.round(v)}万`;

export function ymdInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
