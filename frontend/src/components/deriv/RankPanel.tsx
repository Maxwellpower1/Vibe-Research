import { useMemo } from "react";
import { api, type OvlabMarketRow } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import type { DerivData } from "@/hooks/useDerivData";
import { cn } from "@/lib/utils";
import { num, prevCloseOf, previewCode, toSparkMap, TrendPreviewCell } from "@/components/ovlab/shared";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { CellEmpty, CtnText, klineSym } from "./derivShared";

export type RankKey = "ctn" | "valphaT" | "atmv_1dchg";

const RANKS: { key: RankKey; label: string; pct?: boolean }[] = [
  { key: "ctn", label: "涨幅" },
  { key: "valphaT", label: "隐波涨速" },
  { key: "atmv_1dchg", label: "隐波日变" },
];

/** Header-right metric switch, same slot pattern as A-share RankTabBar. */
export function RankMetricBar({ metric, onMetric }: { metric: RankKey; onMetric: (k: RankKey) => void }) {
  return (
    <ChipGroup>
      {RANKS.map((r) => (
        <Chip key={r.key} active={metric === r.key} onClick={() => onMetric(r.key)}>{r.label}</Chip>
      ))}
    </ChipGroup>
  );
}

/** 涨跌榜: domestic rows ranked by ctn / valphaT / atmv_1dchg. */
export function RankPanel({ d, metric, onPickSymbol }: {
  d: DerivData;
  metric: RankKey;
  onPickSymbol?: (sym: string) => void;
}) {
  const key = metric;

  const ranked = useMemo(() => {
    return (d.rows ?? [])
      .map((r) => ({ r, v: num(r[key]) }))
      .filter((x): x is { r: OvlabMarketRow; v: number } => x.v !== null)
      .sort((a, b) => b.v - a.v);
  }, [d.rows, key]);

  // d.sparks 只覆盖目录码; 上榜的非目录品种 (LPG/燃油/乙二醇等) 按可见码补拉
  const missingKey = useMemo(() => {
    const visible = [...ranked.slice(0, 6), ...ranked.slice(-6)];
    const codes = new Set<string>();
    for (const x of visible) {
      const c = previewCode(x.r);
      if (c && !d.sparks[c]) codes.add(c);
    }
    return [...codes].sort().join("|");
  }, [ranked, d.sparks]);

  const extraPoll = usePolling(
    () => api.ovlabPriceVolatilitySeries(missingKey.split("|").filter(Boolean)),
    300_000,
    [missingKey],
    missingKey.length > 0,
  );
  const extraSparks = useMemo(() => toSparkMap(extraPoll.data), [extraPoll.data]);
  const extraLoading = missingKey.length > 0 && extraPoll.data === null;

  if (!d.rows) return <CellEmpty text={d.marketError ? "未取到" : "更新中…"} />;
  if (ranked.length === 0) return <CellEmpty />;

  const top = ranked.slice(0, 6);
  const bottom = ranked.slice(-6).reverse();

  const line = ({ r, v }: { r: OvlabMarketRow; v: number }) => {
    const sym = klineSym(r);
    const pc = previewCode(r);
    return (
      <button
        key={`${r.product}-${r.exp ?? ""}`}
        type="button"
        onClick={sym && onPickSymbol ? () => onPickSymbol(sym) : undefined}
        className="flex w-full items-center gap-2 rounded px-1.5 py-[2.5px] text-left hover:bg-slate-800/40"
      >
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{String(r.product_alias ?? r.product)}</span>
        {key === "ctn"
          ? <CtnText value={v} boldOver={3} />
          : (
            <span className={cn("text-[11px] tabular-nums", v > 0 ? "text-red-400" : v < 0 ? "text-emerald-400" : "text-slate-400")}>
              {v > 0 ? "+" : ""}{v.toFixed(2)}
            </span>
          )}
        <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <TrendPreviewCell
            series={d.sparks[pc] ?? extraSparks[pc]}
            loading={d.sparkLoading || extraLoading}
            base={prevCloseOf(r)}
          />
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-x-2 overflow-auto px-1 py-1">
        <div>
          <div className="px-1 pb-0.5 text-[10px] text-slate-500">领涨</div>
          {top.map(line)}
        </div>
        <div>
          <div className="px-1 pb-0.5 text-[10px] text-slate-500">领跌</div>
          {bottom.map(line)}
        </div>
      </div>
    </div>
  );
}
