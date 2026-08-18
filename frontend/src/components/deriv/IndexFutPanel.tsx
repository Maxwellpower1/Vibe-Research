import type { DerivData } from "@/hooks/useDerivData";
import { cn } from "@/lib/utils";
import { num, prevCloseOf, previewCode, TrendSparkSvg } from "@/components/ovlab/shared";
import { CellEmpty, contractCode, CtnText, klineSym, NightMoon } from "./derivShared";

const COLS = [
  { label: "品种", cls: "w-[3.8rem] text-left" },
  { label: "最新", cls: "w-[3.8rem] text-right" },
  { label: "涨跌", cls: "w-[3.4rem] text-right" },
  { label: "IVP", cls: "w-[2rem] text-right" },
] as const;

/** 股指衍生: index futures options + ETF options. Header + rows, main-contract code under label, spark fills rest. */
export function IndexFutPanel({ d, nightOnly = false, onPickSymbol }: {
  d: DerivData;
  nightOnly?: boolean;
  onPickSymbol?: (sym: string) => void;
}) {
  const rows = d.catalogRows.filter((c) =>
    c.def.group !== "commodity" && (!nightOnly || Number(c.row.has_night_trading) === 1),
  );
  if (!d.rows) return <CellEmpty text={d.marketError ? "未取到" : "更新中…"} />;
  if (rows.length === 0) return <CellEmpty text={nightOnly ? "无夜盘品种" : undefined} />;

  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[9px] text-slate-600">
        <span className="h-3.5 w-3.5 shrink-0" />
        {COLS.map((c) => (
          <span key={c.label} className={cn("shrink-0", c.cls)}>{c.label}</span>
        ))}
        <span className="min-w-0 flex-1">分时</span>
      </div>
      <div className="divide-y divide-slate-800/60">
        {rows.map(({ def, row }) => {
          const sym = klineSym(row);
          const code = contractCode(row);
          const spark = d.sparks[previewCode(row)];
          const price = num(row.price);
          const ivp = num(row.atmv_percentile);
          const ivpTone = ivp !== null && ivp >= 90 ? "text-red-400" : ivp !== null && ivp <= 10 ? "text-emerald-400" : "text-slate-500";
          return (
            <button
              key={def.product}
              type="button"
              onClick={sym && onPickSymbol ? () => onPickSymbol(sym) : undefined}
              className={cn(
                "flex w-full items-center gap-1.5 px-2 py-[3px] text-left transition-colors",
                onPickSymbol && sym && "hover:bg-slate-800/40",
              )}
              title={sym ? `看 ${sym} K线` : undefined}
            >
              <NightMoon show={Number(row.has_night_trading) === 1} />
              <span className="w-[3.8rem] shrink-0 leading-tight">
                <span className="block truncate text-[11px] font-medium text-slate-200">{def.label}</span>
                <span className="block truncate font-mono text-[9px] text-cyan-500/70">{code || "-"}</span>
              </span>
              <span className="w-[3.8rem] shrink-0 text-right text-[11px] tabular-nums text-slate-300">
                {price !== null ? Number(price.toFixed(2)).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "-"}
              </span>
              <span className="w-[3.4rem] shrink-0 text-right text-[11px]">
                <CtnText value={row.ctn} boldOver={3} />
              </span>
              <span className={cn("w-[2rem] shrink-0 text-right text-[10px] tabular-nums", ivpTone)} title="隐波百分位">
                {ivp !== null ? ivp.toFixed(0) : "-"}
              </span>
              <span className="flex h-[22px] min-w-0 flex-1 items-center">
                <TrendSparkSvg
                  prices={spark?.prices ?? []}
                  volatilities={spark?.volatilities ?? []}
                  base={prevCloseOf(row)}
                  width={72}
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
