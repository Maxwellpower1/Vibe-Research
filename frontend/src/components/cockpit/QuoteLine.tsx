import { Link } from "react-router-dom";
import { MinuteSpark } from "@/components/review/MinuteSpark";
import { PctChip } from "@/components/review/PctChip";
import { bgChg, fmt, fmtAmt, fmtAmtInt, fmtPrice, pctColor } from "@/components/review/format";
import type { SparkSession } from "@/lib/sparkAxis";
import { cn } from "@/lib/utils";

function Spark({
  closes,
  times,
  session,
  prevClose,
  pct,
  className,
}: {
  closes?: number[];
  times?: string[];
  session?: SparkSession;
  prevClose?: number | null;
  pct?: number | null;
  className?: string;
}) {
  return (
    <MinuteSpark
      closes={closes ?? []}
      times={times}
      session={session}
      prevClose={prevClose}
      pct={pct ?? 0}
      className={className}
    />
  );
}

export function QuoteLine({
  name,
  price,
  pct,
  amount,
  extra,
  extraClass,
  rank,
  closes,
  times,
  session,
  prevClose,
  href,
  unit,
  accent,
  variant = "plain",
}: {
  name: string;
  price: number | null | undefined;
  pct: number | null | undefined;
  amount?: number | null;
  extra?: string;
  extraClass?: string;
  rank?: number;
  closes?: number[];
  times?: string[];
  session?: SparkSession;
  prevClose?: number | null;
  href?: string;
  unit?: string;
  accent?: string;
  variant?: "plain" | "index";
}) {
  const spark = (className?: string) => (
    <Spark closes={closes} times={times} session={session} prevClose={prevClose} pct={pct} className={className} />
  );
  const inner = variant === "index" ? (
    <div
      className="grid items-center gap-x-1.5"
      style={{ gridTemplateColumns: "72px minmax(0,1fr) 70px", gridTemplateRows: "16px 14px" }}
    >
      <div className="row-span-2 flex min-w-0 flex-col justify-center gap-0.5 leading-none">
        <span className="truncate text-[11px] text-slate-200" style={accent ? { color: accent } : undefined}>
          {name}
        </span>
        {unit && <span className="truncate text-[9px] text-slate-500">{unit}</span>}
      </div>
      <div className="flex h-4 min-w-0 items-center self-center">{spark("h-4")}</div>
      <span className={cn("self-center text-right text-[12px] font-bold leading-none tabular-nums", pctColor(pct ?? 0))}>
        {price != null && Number.isFinite(price) ? fmtPrice(price) : "—"}
      </span>
      <span className="self-center truncate text-right text-[9px] leading-none tabular-nums text-slate-500">
        {amount != null && amount > 0 ? fmtAmtInt(amount) : "—"}
      </span>
      <span
        className={cn(
          "self-center justify-self-end rounded px-0.5 text-[10px] font-semibold leading-none tabular-nums",
          pct != null && Number.isFinite(pct) ? bgChg(pct) : "text-slate-600",
        )}
      >
        {pct != null && Number.isFinite(pct) ? `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%` : ""}
      </span>
    </div>
  ) : (
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
      <div className="min-w-0">{spark()}</div>
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
  const cls = variant === "index"
    ? "block w-full rounded px-1.5 py-[2px] hover:bg-slate-800/40"
    : "grid grid-cols-[minmax(4.5rem,1fr)_minmax(3rem,1.2fr)_4.2rem_3.1rem] items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-slate-800/40";
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
