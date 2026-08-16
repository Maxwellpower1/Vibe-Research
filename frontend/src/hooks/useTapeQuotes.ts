import { useMemo } from "react";
import { COMMODITIES, WORLD_INDEX_DEFS } from "@/config/cockpit";
import type { TapeItem } from "@/components/cockpit/TickerTape";
import { useQuotes } from "@/lib/quoteHub";

const TAPE_CODES = [
  ...WORLD_INDEX_DEFS.map((d) => d.code),
  ...COMMODITIES.map((d) => d.code),
];

/** Site-wide tape: quote hub for world indices + commodities. */
export function useTapeQuotes() {
  const hub = useQuotes(TAPE_CODES);

  return useMemo(() => {
    const list: TapeItem[] = WORLD_INDEX_DEFS.flatMap((d) => {
      const q = hub[d.code];
      if (!q || !Number.isFinite(q.price) || q.price <= 0) return [];
      return [{ key: d.code, label: q.name || d.label, price: q.price, pct: q.pct }];
    });
    for (const d of COMMODITIES) {
      const q = hub[d.code];
      if (!q || !Number.isFinite(q.price) || q.price <= 0) continue;
      list.push({ key: d.code, label: d.label, price: q.price, pct: q.pct });
    }
    return list;
  }, [hub]);
}
