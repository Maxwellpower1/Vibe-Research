import { X } from "lucide-react";
import { QuoteStockRow } from "@/components/cockpit/QuoteStockRow";
import { fmtAmt, pctColor } from "@/components/review/format";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const POLL_MS = 120_000;

export function MoneyFlowRankPanel({
  sectorFilter,
  onClearSector,
}: {
  sectorFilter?: { code: string; name: string } | null;
  onClearSector?: () => void;
}) {
  const { data, error } = usePolling(
    () => api.stockFlow(15, sectorFilter?.code),
    POLL_MS,
    [sectorFilter?.code],
  );
  const rows = data?.rows ?? [];
  const total = rows.reduce((s, r) => s + (r.main_net || 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-1 px-2 py-1 text-[10px] text-slate-500">
        <span className="flex min-w-0 items-center gap-1">
          {sectorFilter ? (
            <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">
              <span className="truncate">{sectorFilter.name}</span>
              <button type="button" onClick={onClearSector} title="清除筛选" className="hover:text-rose-100">
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <span>个股 · 主力净额/净占比</span>
          )}
        </span>
        <span>
          {sectorFilter ? `板块内 ${rows.length} 只` : "TOP15 合计"}
          <span className={cn("ml-1 font-mono", pctColor(total))}>{fmtAmt(total)}</span>
          <span className="ml-2 text-slate-600">成交额 · 现价</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 pt-0">
        {rows.map((r) => (
          <QuoteStockRow
            key={r.code}
            code={r.code}
            name={r.name}
            price={r.price}
            pct={r.change_pct}
            amount={r.amount}
            turnover={r.turnover}
            mainNet={r.main_net}
            mainPct={r.main_pct}
          />
        ))}
        {!data && (
          <p className="py-6 text-center text-[11px] text-slate-600">
            {error ? "资金流未接通, 自动重试中" : "资金流数据加载中…"}
          </p>
        )}
        {data && rows.length === 0 && sectorFilter && (
          <p className="py-6 text-center text-[11px] text-slate-600">该板块暂无成分股主力净流入</p>
        )}
      </div>
    </div>
  );
}
