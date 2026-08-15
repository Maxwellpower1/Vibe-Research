import { QuoteLine } from "@/components/cockpit/QuoteLine";
import { WORLD_INDEX_DEFS } from "@/config/cockpit";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { loadLightKlineBatch } from "@/lib/lightKline";
import { useQuotes } from "@/lib/quoteHub";

const POLL_MS = 20_000;
const KLINE_MS = 60_000;
const INDEX_CODES = WORLD_INDEX_DEFS.map((d) => d.code);
const KLINE_SYMS = WORLD_INDEX_DEFS
  .filter((d) => /^(sh|sz|hk|us|wh)/i.test(d.code))
  .map((d) => d.code);

/** A + HK + US + FX key indices (replaces the old CN/global tabbed index cell). */
export function WorldIndexPanel() {
  const hub = useQuotes(INDEX_CODES);
  const { data, error } = usePolling(() => api.worldIndices(), POLL_MS, []);
  const { data: minutes } = usePolling(
    () => loadLightKlineBatch(KLINE_SYMS, "1", 240),
    KLINE_MS,
    [],
  );

  const bySym = new Map((data ?? []).map((r) => [r.symbol, r]));
  const hasPrice = WORLD_INDEX_DEFS.some((d) => (hub[d.code]?.price || bySym.get(d.code)?.price));
  const groups = [
    { name: "A股", defs: WORLD_INDEX_DEFS.filter((d) => d.region === "CN") },
    { name: "港股 · 美股 · 汇率", defs: WORLD_INDEX_DEFS.filter((d) => d.region !== "CN") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-1">
      {!hasPrice && (
        <p className="py-6 text-center text-[11px] text-slate-600">
          {error ? "全球指数未接通, 自动重试中" : "加载中…"}
        </p>
      )}
      {hasPrice && groups.map((g) => (
        <div key={g.name}>
          <div className="px-1 pb-0.5 pt-1 text-[9px] font-medium uppercase tracking-widest text-slate-500">
            {g.name}
          </div>
          {g.defs.map((d) => {
            const q = bySym.get(d.code);
            const h = hub[d.code];
            const kl = minutes?.[d.code];
            const closes = (kl?.bars || []).map((b) => b.close).filter((n) => Number.isFinite(n));
            return (
              <QuoteLine
                key={d.code}
                name={h?.name || q?.name || d.label}
                price={h?.price || q?.price}
                pct={h?.pct ?? q?.change_pct}
                closes={closes}
                prevClose={kl?.prev_close}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
