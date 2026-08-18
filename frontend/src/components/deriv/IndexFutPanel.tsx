import { useMemo, useState } from "react";
import { api, type OvlabMarketRow } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import type { DerivData } from "@/hooks/useDerivData";
import { cn } from "@/lib/utils";
import { nextSort, num, prevCloseOf, previewCode, toSparkMap, TrendSparkSvg, type SortState } from "@/components/ovlab/shared";
import { CellEmpty, cmpVal, contractCode, CtnText, IV_SORT_COLS, IvTriple, klineSym, NightMoon, SortableHd } from "./derivShared";

type BoardKey = "product_alias" | "price" | "ctn" | "atmv_current" | "atmv_percentile" | "carry";

const COLS: { key: BoardKey; label: string; cls: string; title?: string }[] = [
  { key: "product_alias", label: "品种", cls: "w-[3.4rem] justify-start text-left" },
  { key: "price", label: "最新", cls: "w-[3.2rem] justify-end text-right" },
  { key: "ctn", label: "涨跌", cls: "w-[3.2rem] justify-end text-right" },
  ...IV_SORT_COLS,
];

interface BoardItem {
  key: string;
  label: string;
  row: OvlabMarketRow;
}

function fieldOf(row: OvlabMarketRow, label: string, key: BoardKey): unknown {
  if (key === "product_alias") return label;
  return row[key];
}

/** Domestic commodity rows: sector_alias present and not 股指. */
function commodityRowsOf(rows: OvlabMarketRow[] | null): OvlabMarketRow[] {
  return (rows ?? []).filter((r) => {
    const s = String(r.sector_alias ?? "");
    return s && s !== "股指";
  });
}

/** 股指 + 商品主力: 一张竖表. 点列头整表排序; 默认股指在上、商品在下.
 *  非目录商品分时按可见码补拉. 行点击 -> onPickProduct; 合约码点击 -> onPickSymbol. */
export function IndexFutPanel({ d, nightOnly = false, onPickSymbol, onPickProduct }: {
  d: DerivData;
  nightOnly?: boolean;
  onPickSymbol?: (sym: string) => void;
  onPickProduct?: (prodUnd: string) => void;
}) {
  const [sort, setSort] = useState<SortState<Record<BoardKey, unknown>>>({ key: null, dir: "desc" });
  const items = useMemo(() => {
    const nightOk = (r: OvlabMarketRow) => !nightOnly || Number(r.has_night_trading) === 1;
    const indexItems: BoardItem[] = d.catalogRows
      .filter((c) => c.def.group !== "commodity" && nightOk(c.row))
      .map((c) => ({ key: c.def.product, label: c.def.label, row: c.row }));
    const catalogLabel = new Map(d.catalogRows.map((c) => [c.def.product, c.def.label]));
    const cmdItems: BoardItem[] = commodityRowsOf(d.rows)
      .filter(nightOk)
      .map((r) => ({
        key: `${r.product}-${r.exp ?? ""}`,
        label: catalogLabel.get(String(r.product ?? "")) ?? String(r.product_alias ?? r.product),
        row: r,
      }));
    const list = [...indexItems, ...cmdItems];
    if (!sort.key) return list;
    const key = sort.key;
    return [...list].sort((a, b) =>
      cmpVal(fieldOf(a.row, a.label, key), fieldOf(b.row, b.label, key), sort.dir),
    );
  }, [d.catalogRows, d.rows, nightOnly, sort]);

  // d.sparks 只覆盖目录码; 非目录品种 (LPG/燃油/乙二醇等) 按可见码补拉
  const missingKey = useMemo(() => {
    const codes = new Set<string>();
    for (const it of items) {
      const c = previewCode(it.row);
      if (c && !d.sparks[c]) codes.add(c);
    }
    return [...codes].sort().join("|");
  }, [items, d.sparks]);

  const extraPoll = usePolling(
    () => api.ovlabPriceVolatilitySeries(missingKey.split("|").filter(Boolean)),
    300_000,
    [missingKey],
    missingKey.length > 0,
  );
  const extraSparks = useMemo(() => toSparkMap(extraPoll.data), [extraPoll.data]);

  if (!d.rows) return <CellEmpty text={d.marketError ? "未取到" : "更新中…"} />;
  if (items.length === 0) return <CellEmpty text={nightOnly ? "无夜盘品种" : undefined} />;

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-card/95 px-2 pb-0.5 pt-1 text-[9px] text-slate-600">
        <span className="h-3.5 w-3.5 shrink-0" />
        {COLS.map((c) => (
          <SortableHd
            key={c.key}
            k={c.key}
            label={c.label}
            sort={sort}
            onSort={(k) => setSort((s) => nextSort(s, k))}
            className={c.cls}
            title={c.title}
          />
        ))}
        <span className="min-w-0 flex-1">分时</span>
      </div>
      <div className="divide-y divide-slate-800/60">
        {items.map(({ key, label, row }) => {
          const sym = klineSym(row);
          const code = contractCode(row);
          const pc = previewCode(row);
          const spark = d.sparks[pc] ?? extraSparks[pc];
          const price = num(row.price);
          const prodUnd = String(row.prodUnd ?? row.product);
          return (
            <button
              key={key}
              type="button"
              onClick={onPickProduct
                ? () => onPickProduct(prodUnd)
                : sym && onPickSymbol ? () => onPickSymbol(sym) : undefined}
              className={cn(
                "flex w-full items-center gap-1.5 px-2 py-[3px] text-left transition-colors",
                (onPickProduct || (onPickSymbol && sym)) && "hover:bg-slate-800/40",
              )}
              title={onPickProduct ? `调出 ${label} T 型报价` : sym ? `看 ${sym} K线` : undefined}
            >
              <NightMoon show={Number(row.has_night_trading) === 1} />
              <span className="w-[3.4rem] shrink-0 leading-tight">
                <span className="block truncate text-[11px] font-medium text-slate-200">{label}</span>
                <span
                  className={cn("block truncate font-mono text-[9px] text-cyan-500/70", sym && onPickSymbol && "hover:text-cyan-300")}
                  onClick={sym && onPickSymbol ? (e) => { e.stopPropagation(); onPickSymbol(sym); } : undefined}
                  title={sym ? `看 ${sym} K线` : undefined}
                >
                  {code || "-"}
                </span>
              </span>
              <span className="w-[3.2rem] shrink-0 text-right text-[11px] tabular-nums text-slate-300">
                {price !== null ? Number(price.toFixed(2)).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "-"}
              </span>
              <span className="w-[3.2rem] shrink-0 text-right text-[11px]">
                <CtnText value={row.ctn} boldOver={3} />
              </span>
              <IvTriple row={row} />
              <span className="flex h-[22px] min-w-0 flex-1 items-center">
                <TrendSparkSvg
                  prices={spark?.prices ?? []}
                  volatilities={spark?.volatilities ?? []}
                  base={prevCloseOf(row)}
                  width={64}
                  height={22}
                  fill
                  className="h-[22px]"
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
