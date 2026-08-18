import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type OvlabFuturePositionDetails, type OvlabPositionProducts } from "@/lib/api";
import type { DerivData } from "@/hooks/useDerivData";
import { cn } from "@/lib/utils";
import { CellEmpty } from "./derivShared";

/**
 * 持仓排名摘要: product entries from future-position-products; headline shows
 * 净多/净空第一 of the first catalog product. Big tables stay in ?tab=detail.
 */
export function PositionCell({ d }: { d: DerivData }) {
  const [products, setProducts] = useState<OvlabPositionProducts | null>(null);
  const [detail, setDetail] = useState<OvlabFuturePositionDetails | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const catalogUnds = useMemo(() => new Set(d.catalogRows.map((c) => c.def.und)), [d.catalogRows]);

  const covered = useMemo(() => {
    const list = products?.products ?? [];
    return list.filter((p) => catalogUnds.has(p.product) || catalogUnds.has(p.product_alias));
  }, [products, catalogUnds]);

  useEffect(() => {
    let cancelled = false;
    api.ovlabFuturePositionProducts()
      .then((p) => {
        if (cancelled) return;
        setProducts(p);
        // Headline: first catalog product's 净多/净空第一.
        const first = (p.products ?? []).find((x) => d.catalogRows.some((c) => c.def.und === x.product));
        const code = first?.codes?.[0];
        const day = p.last_trading_day;
        if (first && code && day) {
          return api.ovlabFuturePositionDetails(first.product, code, day)
            .then((det) => { if (!cancelled) setDetail(det); });
        }
        return undefined;
      })
      .catch((e) => { if (!cancelled) setErr(e instanceof ApiError ? e.message : "未取到"); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per market frame
  }, [d.catalogRows.length]);

  if (err && !products) return <CellEmpty text="未取到" />;
  if (!products) return <CellEmpty text="更新中…" />;

  const first = covered[0];

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-0.5 border-b border-slate-800/60 px-2 py-1.5 text-[11px]">
        <div className="text-[10px] text-slate-500">
          {first ? `${first.product_alias} 主力` : "持仓排名"}
          {products.last_trading_day ? ` · ${products.last_trading_day}` : ""}
        </div>
        {detail ? (
          <div className="space-y-0.5">
            {detail.maxNetLong?.memberName && (
              <div>
                <span className="text-emerald-500">净多第一</span>
                <b className="ml-1.5 text-slate-200">{detail.maxNetLong.memberName}</b>
                <span className="ml-1 tabular-nums text-slate-400">{detail.maxNetLong.netIndicator?.toLocaleString()}</span>
              </div>
            )}
            {detail.maxNetShort?.memberName && (
              <div>
                <span className="text-red-500">净空第一</span>
                <b className="ml-1.5 text-slate-200">{detail.maxNetShort.memberName}</b>
                <span className="ml-1 tabular-nums text-slate-400">{detail.maxNetShort.netIndicator?.toLocaleString()}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-[10px] text-slate-600">净多/净空第一 更新中…</div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        {covered.slice(0, 12).map((p) => (
          <Link
            key={p.product}
            to="/derivatives?tab=detail&seg=position"
            className={cn(
              "flex items-center gap-2 rounded px-1.5 py-[2.5px] text-[11px] text-slate-300 hover:bg-slate-800/40",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{p.product_alias}</span>
            <span className="shrink-0 text-[10px] text-slate-500">{p.exchange_name}</span>
          </Link>
        ))}
        {covered.length === 0 && <CellEmpty text="目录品种暂无持仓排名" />}
      </div>
    </div>
  );
}
