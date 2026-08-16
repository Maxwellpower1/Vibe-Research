import { useState } from "react";
import { LimitLadderView } from "@/components/review/LimitLadderView";
import type { ShortTermEmotion } from "@/lib/api";

interface Props {
  emotion: ShortTermEmotion | null;
  emoDone: boolean;
}

export function ReviewRiskSeg({ emotion, emoDone }: Props) {
  const [side, setSide] = useState<"up" | "down">("up");
  return (
    <LimitLadderView
      emotion={emotion}
      emoDone={emoDone}
      side={side}
      onSide={setSide}
    />
  );
}
