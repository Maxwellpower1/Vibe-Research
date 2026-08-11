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
