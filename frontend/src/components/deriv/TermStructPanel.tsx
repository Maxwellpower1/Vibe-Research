import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { DerivData } from "@/hooks/useDerivData";
import { cn } from "@/lib/utils";
import { num } from "@/components/ovlab/shared";
import { CellEmpty } from "./derivShared";

interface TsExp {
  future_tday?: number;
  days_to_expiry?: number;
}

interface Slope {
  und: string;
  label: string;
  near: number;
  far: number;
  nearDays: number;
  farDays: number;
  /** (far - near) / near in %; positive = contango. */
  pct: number;
}

/** 期限结构: near-far slope per catalog commodity from future-ts-all. */
export function TermStructPanel({ d }: { d: DerivData }) {
  const slopes = useMemo<Slope[]>(() => {
    const ts = d.tsAll ?? {};
    const out: Slope[] = [];
    for (const c of d.catalogRows) {
      if (c.def.group !== "commodity") continue;
      const node = ts[c.def.und] as { exps?: Record<string, TsExp> } | undefined;
      const exps = node?.exps;
      if (!exps) continue;
      const list = Object.entries(exps)
        .map(([exp, v]) => ({ exp, price: num(v?.future_tday), days: num(v?.days_to_expiry) }))
        .filter((x): x is { exp: string; price: number; days: number } => x.price !== null && x.days !== null)
        .sort((a, b) => a.days - b.days);
      if (list.length < 2) continue;
      const near = list[0];
      const far = list[list.length - 1];
      if (near.price === 0) continue;
      out.push({
        und: c.def.und,
        label: c.def.label,
        near: near.price,
        far: far.price,
        nearDays: near.days,
        farDays: far.days,
        pct: ((far.price - near.price) / near.price) * 100,
      });
    }
    return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  }, [d.tsAll, d.catalogRows]);

  if (!d.tsAll) return <CellEmpty text="更新中…" />;
  if (slopes.length === 0) return <CellEmpty />;

  const maxAbs = Math.max(...slopes.map((s) => Math.abs(s.pct)), 0.01);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        {slopes.slice(0, 10).map((s) => (
          <div
            key={s.und}
            className="flex items-center gap-2 rounded px-1.5 py-[3px]"
            title={`近月(${s.nearDays}天) ${s.near} / 远月(${s.farDays}天) ${s.far}`}
          >
            <span className="w-[3.2rem] shrink-0 truncate text-[11px] text-slate-300">{s.label}</span>
            <span className="relative h-2 min-w-0 flex-1">
              <span className="absolute inset-y-0 left-1/2 w-px bg-slate-700" />
              <span
                className={cn(
                  "absolute top-0 h-full rounded-sm",
                  s.pct >= 0 ? "left-1/2 bg-red-500/70" : "right-1/2 bg-emerald-500/70",
                )}
                style={{ width: `${(Math.abs(s.pct) / maxAbs) * 50}%` }}
              />
            </span>
            <span className={cn("w-[3.4rem] shrink-0 text-right text-[10px] tabular-nums", s.pct >= 0 ? "text-red-400" : "text-emerald-400")}>
              {s.pct > 0 ? "+" : ""}{s.pct.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
      <Link
        to="/derivatives?tab=quote"
        className="block shrink-0 border-t border-slate-800/60 px-2 py-1 text-center text-[10px] text-slate-500 hover:text-cyan-300"
      >
        完整曲面 →
      </Link>
    </div>
  );
}
