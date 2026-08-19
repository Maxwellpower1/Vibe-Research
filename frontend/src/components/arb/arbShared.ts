import type { ArbLeg } from "@/lib/api";
import type { OvlabDataviewTick } from "@/lib/api";

export type ArbPick =
  | { kind: "cal"; key: string; label: string; left: string; right: string; leftUnd: string; rightUnd: string }
  | { kind: "cross"; key: string; label: string; left: string; right: string; leftUnd: string; rightUnd: string }
  | { kind: "idx"; key: string; label: string; left: string; right: string; leftUnd: string; cashCode: string; cashMult: number };

export function overlayLeg(leg: ArbLeg, ticks: Record<string, OvlabDataviewTick>): ArbLeg {
  const t = ticks[(leg.code || "").toUpperCase()];
  const last = t?.last;
  if (last == null || !Number.isFinite(last)) return leg;
  return { ...leg, px: last };
}

export function spreadTriple(a: ArbLeg, b: ArbLeg): {
  spread: number; spreadYd: number | null; spreadChg: number | null;
} {
  const spread = a.px - b.px;
  const spreadYd = a.pxYd != null && b.pxYd != null ? a.pxYd - b.pxYd : null;
  const spreadChg = spreadYd == null ? null : spread - spreadYd;
  return { spread, spreadYd, spreadChg };
}

export function fmtPx(v: number | null | undefined, digits?: number): string {
  if (v == null || !Number.isFinite(v)) return "-";
  if (digits != null) return v.toFixed(digits);
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export function fmtOi(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(Math.round(v));
}

export function chgClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || Math.abs(n) < 1e-9) return "text-slate-400";
  return n > 0 ? "text-red-400" : "text-emerald-400";
}

export function signed(v: number | null | undefined, digits?: number): string {
  if (v == null || !Number.isFinite(v)) return "-";
  const s = fmtPx(v, digits);
  return v > 0 ? `+${s}` : s;
}
