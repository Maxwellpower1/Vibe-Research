import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, CandlestickChart, FileText, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { SegmentNav } from "@/components/ui/SegmentNav";
import { PageFallback } from "@/components/ui/PageFallback";
import type { AShareChartSeg } from "@/pages/AShareLightChart";

const DailyReview = lazy(() =>
  import("@/pages/DailyReview").then((m) => ({ default: m.DailyReview })),
);
const AShareLightChart = lazy(() =>
  import("@/pages/AShareLightChart").then((m) => ({ default: m.AShareLightChart })),
);

type Tab = "review" | AShareChartSeg;

const TABS: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: "review", label: "每日复盘", icon: Activity },
  { key: "kline", label: "K线", icon: CandlestickChart },
  { key: "detail", label: "详情", icon: Search },
  { key: "feed", label: "公告", icon: FileText },
];

function parseTab(raw: string | null): Tab {
  // Legacy: chart / stock → kline (旧「轻量图表」大 Tab)
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
    // Normalize legacy ?tab=chart|stock → ?tab=kline
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
      // keep code so coming back to K线/详情仍可用
    } else {
      p.set("tab", next);
    }
    setParams(p, { replace: true });
  };

  const chartOpen = tab === "kline" || tab === "detail" || tab === "feed";

  return (
    <div>
      <PageHeader title="A股" />

      <SegmentNav
        sticky
        value={tab}
        onChange={(k) => switchTab(k as Tab)}
        items={TABS.map(({ key, label, icon: Icon }) => ({
          key,
          label,
          icon: <Icon className="h-3.5 w-3.5" />,
        }))}
      />

      {tab === "review" && (
        <Suspense fallback={<PageFallback />}>
          <DailyReview embedded />
        </Suspense>
      )}
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
