import { useEffect, useMemo, useState } from "react";
import { api, type GlobalIndex, type GlobalTreasuryCurve, type IndexQuote } from "@/lib/api";
import type { TapeItem } from "@/components/cockpit/TickerTape";

const TAPE_MS = 30_000;

function toItems(
  indices: IndexQuote[],
  globalIdx: GlobalIndex[],
  treasury: GlobalTreasuryCurve | null,
): TapeItem[] {
  const list: TapeItem[] = indices
    .filter((i) => Number.isFinite(i.price))
    .map((i) => ({
      key: i.symbol || i.name,
      label: i.name,
      price: i.price,
      pct: i.change_pct,
    }));
  for (const g of globalIdx) {
    if (g.price == null || g.change_pct == null) continue;
    list.push({ key: g.key, label: g.name, price: g.price, pct: g.change_pct });
  }
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
}

/** Site-wide tape: A-share indices + global + US 10Y/2Y. */
export function useTapeQuotes() {
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [globalIdx, setGlobalIdx] = useState<GlobalIndex[]>([]);
  const [treasury, setTreasury] = useState<GlobalTreasuryCurve | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void Promise.all([
        api.indices().catch(() => [] as IndexQuote[]),
        api.globalIndices().catch(() => [] as GlobalIndex[]),
        api.globalTreasuryCurve().catch(() => null),
      ]).then(([ix, gi, ty]) => {
        if (cancelled) return;
        setIndices(ix ?? []);
        setGlobalIdx(gi ?? []);
        setTreasury(ty);
      });
    };
    load();
    const t = window.setInterval(load, TAPE_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  return useMemo(() => toItems(indices, globalIdx, treasury), [indices, globalIdx, treasury]);
}
