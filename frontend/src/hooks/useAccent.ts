import { useEffect, useState } from "react";
import { ACCENTS, applyAccent, readAccent, type AccentId } from "@/lib/accent";

export function useAccent() {
  const [accent, setAccentState] = useState<AccentId>(() => readAccent());

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  return {
    accent,
    accents: ACCENTS,
    setAccent: (id: AccentId) => setAccentState(id),
  };
}
