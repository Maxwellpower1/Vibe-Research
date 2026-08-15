import { cn } from "@/lib/utils";

export interface TapeItem {
  key: string;
  label: string;
  price: number;
  pct: number;
  digits?: number;
}

function fmtPrice(n: number, digits?: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits ?? 2);
}

function fmtPct(pct: number) {
  if (!Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function TapeChip({ it }: { it: TapeItem }) {
  const up = it.pct > 0;
  const down = it.pct < 0;
  return (
    <span className="mx-4 inline-flex items-baseline gap-1.5 whitespace-nowrap text-[11px] leading-7">
      <span className="text-slate-400">{it.label}</span>
      <span className="font-semibold tabular-nums text-slate-100">
        {fmtPrice(it.price, it.digits)}
      </span>
      <span
        className={cn(
          "font-medium tabular-nums",
          up && "text-red-400",
          down && "text-emerald-400",
          !up && !down && "text-slate-500",
        )}
      >
        {fmtPct(it.pct)}
      </span>
    </span>
  );
}

/** Repeat until one half is long enough that -50% translate loops off-screen. */
function padUnit(items: TapeItem[]): TapeItem[] {
  if (items.length >= 10) return items;
  const out = [...items];
  let n = 0;
  while (out.length < 10 && n < 6) {
    out.push(...items.map((it) => ({ ...it, key: `${it.key}~${n}` })));
    n += 1;
  }
  return out;
}

function renderChips(items: TapeItem[], suffix: string) {
  return items.map((it) => <TapeChip key={`${suffix}-${it.key}`} it={it} />);
}

export function TickerTape({ items }: { items: TapeItem[] }) {
  if (!items.length) {
    return <div className="h-7 shrink-0 border-b border-border bg-background" />;
  }

  const unit = padUnit(items);

  return (
    <div className="ticker-wrap relative h-7 shrink-0 overflow-hidden border-b border-border bg-background">
      <div className="ticker-track items-center">
        <div className="inline-flex">{renderChips(unit, "a")}</div>
        <div className="inline-flex" aria-hidden>{renderChips(unit, "b")}</div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}
