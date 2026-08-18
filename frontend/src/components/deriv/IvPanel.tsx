import { useState } from "react";
import type { DerivData } from "@/hooks/useDerivData";
import type { OvlabMarketRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { nextSort, num, sortRows, SortableTh, type SortState } from "@/components/ovlab/shared";
import { CellEmpty, klineSym } from "./derivShared";

const COLS: { key: keyof OvlabMarketRow; label: string; cls?: string; sortable?: boolean; title?: string }[] = [
  { key: "product_alias", label: "品种", sortable: true },
  { key: "atmv_current", label: "隐波", cls: "text-right", sortable: true, title: "平值隐波" },
  { key: "atmv_percentile", label: "IV百分位", cls: "text-right", sortable: true, title: "隐波百分位, >=90 贵 / <=10 便宜" },
  { key: "carry", label: "IV溢价", cls: "text-right", sortable: true, title: "波动率溢价 = 隐波 - 实波" },
];

/** 隐波/溢价: 全部国内品种一张表, 点列头排序 (默认 IVP 降序). */
export function IvPanel({ d, onPickSymbol, onPickProduct }: {
  d: DerivData;
  onPickSymbol?: (sym: string) => void;
  /** 提供时行点击联动 T 型报价, 不再跳 K线. */
  onPickProduct?: (prodUnd: string) => void;
}) {
  const [sort, setSort] = useState<SortState<OvlabMarketRow>>({ key: "atmv_percentile", dir: "desc" });

  if (!d.rows) return <CellEmpty text={d.marketError ? "未取到" : "更新中…"} />;
  const rows = sortRows(d.rows, sort);
  if (rows.length === 0) return <CellEmpty />;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="data-table">
        <thead>
          <tr>
            {COLS.map((c) => (
              <SortableTh key={c.key} col={c} sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sym = klineSym(r);
            const iv = num(r.atmv_current);
            const ivp = num(r.atmv_percentile);
            const carry = num(r.carry);
            const extreme = ivp !== null && (ivp >= 90 || ivp <= 10);
            return (
              <tr
                key={`${r.product}-${r.exp ?? ""}`}
                onClick={onPickProduct
                  ? () => onPickProduct(String(r.prodUnd ?? r.product))
                  : sym && onPickSymbol ? () => onPickSymbol(sym) : undefined}
                className={cn((onPickProduct || (onPickSymbol && sym)) && "cursor-pointer")}
                title={onPickProduct ? `调出 ${String(r.product_alias ?? r.product)} T 型报价` : undefined}
              >
                <td className="name text-slate-200">{String(r.product_alias ?? r.product)}</td>
                <td className="num text-slate-300">{iv !== null ? iv.toFixed(2) : <span className="nil">-</span>}</td>
                <td className="num">
                  {ivp !== null ? (
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-slate-800/80">
                        <span
                          className={cn(
                            "absolute inset-y-0 left-0 rounded-full",
                            ivp >= 90 ? "bg-red-500/80" : ivp <= 10 ? "bg-emerald-500/80" : "bg-amber-500/70",
                          )}
                          style={{ width: `${Math.max(0, Math.min(100, ivp))}%` }}
                        />
                      </span>
                      <span
                        className={cn(
                          "tabular-nums",
                          ivp >= 90 ? "text-red-400" : ivp <= 10 ? "text-emerald-400" : "text-slate-300",
                          extreme && "font-bold",
                        )}
                      >
                        {ivp.toFixed(1)}
                      </span>
                    </span>
                  ) : <span className="nil">-</span>}
                </td>
                <td className={cn("num tabular-nums", carry !== null && carry > 0 ? "text-red-400" : carry !== null && carry < 0 ? "text-emerald-400" : "text-slate-300")}>
                  {carry !== null ? carry.toFixed(1) : <span className="nil">-</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
