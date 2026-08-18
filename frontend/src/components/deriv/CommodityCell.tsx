import { useMemo } from "react";
import { api, type OvlabMarketRow } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import type { DerivData } from "@/hooks/useDerivData";
import { cn } from "@/lib/utils";
import { num, prevCloseOf, previewCode, toSparkMap, TrendSparkSvg } from "@/components/ovlab/shared";
import { CellEmpty, contractCode, CtnText, klineSym, NightMoon } from "./derivShared";

const COLS = [
  { label: "品种", cls: "w-[3.8rem] text-left" },
  { label: "最新", cls: "w-[3.8rem] text-right" },
  { label: "涨跌", cls: "w-[3.4rem] text-right" },
] as const;

/** All domestic commodity rows (same universe as 商品板块): sector_alias present and not 股指. */
export function commodityRowsOf(rows: OvlabMarketRow[] | null): OvlabMarketRow[] {
  return (rows ?? []).filter((r) => {
    const s = String(r.sector_alias ?? "");
    return s && s !== "股指";
  });
}

const absCtn = (r: OvlabMarketRow) => {
  const v = num(r.ctn);
  return v === null ? -1 : Math.abs(v);
};

/** 商品主力: 全市场国内商品 (不限目录), 按 |涨跌| 排序. 非目录品种分时按可见码补拉. */
export function CommodityCell({ d, nightOnly = false, onPickSymbol }: {
  d: DerivData;
  nightOnly?: boolean;
  onPickSymbol?: (sym: string) => void;
}) {
  const shown = useMemo(
    () => commodityRowsOf(d.rows)
      .filter((r) => !nightOnly || Number(r.has_night_trading) === 1)
      .sort((a, b) => absCtn(b) - absCtn(a)),
    [d.rows, nightOnly],
  );

  // d.sparks 只覆盖目录码; 非目录品种 (LPG/燃油/乙二醇等) 按可见码补拉
  const missingKey = useMemo(() => {
    const codes = new Set<string>();
    for (const r of shown) {
      const c = previewCode(r);
      if (c && !d.sparks[c]) codes.add(c);
    }
    return [...codes].sort().join("|");
  }, [shown, d.sparks]);

  const extraPoll = usePolling(
    () => api.ovlabPriceVolatilitySeries(missingKey.split("|").filter(Boolean)),
    300_000,
    [missingKey],
    missingKey.length > 0,
  );
  const extraSparks = useMemo(() => toSparkMap(extraPoll.data), [extraPoll.data]);

  if (!d.rows) return <CellEmpty text={d.marketError ? "未取到" : "更新中…"} />;
  if (shown.length === 0) return <CellEmpty text={nightOnly ? "无夜盘品种" : undefined} />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[9px] text-slate-600">
        <span className="h-3.5 w-3.5 shrink-0" />
        {COLS.map((c) => (
          <span key={c.label} className={cn("shrink-0", c.cls)}>{c.label}</span>
        ))}
        <span className="min-w-0 flex-1">分时</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1">
        {shown.map((r) => {
          const sym = klineSym(r);
          const code = contractCode(r);
          const pc = previewCode(r);
          const spark = d.sparks[pc] ?? extraSparks[pc];
          const price = num(r.price);
          return (
            <button
              key={`${r.product}-${r.exp ?? ""}`}
              type="button"
              onClick={sym && onPickSymbol ? () => onPickSymbol(sym) : undefined}
              className={cn(
                "flex w-full items-center gap-1.5 rounded px-1.5 py-[3px] text-left transition-colors",
                onPickSymbol && sym && "hover:bg-slate-800/40",
              )}
              title={sym ? `看 ${sym} K线` : undefined}
            >
              <NightMoon show={Number(r.has_night_trading) === 1} />
              <span className="w-[3.8rem] shrink-0 leading-tight">
                <span className="block truncate text-[11px] text-slate-200">{String(r.product_alias ?? r.product)}</span>
                <span className="block truncate font-mono text-[9px] text-cyan-500/70">{code || "-"}</span>
              </span>
              <span className="w-[3.8rem] shrink-0 text-right text-[11px] tabular-nums text-slate-300">
                {price !== null ? Number(price.toFixed(2)).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "-"}
              </span>
              <span className="w-[3.4rem] shrink-0 text-right text-[11px]">
                <CtnText value={r.ctn} boldOver={3} />
              </span>
              <span className="flex h-[20px] min-w-0 flex-1 items-center">
                <TrendSparkSvg
                  prices={spark?.prices ?? []}
                  volatilities={spark?.volatilities ?? []}
                  base={prevCloseOf(r)}
                  width={64}
                  height={20}
                  fill
                  className="h-[20px]"
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
