import { Link } from "react-router-dom";
import { MinuteSpark } from "@/components/review/MinuteSpark";
import { PctChip } from "@/components/review/PctChip";
import { fmt, fmtAmt, pctColor } from "@/components/review/format";
import { cn } from "@/lib/utils";

export function QuoteLine({
  name,
  price,
  pct,
  amount,
  extra,
  extraClass,
  rank,
  closes,
  prevClose,
  href,
  unit,
  accent,
}: {
  name: string;
  price: number | null | undefined;
  pct: number | null | undefined;
  amount?: number | null;
  extra?: string;
  extraClass?: string;
  rank?: number;
  closes?: number[];
  prevClose?: number | null;
  href?: string;
  unit?: string;
  accent?: string;
}) {
  const inner = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        {rank != null && (
          <span className="w-4 shrink-0 text-right font-mono text-[10px] text-slate-600">{rank}</span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-[12px] text-slate-200" style={accent ? { color: accent } : undefined}>
            {name}
          </span>
          {unit && <span className="block truncate text-[9px] text-slate-600">{unit}</span>}
        </span>
      </span>
      <div className="min-w-0">
        {closes && closes.length > 1 ? (
          <MinuteSpark closes={closes} prevClose={prevClose} pct={pct ?? 0} />
        ) : (
          <div className="h-7" />
        )}
      </div>
      <span className="text-right">
        {amount != null && amount > 0 && (
          <span className="block font-mono text-[10px] tabular-nums text-slate-400">{fmtAmt(amount)}</span>
        )}
        {extra && (
          <span className={cn("block font-mono text-[10px] tabular-nums text-slate-500", extraClass)}>{extra}</span>
        )}
        <span className={cn("block font-mono text-[12px] font-bold tabular-nums", pctColor(pct ?? 0))}>
          {price != null && Number.isFinite(price) ? fmt(price) : "—"}
        </span>
      </span>
      <span className="text-right"><PctChip pct={pct} /></span>
    </>
  );
  const cls = "grid grid-cols-[minmax(4.5rem,1fr)_minmax(3rem,1.2fr)_4.2rem_3.1rem] items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-slate-800/40";
  if (href) {
    return <Link to={href} className={cls}>{inner}</Link>;
  }
  return <div className={cls}>{inner}</div>;
}

export function klineHref(code?: string) {
  if (!code) return undefined;
  const digits = code.replace(/^(sh|sz|bj)/i, "");
  if (!/^\d{6}$/.test(digits)) return undefined;
  return `/a-share?tab=kline&code=${digits}`;
}
