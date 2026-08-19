import { cn } from "@/lib/utils";
import { pctTone } from "@/components/review/format";

export function PctChip({ pct }: { pct: number | null | undefined }) {
  if (pct == null || !Number.isFinite(pct)) return <span className="pct-chip flat">—</span>;
  return (
    <span className={cn("pct-chip", pctTone(pct))}>
      {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}
