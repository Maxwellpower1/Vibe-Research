import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { PageFallback } from "@/components/ui/PageFallback";
import type { AShareChartSeg } from "@/pages/AShareLightChart";

const DailyReview = lazy(() =>
  import("@/pages/DailyReview").then((m) => ({ default: m.DailyReview })),
);
const AShareLightChart = lazy(() =>
  import("@/pages/AShareLightChart").then((m) => ({ default: m.AShareLightChart })),
);

type Tab = "review" | AShareChartSeg;

function parseTab(raw: string | null): Tab {
  if (raw === "kline" || raw === "chart" || raw === "stock") return "kline";
  if (raw === "detail" || raw === "feed") return raw;
  return "review";
}

export function AShare() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => parseTab(params.get("tab")));

  useEffect(() => {
    const t = parseTab(params.get("tab"));
    setTab(t);
    const raw = params.get("tab");
    if (raw === "chart" || raw === "stock") {
      const p = new URLSearchParams(params);
      p.set("tab", "kline");
      setParams(p, { replace: true });
    }
  }, [params, setParams]);

  const switchTab = (next: Tab) => {
    setTab(next);
    const p = new URLSearchParams(params);
    if (next === "review") {
      p.delete("tab");
    } else {
      p.set("tab", next);
    }
    setParams(p, { replace: true });
  };

  const chartOpen = tab === "kline" || tab === "detail" || tab === "feed";

  if (tab === "review") {
    return (
      <Suspense fallback={<PageFallback />}>
        <DailyReview embedded />
      </Suspense>
    );
  }

  return (
    <div>
      {chartOpen && (
        <Suspense fallback={<PageFallback />}>
          <AShareLightChart
            seg={tab}
            onSegChange={(s) => switchTab(s)}
          />
        </Suspense>
      )}
      <Disclaimer />
    </div>
  );
}
