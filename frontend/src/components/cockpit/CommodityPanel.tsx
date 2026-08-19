import { useState } from "react";
import { QuoteLine } from "@/components/cockpit/QuoteLine";
import { COMMODITIES, COMMODITY_CODES, MACRO_INDEX_DEFS } from "@/config/cockpit";
import { usePolling } from "@/hooks/usePolling";
import { api, type FutureDaily } from "@/lib/api";
import { useMinutes } from "@/lib/minuteHub";
import { useQuotes } from "@/lib/quoteHub";
import { sparkSessionForRegion } from "@/lib/sparkAxis";
import { cn } from "@/lib/utils";

const MINUTE_MS = 60_000;
const SPOT_MS = 8 * 3600_000;
const DAILY_MS = 3600_000;
const FUT_CODES = COMMODITIES.map((c) => c.code);
const MACRO_CODES = MACRO_INDEX_DEFS.map((d) => d.code);
const FUT_HEAD = COMMODITIES.filter((c) => c.code === "hf_NQ");
const FUT_TAIL = [
  ...COMMODITIES.filter((c) => c.code === "hf_BTC"),
  ...COMMODITIES.filter((c) => c.code !== "hf_NQ" && c.code !== "hf_BTC"),
];

export function CommodityPanel() {
  const [tab, setTab] = useState<"fut" | "spot" | "daily">("fut");
  const hub = useQuotes([...FUT_CODES, ...MACRO_CODES]);
  const indexMinutes = useMinutes(MACRO_CODES);
  const { data: minutes, error } = usePolling(() => api.commodityMinutes(COMMODITY_CODES), MINUTE_MS, []);
  const { data: spot, error: spotErr } = usePolling(() => api.spotTable(), SPOT_MS, [], tab === "spot");
  const { data: chem } = usePolling(
    () => api.chemSpot("7250", "碳酸亚乙烯酯"),
    SPOT_MS,
    [],
    tab === "spot",
  );
  const { data: daily } = usePolling(async () => {
    const out: Record<string, FutureDaily | null> = {};
    await Promise.all(
      COMMODITIES.filter((c) => c.code.startsWith("hf_") || c.code.startsWith("nf_")).map(async (c) => {
        try {
          out[c.code] = await api.futureDaily(c.code, 60);
        } catch {
          out[c.code] = null;
        }
      }),
    );
    return out;
  }, DAILY_MS, [], tab === "daily");

  const futLine = (c: (typeof COMMODITIES)[number]) => {
    const q = hub[c.code];
    const m = minutes?.[c.code];
    const closes = (m?.points || []).map((p) => p.p).filter((n) => Number.isFinite(n) && n > 0);
    const times = (m?.points || []).map((p) => p.t);
    return (
      <QuoteLine
        key={c.code}
        name={c.label}
        price={q?.price}
        pct={q?.pct}
        unit={c.unit}
        accent={c.accent}
        closes={closes}
        times={times}
        session="h24"
        prevClose={m?.prec ?? q?.prev}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 px-2 py-1">
        {([
          ["fut", "标的"],
          ["spot", "现期"],
          ["daily", "日K"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px]",
              tab === k ? "bg-cyan-500/15 text-cyan-300" : "text-slate-500 hover:text-slate-300",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1 pt-0">
        {tab === "fut" && (
          <>
            {![...FUT_CODES, ...MACRO_CODES].some((code) => hub[code]?.price) && (
              <p className="py-6 text-center text-[11px] text-slate-600">
                {error ? "商品行情未接通, 自动重试中" : "加载中…"}
              </p>
            )}
            {FUT_HEAD.map(futLine)}
            {MACRO_INDEX_DEFS.map((d) => {
              const q = hub[d.code];
              const kl = indexMinutes[d.code];
              const closes = (kl?.bars || []).map((b) => b.close).filter((n) => Number.isFinite(n) && n > 0);
              const times = (kl?.bars || []).map((b) => b.datetime);
              const last = closes.length ? closes[closes.length - 1] : undefined;
              const prev = kl?.prev_close ?? q?.prev;
              const rawPct = q?.pct ?? (
                last != null && prev ? ((last - prev) / prev) * 100 : undefined
              );
              const pct = rawPct != null && Number.isFinite(rawPct)
                ? Number(rawPct.toFixed(2))
                : undefined;
              return (
                <QuoteLine
                  key={d.code}
                  name={q?.name || d.label}
                  price={q?.price ?? last}
                  pct={pct}
                  unit={d.code}
                  closes={closes}
                  times={times}
                  session={sparkSessionForRegion(d.region)}
                  accent={d.accent}
                  prevClose={prev}
                />
              );
            })}
            {FUT_TAIL.map(futLine)}
          </>
        )}
        {tab === "daily" && (
          <>
            {!daily && (
              <p className="py-6 text-center text-[11px] text-slate-600">加载中…</p>
            )}
            {COMMODITIES.map((c) => {
              const q = hub[c.code];
              const pts = daily?.[c.code]?.points ?? [];
              const closes = pts.map((p) => p.c).filter((n) => Number.isFinite(n) && n > 0);
              const times = pts.map((p) => p.t);
              const prevClose = pts.length >= 2 ? pts[pts.length - 2].c : q?.prev;
              return (
                <QuoteLine
                  key={c.code}
                  name={c.label}
                  price={q?.price}
                  pct={q?.pct}
                  unit={c.unit}
                  accent={c.accent}
                  closes={closes}
                  times={times}
                  session="daily"
                  prevClose={prevClose}
                />
              );
            })}
          </>
        )}
        {tab === "spot" && (
          <>
            {chem && (
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2 px-1 py-0.5 text-[11px]">
                <span className="text-slate-200">{chem.name}</span>
                <span className="font-mono tabular-nums text-slate-300">{chem.price}</span>
                <span className="text-[9px] text-slate-600">{chem.date}</span>
                <span className="text-[9px] text-slate-600">{chem.quotes} 报价</span>
                {chem.history?.length > 0 && (
                  <span className="text-[9px] text-slate-600">
                    {chem.history.slice(-5).map((h) => h.p).join(" / ")}
                  </span>
                )}
              </div>
            )}
            {!spot && (
              <p className="py-6 text-center text-[11px] text-slate-600">
                {spotErr ? "生意社现期表未接通, 自动重试中" : "加载中…"}
              </p>
            )}
            {spot && (
              <>
                <p className="px-1 pb-1 text-[9px] text-slate-600">
                  生意社 {spot.date} · 现货/期货/基差 · 只客观呈现
                </p>
                <div className="grid grid-cols-[1fr_52px_52px_48px] gap-1 px-1 text-[9px] text-slate-600">
                  <span>品种</span>
                  <span className="text-right">现货</span>
                  <span className="text-right">期货</span>
                  <span className="text-right">基差</span>
                </div>
              </>
            )}
            {(spot?.rows ?? []).slice(0, 40).map((r) => (
              <div
                key={`${r.exchange}-${r.name}-${r.contract}`}
                className="grid grid-cols-[1fr_52px_52px_48px] items-center gap-1 px-1 py-0.5 text-[11px] tabular-nums"
              >
                <span className="truncate text-slate-200" title={`${r.exchange} ${r.contract}`}>
                  {r.name}
                </span>
                <span className="text-right text-slate-300">{r.spot || "—"}</span>
                <span className="text-right text-slate-400">{r.futures || "—"}</span>
                <span className={cn("text-right", r.basis > 0 ? "text-rose-400" : r.basis < 0 ? "text-emerald-400" : "text-slate-500")}>
                  {r.basis ? r.basis.toFixed(1) : "—"}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
