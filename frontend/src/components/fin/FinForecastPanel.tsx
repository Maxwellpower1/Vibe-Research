import { useFin } from "@/components/fin/FinContext";
import { forecastTone, fmtYiYuan, TNUM } from "@/components/fin/utils";
import { pctColor } from "@/components/review/format";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function FinForecastPanel() {
  const { period, select } = useFin();
  const { data, error } = usePolling(() => api.finForecast(period), 1800_000, [period]);
  const stats = data?.stats;
  const total = stats ? stats.good + stats.bad + stats.neutral : 0;
  const hasItems = (data?.items.length ?? 0) > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {stats && hasItems && (
        <>
          <div className="flex h-[3px] w-full shrink-0">
            {stats.good > 0 && <div className="h-full bg-rose-400" style={{ width: `${(stats.good / total) * 100}%` }} />}
            {stats.bad > 0 && <div className="h-full bg-emerald-400" style={{ width: `${(stats.bad / total) * 100}%` }} />}
            {stats.neutral > 0 && <div className="h-full bg-slate-600" style={{ width: `${(stats.neutral / total) * 100}%` }} />}
          </div>
          <p className="shrink-0 px-2 py-0.5 font-mono text-[10px] text-slate-500" style={TNUM}>
            <span className="text-rose-400">预喜 {stats.good}▲</span>
            {"  "}
            <span className="text-emerald-400">预悲 {stats.bad}▼</span>
            {"  "}
            <span>未定 {stats.neutral}</span>
          </p>
        </>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {!data && <p className="py-6 text-center text-[11px] text-slate-600">{error ? "预告未接通" : "加载中…"}</p>}
        {data && !hasItems && (
          <p className="py-8 text-center text-[11px] text-slate-600">当前非业绩预告密集披露期</p>
        )}
        {(data?.items ?? []).map((it) => {
          const tone = forecastTone(it.type);
          const mid = (it.yoy_low + it.yoy_high) / 2;
          return (
            <button
              key={`${it.code}-${it.date}`}
              type="button"
              onClick={() => select(it.code, it.name)}
              className="grid w-full grid-cols-[36px_1fr_72px_64px] items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-slate-800/40"
            >
              <span className="font-mono text-[10px] text-slate-500">{it.date.slice(5)}</span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] text-slate-200">{it.name}</span>
                <span
                  className={cn(
                    "inline-block rounded px-1 text-[9px]",
                    tone === "good" && "bg-rose-500/15 text-rose-300",
                    tone === "bad" && "bg-emerald-500/15 text-emerald-300",
                    tone === "neutral" && "bg-slate-700/50 text-slate-400",
                  )}
                >
                  {it.type}
                </span>
              </span>
              <span className="text-right font-mono text-[10px] text-slate-400">
                {fmtYiYuan(it.profit_low)}~{fmtYiYuan(it.profit_high)}
              </span>
              <span className={cn("text-right font-mono text-[10px]", pctColor(mid))}>
                {it.yoy_low.toFixed(0)}~{it.yoy_high.toFixed(0)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
