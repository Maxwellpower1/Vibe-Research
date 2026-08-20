import { useMemo, useState } from "react";
import {
  api, type OvlabDataviewTick, type OvlabFlowAlert, type OvlabMarketRow, type OvlabProductExp,
} from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { useOvlabMqtt } from "@/hooks/useOvlabMqtt";
import { DERIV_DEFS, type DerivDef } from "@/config/deriv";
import { previewCode, toSparkMap, type PreviewSeries } from "@/components/ovlab/shared";

export { MQTT_POLL_MS } from "@/hooks/useOvlabMqtt";

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
  /** MQTT: enabled/connected/error from browser EMQX socket (SSE fallback). */
  alertMqtt: { enabled: boolean; connected: boolean; error: string | null } | null;
  /** dataview last print, keyed upper(instr). */
  ticks: Record<string, OvlabDataviewTick>;
  exps: OvlabProductExp[] | null;
  /** preview code (prodUnd:exp) -> price+IV series, catalog codes only. */
  sparks: Record<string, PreviewSeries>;
  sparkLoading: boolean;
  refreshing: boolean;
  refresh: () => void;
}

const isDomestic = (r: OvlabMarketRow) => Number(r.is_overseas) !== 1;

const MARKET_LIVE = [
  "price", "ctn", "atmv_current", "atmv_1dchg", "atmv_percentile",
  "carry", "skew_current", "skew_1dchg", "last_time", "exp",
] as const;

function alertKey(a: OvlabFlowAlert): string {
  return `${a.contract_code ?? ""}|${a.time ?? ""}|${a.rule_id ?? ""}`;
}

/** REST seed + MQTT live rows. Same contract/time/rule: MQTT wins. */
export function mergeFlowAlerts(
  rest: OvlabFlowAlert[] | null,
  live: OvlabFlowAlert[] | null | undefined,
): OvlabFlowAlert[] | null {
  if (!live?.length) return rest;
  if (!rest?.length) return live;
  const map = new Map<string, OvlabFlowAlert>();
  for (const a of rest) map.set(alertKey(a), a);
  for (const a of live) map.set(alertKey(a), a);
  return [...map.values()].sort((a, b) => String(b.time ?? "").localeCompare(String(a.time ?? "")));
}

function overlayMarket(rest: OvlabMarketRow, live: OvlabMarketRow): OvlabMarketRow {
  const out: OvlabMarketRow = { ...rest };
  const bag = out as Record<string, unknown>;
  for (const k of MARKET_LIVE) {
    const v = live[k];
    if (v !== undefined && v !== null && v !== "") bag[k] = v;
  }
  return out;
}

/** REST market seed + MQTT ctamap ticks. Does not add MQTT-only products. */
export function mergeMarketRows(
  rest: OvlabMarketRow[] | null,
  live: OvlabMarketRow[] | null | undefined,
): OvlabMarketRow[] | null {
  if (!rest) return rest;
  if (!live?.length) return rest;
  const byProduct = new Map<string, OvlabMarketRow>();
  const byUnd = new Map<string, OvlabMarketRow>();
  for (const r of live) {
    const p = String(r.product ?? "").trim().toUpperCase();
    const u = String(r.prodUnd ?? r.product_und ?? "").trim().toUpperCase();
    if (p) byProduct.set(p, r);
    if (u) byUnd.set(u, r);
  }
  return rest.map((r) => {
    const p = String(r.product ?? "").trim().toUpperCase();
    const u = String(r.prodUnd ?? "").trim().toUpperCase();
    const tick = (p && byProduct.get(p)) || (u && byUnd.get(u));
    return tick ? overlayMarket(r, tick) : r;
  });
}

export function ticksByInstr(list: OvlabDataviewTick[] | null | undefined): Record<string, OvlabDataviewTick> {
  const m: Record<string, OvlabDataviewTick> = {};
  for (const t of list ?? []) {
    const k = String(t.instr ?? "").trim().toUpperCase();
    if (k) m[k] = t;
  }
  return m;
}

/** One hook per cockpit: market frame + flow alerts + catalog spark series. No CTP. */
export function useDerivData(pinInstr: string[] = []): DerivData {
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const market = usePolling(() => api.ovlabMarket(), 60_000, [nonce]);
  const alertPoll = usePolling(() => api.ovlabFlowAlert(), 60_000, [nonce]);
  const mqttPoll = useOvlabMqtt(pinInstr);
  const expPoll = usePolling(() => api.ovlabProductExps(), 0, [nonce]);

  const rows = useMemo(
    () => {
      const rest = market.data ? market.data.filter(isDomestic) : null;
      return mergeMarketRows(rest, mqttPoll.data?.ctamap);
    },
    [market.data, mqttPoll.data],
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
    window.setTimeout(() => setRefreshing(false), 800);
  };

  const alerts = useMemo(
    () => mergeFlowAlerts(alertPoll.data, mqttPoll.data?.optionflow),
    [alertPoll.data, mqttPoll.data],
  );
  const ticks = useMemo(
    () => ticksByInstr(mqttPoll.data?.dataview),
    [mqttPoll.data],
  );
  const mqttAt = mqttPoll.data?.last_at;
  const mqtt = mqttPoll.data;
  const liveMs = mqtt?.connected && mqttAt ? Math.round(mqttAt * 1000) : 0;
  const alertUpdated = liveMs || alertPoll.updated;

  return {
    rows,
    marketUpdated: liveMs || market.updated,
    marketError: market.error,
    catalogRows,
    alerts,
    alertUpdated,
    alertMqtt: mqtt
      ? { enabled: mqtt.enabled, connected: mqtt.connected, error: mqtt.error ?? null }
      : mqttPoll.error
        ? { enabled: true, connected: false, error: mqttPoll.error }
        : null,
    ticks,
    exps: expPoll.data,
    sparks,
    sparkLoading: sparkPoll.data === null && codesKey.length > 0,
    refreshing,
    refresh,
  };
}
