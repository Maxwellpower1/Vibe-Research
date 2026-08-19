import { useMemo, useState } from "react";
import { api, type ArbBoard, type ArbCalendarRow, type ArbCrossRow, type ArbIndexRow } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { ticksByInstr } from "@/hooks/useDerivData";
import { overlayLeg, spreadTriple } from "@/components/arb/arbShared";

export interface ArbData {
  board: ArbBoard | null;
  calendar: ArbCalendarRow[];
  cross: ArbCrossRow[];
  index: ArbIndexRow[];
  updated: number;
  error: string | null;
  mqtt: { enabled: boolean; connected: boolean } | null;
  refreshing: boolean;
  refresh: () => void;
}

export function useArbData(): ArbData {
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const boardPoll = usePolling(() => api.ovlabArbBoard(), 60_000, [nonce]);
  const mqttPoll = usePolling(() => api.ovlabMqtt(), 2_000, [nonce]);
  const ticks = useMemo(() => ticksByInstr(mqttPoll.data?.dataview), [mqttPoll.data]);

  const calendar = useMemo(() => {
    const rows = boardPoll.data?.calendar ?? [];
    return rows.map((r) => {
      const near = overlayLeg(r.near, ticks);
      const next = overlayLeg(r.next, ticks);
      return { ...r, near, next, ...spreadTriple(near, next) };
    });
  }, [boardPoll.data, ticks]);

  const cross = useMemo(() => {
    const rows = boardPoll.data?.cross ?? [];
    return rows.map((r) => {
      const a = overlayLeg(r.a, ticks);
      const b = overlayLeg(r.b, ticks);
      return { ...r, a, b, ...spreadTriple(a, b) };
    });
  }, [boardPoll.data, ticks]);

  const index = useMemo(() => {
    const rows = boardPoll.data?.index ?? [];
    return rows.map((r) => ({ ...r, near: overlayLeg(r.near, ticks) }));
  }, [boardPoll.data, ticks]);

  const refresh = () => {
    setRefreshing(true);
    setNonce((n) => n + 1);
    window.setTimeout(() => setRefreshing(false), 400);
  };

  const mqtt = mqttPoll.data
    ? { enabled: mqttPoll.data.enabled, connected: mqttPoll.data.connected }
    : null;

  return {
    board: boardPoll.data,
    calendar,
    cross,
    index,
    updated: boardPoll.updated,
    error: boardPoll.error,
    mqtt,
    refreshing,
    refresh,
  };
}
