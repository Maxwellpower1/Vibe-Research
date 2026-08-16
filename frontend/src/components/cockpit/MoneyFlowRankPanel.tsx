import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { QuoteStockRow } from "@/components/cockpit/QuoteStockRow";
import { fmtAmt, pctColor } from "@/components/review/format";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { sparkFromKline } from "@/lib/lightKline";
import { useMinutes } from "@/lib/minuteHub";
import { cn } from "@/lib/utils";

const POLL_MS = 120_000;

export function MoneyFlowRankPanel({
  sectorFilter,
  onClearSector,
  onRight,
}: {
  sectorFilter?: { code: string; name: string } | null;
  onClearSector?: () => void;
  onRight?: (node: ReactNode) => void;
}) {
  const { data, error } = usePolling(
    () => api.stockFlow(15, sectorFilter?.code),
    POLL_MS,
    [sectorFilter?.code],
  );
  const rows = data?.rows ?? [];
  const total = rows.reduce((s, r) => s + (r.main_net || 0), 0);
  const codes = rows.map((r) => r.code);
  const minutes = useMinutes(codes);

  useEffect(() => {
    if (!onRight) return;
    onRight(
      <span className="flex items-center gap-2">
        {sectorFilter && (
          <span className="flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300">
            <span className="max-w-[5.5rem] truncate">{sectorFilter.name}</span>
            <button type="button" onClick={onClearSector} title="清除筛选" className="rounded hover:text-rose-100">
              <X size={11} />
            </button>
          </span>
        )}
        <span className="text-[10px] text-slate-500">
          {sectorFilter ? `板块内 ${rows.length} 只` : "TOP15 合计"}
          <span className={cn("ml-1 font-mono tabular-nums", pctColor(total))}>{fmtAmt(total)}</span>
        </span>
      </span>,
    );
  }, [onRight, sectorFilter, onClearSector, rows.length, total]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-1 px-2 py-1 text-[10px] text-slate-500">
        <span>个股 · 主力净额/净占比</span>
        <span>成交额 · 现价</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 pt-0">
        {rows.map((r) => {
          const sp = sparkFromKline(minutes[r.code]);
          return (
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
              spark={sp ?? { closes: [] }}
            />
          );
        })}
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
