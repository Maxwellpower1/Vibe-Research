import { Link } from "react-router-dom";
import { QuoteStockRow } from "@/components/cockpit/QuoteStockRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { usePolling } from "@/hooks/usePolling";
import { klineFromBatch, loadLightKlineBatch } from "@/lib/lightKline";
import { useQuotes } from "@/lib/quoteHub";

const MAX_ROWS = 40;

/** Watchlist rows share QuoteStockRow + the 5s quote hub. */
export function WatchlistCockpitPanel({ codes }: { codes: string[] }) {
  const visible = codes.slice(0, MAX_ROWS);
  const hub = useQuotes(visible);
  const { data: sparks } = usePolling(
    () => (visible.length ? loadLightKlineBatch(visible, "1", 240) : Promise.resolve({})),
    60_000,
    [visible.join(",")],
    visible.length > 0,
  );

  if (!codes.length) {
    return (
      <EmptyState
        title="还没有自选股"
        description="到「K线」页添加代码后，这里会显示额/价/换/幅和分时。"
        action={
          <Link
            to="/a-share?tab=kline"
            className="btn-press mt-1 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary ring-1 ring-primary/20 hover:bg-primary/25"
          >
            去 K 线加自选
          </Link>
        }
      />
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-1">
      {visible.map((c) => {
        const q = hub[c];
        const kl = klineFromBatch(sparks, c);
        const closes = (kl?.bars || []).map((b) => b.close).filter((n) => Number.isFinite(n));
        return (
          <QuoteStockRow
            key={c}
            code={c}
            name={q?.name || c}
            price={q?.price}
            pct={q?.pct}
            amount={q?.amount}
            turnover={q?.turnover}
            spark={kl ? { closes, prevClose: kl.prev_close } : sparks ? { closes: [] } : undefined}
          />
        );
      })}
      {codes.length > MAX_ROWS && (
        <p className="px-1.5 pt-1 text-center text-[10px] text-slate-600">
          自选较多, 仅展示前 {MAX_ROWS} 只 · 共 {codes.length} 只
        </p>
      )}
    </div>
  );
}
