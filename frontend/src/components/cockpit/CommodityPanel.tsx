import { QuoteLine } from "@/components/cockpit/QuoteLine";
import { COMMODITIES, COMMODITY_CODES } from "@/config/cockpit";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";

const QUOTE_MS = 20_000;
const MINUTE_MS = 60_000;

export function CommodityPanel() {
  const { data, error } = usePolling(() => api.commodities(COMMODITY_CODES), QUOTE_MS, []);
  const { data: minutes } = usePolling(() => api.commodityMinutes(COMMODITY_CODES), MINUTE_MS, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-1">
      {!data && (
        <p className="py-6 text-center text-[11px] text-slate-600">
          {error ? "商品行情未接通, 自动重试中" : "加载中…"}
        </p>
      )}
      {COMMODITIES.map((c) => {
        const q = data?.[c.code];
        const m = minutes?.[c.code];
        const closes = (m?.points || []).map((p) => p.p).filter((n) => Number.isFinite(n) && n > 0);
        return (
          <QuoteLine
            key={c.code}
            name={c.label}
            price={q?.price}
            pct={q?.pct}
            unit={c.unit}
            accent={c.accent}
            closes={closes}
            prevClose={m?.prec ?? q?.prev}
          />
        );
      })}
    </div>
  );
}
