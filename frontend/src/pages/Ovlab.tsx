import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageFallback } from "@/components/ui/PageFallback";

const DerivCockpit = lazy(() =>
  import("@/pages/DerivCockpit").then((m) => ({ default: m.DerivCockpit })),
);
const DerivLightChart = lazy(() =>
  import("@/components/deriv/DerivLightChart").then((m) => ({ default: m.DerivLightChart })),
);

type Tab = "review" | "kline";

function parseTab(raw: string | null): Tab {
  return raw === "kline" ? "kline" : "review";
}

export function Ovlab() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => parseTab(params.get("tab")));

  useEffect(() => {
    setTab(parseTab(params.get("tab")));
  }, [params]);

  const goKline = (symbol: string) => {
    const p = new URLSearchParams(params);
    p.set("tab", "kline");
    if (symbol) p.set("symbol", symbol);
    setParams(p, { replace: true });
  };

  return (
    <Suspense fallback={<PageFallback />}>
      {tab === "kline" ? <DerivLightChart /> : <DerivCockpit onPickSymbol={goKline} />}
    </Suspense>
  );
}
