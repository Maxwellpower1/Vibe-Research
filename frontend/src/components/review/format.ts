/** Shared A-share review formatting (red up / green down). */

export const pctColor = (p: number) =>
  p > 0 ? "text-danger" : p < 0 ? "text-success" : "text-muted-foreground";

export const pctTone = (p: number) =>
  (p > 0 ? "up" : p < 0 ? "down" : "flat") as "up" | "down" | "flat";

export const fmt = (v: number) =>
  v.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

/** Yuan -> yi (亿). */
export const yi = (v: number | null) =>
  v == null ? "—" : `${fmt(v / 1e8)} 亿`;

/** Yuan compact: 亿 / 万 / raw. */
export function fmtAmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)}万`;
  return `${sign}${abs.toFixed(0)}`;
}
