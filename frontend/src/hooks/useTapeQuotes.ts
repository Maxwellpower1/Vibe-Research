import { useEffect, useMemo, useState } from "react";
import { WORLD_INDEX_DEFS } from "@/config/cockpit";
import type { TapeItem } from "@/components/cockpit/TickerTape";
import { api, type GlobalTreasuryCurve } from "@/lib/api";
import { useQuotes } from "@/lib/quoteHub";

const TAPE_MS = 20_000;
const INDEX_CODES = WORLD_INDEX_DEFS.map((d) => d.code);

/** Site-wide tape: quote hub for world indices + US 10Y/2Y. */
export function useTapeQuotes() {
  const hub = useQuotes(INDEX_CODES);
  const [treasury, setTreasury] = useState<GlobalTreasuryCurve | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void api.globalTreasuryCurve().then((ty) => {
        if (!cancelled) setTreasury(ty);
      }).catch(() => {
        if (!cancelled) setTreasury(null);
      });
    };
    const onVis = () => {
      if (!document.hidden) load();
    };
    load();
    const t = window.setInterval(load, TAPE_MS);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return useMemo(() => {
    const list: TapeItem[] = WORLD_INDEX_DEFS.flatMap((d) => {
      const q = hub[d.code];
      if (!q || !Number.isFinite(q.price) || q.price <= 0) return [];
      return [{ key: d.code, label: q.name || d.label, price: q.price, pct: q.pct }];
    });
    const pick = (tenor: string, label: string) => {
      const p = treasury?.points?.find((x) => x.tenor === tenor);
      if (!p || !Number.isFinite(p.yield)) return;
      const chg = p.chg;
      const pct = chg != null && p.yield ? (chg / p.yield) * 100 : 0;
      list.push({ key: `us${tenor}`, label, price: p.yield, pct, digits: 3 });
    };
    pick("10Y", "美债10Y");
    pick("2Y", "美债2Y");
    return list;
  }, [hub, treasury]);
}
