import { useEffect, useState } from "react";
import { QuoteLine } from "@/components/cockpit/QuoteLine";
import { WORLD_INDEX_DEFS } from "@/config/cockpit";
import { usePolling } from "@/hooks/usePolling";
import { api, type AShareLightKline } from "@/lib/api";
import { loadLightKline } from "@/lib/lightKline";

const POLL_MS = 20_000;
const KLINE_MS = 60_000;
const KLINE_SYMS = WORLD_INDEX_DEFS
  .filter((d) => /^(sh|sz|hk)/i.test(d.code))
  .map((d) => d.code);

/** A + HK + US + FX key indices (replaces the old CN/global tabbed index cell). */
export function WorldIndexPanel() {
  const { data, error } = usePolling(() => api.worldIndices(), POLL_MS, []);
  const [minutes, setMinutes] = useState<Record<string, AShareLightKline | null>>({});

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void Promise.all(
        KLINE_SYMS.map(async (sym) => {
          try {
            const d = await loadLightKline(sym, "1", 240);
            return [sym, d] as const;
          } catch {
            return [sym, null] as const;
          }
        }),
      ).then((rows) => {
        if (cancelled) return;
        setMinutes((prev) => {
          const next = { ...prev };
          for (const [sym, d] of rows) next[sym] = d;
          return next;
        });
      });
    };
    const onVis = () => {
      if (!document.hidden) load();
    };
    load();
    const id = window.setInterval(load, KLINE_MS);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const bySym = new Map((data ?? []).map((r) => [r.symbol, r]));
  const groups = [
    { name: "A股", defs: WORLD_INDEX_DEFS.filter((d) => d.region === "CN") },
    { name: "港股 · 美股 · 汇率", defs: WORLD_INDEX_DEFS.filter((d) => d.region !== "CN") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-1">
      {!data && (
        <p className="py-6 text-center text-[11px] text-slate-600">
          {error ? "全球指数未接通, 自动重试中" : "加载中…"}
        </p>
      )}
      {data && groups.map((g) => (
        <div key={g.name}>
          <div className="px-1 pb-0.5 pt-1 text-[9px] font-medium uppercase tracking-widest text-slate-500">
            {g.name}
          </div>
          {g.defs.map((d) => {
            const q = bySym.get(d.code);
            const kl = minutes[d.code];
            const closes = (kl?.bars || []).map((b) => b.close).filter((n) => Number.isFinite(n));
            return (
              <QuoteLine
                key={d.code}
                name={q?.name || d.label}
                price={q?.price}
                pct={q?.change_pct}
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
