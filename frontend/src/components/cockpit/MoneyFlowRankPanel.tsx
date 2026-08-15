import { X } from "lucide-react";
import { QuoteLine, klineHref } from "@/components/cockpit/QuoteLine";
import { fmtAmt, pctColor } from "@/components/review/format";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const POLL_MS = 20_000;

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
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-slate-700/40 px-1.5 py-1 text-[10px] text-slate-500">
        <span className="flex min-w-0 items-center gap-1">
          {sectorFilter ? (
            <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">
              <span className="truncate">{sectorFilter.name}</span>
              <button type="button" onClick={onClearSector} title="清除筛选" className="hover:text-rose-100">
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <span>个股 · 主力净额</span>
          )}
        </span>
        <span>
          合计 <span className={cn("font-mono", pctColor(total))}>{fmtAmt(total)}</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <div className="flex items-center justify-between px-1.5 py-0.5 text-[10px] text-slate-600">
          <span>名称</span>
          <span>成交额 · 现价</span>
        </div>
        {rows.map((r) => (
          <QuoteLine
            key={r.code}
            name={r.name}
            price={r.price}
            pct={r.change_pct}
            amount={r.amount}
            extra={fmtAmt(r.main_net)}
            href={klineHref(r.code)}
          />
        ))}
        {!data && (
          <p className="py-6 text-center text-[11px] text-slate-600">
            {error ? "资金流未接通, 自动重试中" : "加载中…"}
          </p>
        )}
        {data && rows.length === 0 && sectorFilter && (
          <p className="py-6 text-center text-[11px] text-slate-600">该板块暂无成分股主力净流入</p>
        )}
      </div>
    </div>
  );
}
