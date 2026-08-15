import { useEffect, useMemo, useState } from "react";
import { api, type GlobalTreasuryCurve, type WorldIndex } from "@/lib/api";
import type { TapeItem } from "@/components/cockpit/TickerTape";

const TAPE_MS = 20_000;

function toItems(
  world: WorldIndex[],
  treasury: GlobalTreasuryCurve | null,
): TapeItem[] {
  const list: TapeItem[] = world
    .filter((i) => Number.isFinite(i.price))
    .map((i) => ({
      key: i.symbol,
      label: i.name || i.label,
      price: i.price,
      pct: i.change_pct,
    }));
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

/** Site-wide tape: same world-indices cache as the cockpit panel + US 10Y/2Y. */
export function useTapeQuotes() {
  const [world, setWorld] = useState<WorldIndex[]>([]);
  const [treasury, setTreasury] = useState<GlobalTreasuryCurve | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void Promise.all([
        api.worldIndices().catch(() => [] as WorldIndex[]),
        api.globalTreasuryCurve().catch(() => null),
      ]).then(([wi, ty]) => {
        if (cancelled) return;
        setWorld(wi ?? []);
        setTreasury(ty);
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

  return useMemo(() => toItems(world, treasury), [world, treasury]);
}
