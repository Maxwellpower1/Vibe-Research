import { QuoteLine } from "@/components/cockpit/QuoteLine";
import { WORLD_INDEX_DEFS } from "@/config/cockpit";
import { useMinutes } from "@/lib/minuteHub";
import { useQuotes } from "@/lib/quoteHub";

const INDEX_CODES = WORLD_INDEX_DEFS.map((d) => d.code);
const KLINE_SYMS = WORLD_INDEX_DEFS
  .filter((d) => /^(sh|sz|hk|us|wh)/i.test(d.code))
  .map((d) => d.code);

/** A + HK + US + FX. Prices from the quote hub; minutes from the minute hub. */
export function WorldIndexPanel() {
  const hub = useQuotes(INDEX_CODES);
  const minutes = useMinutes(KLINE_SYMS);
  const groups = [
    { name: "A股", defs: WORLD_INDEX_DEFS.filter((d) => d.region === "CN") },
    { name: "港股 · 美股 · 汇率", defs: WORLD_INDEX_DEFS.filter((d) => d.region !== "CN") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-1">
      {groups.map((g) => (
        <div key={g.name}>
          <div className="px-1 pb-0.5 pt-1 text-[9px] font-medium uppercase tracking-widest text-slate-500">
            {g.name}
          </div>
          {g.defs.map((d) => {
            const h = hub[d.code];
            const kl = minutes[d.code];
            const closes = (kl?.bars || []).map((b) => b.close).filter((n) => Number.isFinite(n));
            const times = (kl?.bars || []).map((b) => b.datetime);
            return (
              <QuoteLine
                key={d.code}
                variant="index"
                name={h?.name || d.label}
                unit={d.code}
                badge={d.region}
                price={h?.price}
                pct={h?.pct}
                amount={d.region !== "US" ? h?.amount : undefined}
                closes={closes}
                times={times}
                session={d.region === "CN" ? "ashare" : "h24"}
                prevClose={kl?.prev_close}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
