import { useMemo, useState } from "react";
import {
  api, type OvlabFlowAlert, type OvlabFutureTsAll, type OvlabMarketRow, type OvlabProductExp,
} from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { DERIV_DEFS, type DerivDef } from "@/config/deriv";
import { previewCode, toSparkMap, type PreviewSeries } from "@/components/ovlab/shared";

export interface CatalogRow {
  def: DerivDef;
  row: OvlabMarketRow;
}

export interface DerivData {
  /** Full domestic market frame (is_overseas != 1), null until first load. */
  rows: OvlabMarketRow[] | null;
  marketUpdated: number;
  marketError: string | null;
  /** Catalog rows in DERIV_DEFS order; entries missing from the frame are dropped. */
  catalogRows: CatalogRow[];
  alerts: OvlabFlowAlert[] | null;
  alertUpdated: number;
  exps: OvlabProductExp[] | null;
  tsAll: OvlabFutureTsAll | null;
  /** preview code (prodUnd:exp) -> price+IV series, catalog codes only. */
  sparks: Record<string, PreviewSeries>;
  sparkLoading: boolean;
  refreshing: boolean;
  refresh: () => void;
}

const isDomestic = (r: OvlabMarketRow) => Number(r.is_overseas) !== 1;

/** One hook per cockpit: market frame + flow alerts + catalog spark series. No CTP. */
export function useDerivData(): DerivData {
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const market = usePolling(() => api.ovlabMarket(), 60_000, [nonce]);
  const alertPoll = usePolling(() => api.ovlabFlowAlert(), 60_000, [nonce]);
  const expPoll = usePolling(() => api.ovlabProductExps(), 300_000, [nonce]);
  const tsPoll = usePolling(() => api.ovlabFutureTsAll(), 300_000, [nonce]);

  const rows = useMemo(
    () => (market.data ? market.data.filter(isDomestic) : null),
    [market.data],
  );

  const catalogRows = useMemo<CatalogRow[]>(() => {
    if (!rows) return [];
    const byProduct = new Map(rows.map((r) => [String(r.product ?? ""), r]));
    return DERIV_DEFS.flatMap((def) => {
      const row = byProduct.get(def.product);
      return row ? [{ def, row }] : [];
    });
  }, [rows]);

  const codesKey = useMemo(
    () => catalogRows.map((c) => previewCode(c.row)).filter(Boolean).sort().join("|"),
    [catalogRows],
  );

  const sparkPoll = usePolling(
    () => api.ovlabPriceVolatilitySeries(codesKey.split("|").filter(Boolean)),
    300_000,
    [codesKey, nonce],
    codesKey.length > 0,
  );

  const sparks = useMemo<Record<string, PreviewSeries>>(
    () => toSparkMap(sparkPoll.data),
    [sparkPoll.data],
  );

  const refresh = () => {
    setRefreshing(true);
    setNonce((n) => n + 1);
    // usePolling re-runs on deps change; give the spinner a visible minimum.
    window.setTimeout(() => setRefreshing(false), 800);
  };

  return {
    rows,
    marketUpdated: market.updated,
    marketError: market.error,
    catalogRows,
    alerts: alertPoll.data,
    alertUpdated: alertPoll.updated,
    exps: expPoll.data,
    tsAll: tsPoll.data,
    sparks,
    sparkLoading: sparkPoll.data === null && codesKey.length > 0,
    refreshing,
    refresh,
  };
}
