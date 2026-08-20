import { useEffect, useState } from "react";
import {
  api, authHeaders, type OvlabDataviewTick, type OvlabFlowAlert, type OvlabMarketRow, type OvlabMqttStatus,
} from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { retainOvlabMqtt, setOvlabMqttPins, watchOvlabMqtt } from "@/lib/ovlabMqtt";

/** Snapshot poll only when browser MQTT and SSE are both down. */
export const MQTT_POLL_MS = 500;
const FLOW_KEEP = 80;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function alertKey(a: OvlabFlowAlert): string {
  return `${a.contract_code ?? ""}|${a.time ?? ""}|${a.rule_id ?? ""}`;
}

function mergeFlowPatch(
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

/** Upsert MQTT ctamap rows by product, then prodUnd. */
export function overlayCta(
  prev: OvlabMarketRow[] | undefined,
  live: OvlabMarketRow[] | undefined,
): OvlabMarketRow[] {
  if (!live?.length) return prev ?? [];
  const out = [...(prev ?? [])];
  const idxP = new Map<string, number>();
  const idxU = new Map<string, number>();
  out.forEach((r, i) => {
    const p = String(r.product ?? "").trim().toUpperCase();
    const u = String(r.prodUnd ?? r.product_und ?? "").trim().toUpperCase();
    if (p) idxP.set(p, i);
    if (u) idxU.set(u, i);
  });
  for (const row of live) {
    const p = String(row.product ?? "").trim().toUpperCase();
    const u = String(row.prodUnd ?? row.product_und ?? "").trim().toUpperCase();
    const i = (p ? idxP.get(p) : undefined) ?? (u ? idxU.get(u) : undefined);
    if (i !== undefined) {
      out[i] = { ...out[i], ...row };
      continue;
    }
    out.push(row);
    const ni = out.length - 1;
    if (p) idxP.set(p, ni);
    if (u) idxU.set(u, ni);
  }
  return out;
}

/** Upsert dataview ticks keyed by upper(instr). */
export function overlayDv(
  prev: OvlabDataviewTick[] | undefined,
  live: OvlabDataviewTick[] | undefined,
): OvlabDataviewTick[] {
  if (!live?.length) return prev ?? [];
  const m: Record<string, OvlabDataviewTick> = {};
  for (const t of prev ?? []) {
    const k = String(t.instr ?? "").trim().toUpperCase();
    if (k) m[k] = t;
  }
  for (const t of live) {
    const k = String(t.instr ?? "").trim().toUpperCase();
    if (k) m[k] = t;
  }
  return Object.values(m);
}

/** Apply one SSE payload. replace=true is the opening snapshot. */
export function applyMqttTick(
  prev: OvlabMqttStatus | null,
  patch: Partial<OvlabMqttStatus>,
  replace = false,
): OvlabMqttStatus {
  const base: OvlabMqttStatus = prev ?? {
    enabled: true,
    connected: false,
    topics: [],
    sources: [],
    recv: 0,
    last_at: null,
    feeds_ui: true,
  };
  if (replace) return { ...base, ...patch };
  const next: OvlabMqttStatus = { ...base, ...patch };
  if (patch.ctamap?.length) next.ctamap = overlayCta(base.ctamap, patch.ctamap);
  if (patch.dataview?.length) next.dataview = overlayDv(base.dataview, patch.dataview);
  if (patch.optionflow?.length) {
    next.optionflow = (mergeFlowPatch(base.optionflow ?? null, patch.optionflow) ?? []).slice(0, FLOW_KEEP);
  }
  return next;
}

function dispatchSse(
  chunk: string,
  onEvent: (event: string, data: string) => void,
): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const raw of chunk.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length) onEvent(event, dataLines.join("\n"));
}

async function readSse(
  resp: Response,
  onEvent: (event: string, data: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = resp.body?.getReader();
  if (!reader) throw new Error("no SSE body");
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, "\n");
      let sep = buf.indexOf("\n\n");
      while (sep >= 0) {
        dispatchSse(buf.slice(0, sep), onEvent);
        buf = buf.slice(sep + 2);
        sep = buf.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * OpenVlab-style live feed: mqtt.js -> wss://emqx.openvlab.cn/mqtt.
 * SSE / GET /mqtt only if the broker socket is down.
 */
export function useOvlabMqtt(pinInstr: string[] = []) {
  const pinKey = pinInstr.map((c) => c.trim().toUpperCase()).filter(Boolean).join(",");
  const pins = pinKey ? pinKey.split(",") : [];
  const [streamed, setStreamed] = useState<OvlabMqttStatus | null>(null);
  const [mqttOk, setMqttOk] = useState(false);
  const [sseOk, setSseOk] = useState(false);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState(0);

  useEffect(() => {
    setMqttOk(false);
    setOvlabMqttPins(pins);
    const release = retainOvlabMqtt();
    const unwatch = watchOvlabMqtt(
      (patch) => {
        setStreamed((prev) => applyMqttTick(prev, {
          ...patch,
          enabled: true,
          connected: true,
          feeds_ui: true,
          last_at: Date.now() / 1000,
        }));
        setMqttOk(true);
        setStreamErr(null);
        setUpdated(Date.now());
      },
      (st) => {
        setMqttOk(st.connected);
        if (st.error) setStreamErr(st.error);
        setStreamed((prev) => (prev ? { ...prev, connected: st.connected, error: st.error } : prev));
      },
    );
    return () => {
      unwatch();
      release();
    };
    // pins derived from pinKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinKey]);

  useEffect(() => {
    if (mqttOk) {
      setSseOk(false);
      return;
    }
    const ac = new AbortController();
    let delay = 0;
    let started = false;

    const connect = async () => {
      try {
        await sleep(4000, ac.signal);
      } catch {
        return;
      }
      started = true;
      while (!ac.signal.aborted) {
        if (delay) {
          try {
            await sleep(delay, ac.signal);
          } catch {
            return;
          }
        }
        if (ac.signal.aborted) return;
        try {
          const resp = await fetch(`/api${api.ovlabMqttStreamPath(pins)}`, {
            headers: { ...authHeaders(), Accept: "text/event-stream" },
            signal: ac.signal,
            cache: "no-store",
          });
          if (!resp.ok || !resp.body) {
            throw new Error(resp.status === 401 ? "后端开启了访问鉴权" : `HTTP ${resp.status}`);
          }
          delay = 0;
          await readSse(resp, (event, raw) => {
            if (ac.signal.aborted) return;
            let payload: Partial<OvlabMqttStatus>;
            try {
              payload = JSON.parse(raw) as Partial<OvlabMqttStatus>;
            } catch {
              return;
            }
            if (event === "snapshot") {
              setStreamed((prev) => applyMqttTick(prev, payload, !prev));
              setSseOk(true);
              setStreamErr(null);
              setUpdated(Date.now());
              return;
            }
            if (event === "tick") {
              setStreamed((prev) => applyMqttTick(prev, payload));
              setUpdated(Date.now());
            }
          }, ac.signal);
          if (!ac.signal.aborted) setSseOk(false);
        } catch (e) {
          if (ac.signal.aborted) return;
          setSseOk(false);
          setStreamErr(e instanceof Error ? e.message : "sse failed");
        }
        delay = Math.min(delay ? delay * 2 : 1000, 8000);
      }
    };
    void connect();
    return () => {
      ac.abort();
      if (started) setSseOk(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinKey, mqttOk]);

  const liveOk = mqttOk || sseOk;
  const poll = usePolling(
    () => api.ovlabMqtt(pins),
    MQTT_POLL_MS,
    [pinKey],
    !liveOk,
  );

  const data = liveOk ? streamed : (poll.data ?? streamed);
  const error = liveOk ? null : (poll.error ?? streamErr);
  const at = liveOk ? updated : (poll.updated || updated);
  return { data, error, updated: at };
}
