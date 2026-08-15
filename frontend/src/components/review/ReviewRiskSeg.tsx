import { useState } from "react";
import { ChipGroup, Chip } from "@/components/ui/SectionHeader";
import { LimitLadderView } from "@/components/review/LimitLadderView";
import type { ShortTermEmotion } from "@/lib/api";

type RiskTab = "up" | "down";

interface Props {
  emotion: ShortTermEmotion | null;
  emoDone: boolean;
}

export function ReviewRiskSeg({ emotion, emoDone }: Props) {
  const [tab, setTab] = useState<RiskTab>("up");
  const count = tab === "up" ? emotion?.zt_count : emotion?.dt_count;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-1 py-1">
        <ChipGroup>
          {([
            ["up", "涨停梯队"],
            ["down", "跌停梯队"],
          ] as const).map(([k, label]) => (
            <Chip key={k} active={tab === k} onClick={() => setTab(k)}>{label}</Chip>
          ))}
        </ChipGroup>
        <span className="ml-auto text-[10px] text-slate-500">
          {count != null ? `${count} 只` : (emoDone ? "暂无" : "…")}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <LimitLadderView emotion={emotion} emoDone={emoDone} side={tab} />
      </div>
    </div>
  );
}
