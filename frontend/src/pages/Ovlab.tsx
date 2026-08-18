import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageFallback } from "@/components/ui/PageFallback";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";

const DerivCockpit = lazy(() =>
  import("@/pages/DerivCockpit").then((m) => ({ default: m.DerivCockpit })),
);
const DerivLightChart = lazy(() =>
  import("@/components/deriv/DerivLightChart").then((m) => ({ default: m.DerivLightChart })),
);
const MarketPanel = lazy(() =>
  import("@/components/ovlab/MarketPanel").then((m) => ({ default: m.MarketPanel })),
);
const DetailPanel = lazy(() =>
  import("@/components/ovlab/DetailPanel").then((m) => ({ default: m.DetailPanel })),
);
const WarehousePanel = lazy(() =>
  import("@/components/ovlab/WarehousePanel").then((m) => ({ default: m.WarehousePanel })),
);
const PositionRankPanel = lazy(() =>
  import("@/components/ovlab/PositionRankPanel").then((m) => ({ default: m.PositionRankPanel })),
);
const FinoViewsPanel = lazy(() =>
  import("@/components/ovlab/FinoViewsPanel").then((m) => ({ default: m.FinoViewsPanel })),
);
const VolSurfacePanel = lazy(() =>
  import("@/components/ovlab/VolSurfacePanel").then((m) => ({ default: m.VolSurfacePanel })),
);
const FlowAlertPanel = lazy(() =>
  import("@/components/ovlab/FlowPanels").then((m) => ({ default: m.FlowAlertPanel })),
);
const FlowDataPanel = lazy(() =>
  import("@/components/ovlab/FlowPanels").then((m) => ({ default: m.FlowDataPanel })),
);

type Tab = "review" | "kline" | "detail" | "quote" | "flow";
type DetailSeg = "market" | "detail" | "warehouse" | "position" | "fino";
type FlowSeg = "alert" | "data";

function parseTab(raw: string | null): Tab {
  if (raw === "kline" || raw === "detail" || raw === "quote" || raw === "flow") return raw;
  return "review";
}

const DETAIL_SEGS: DetailSeg[] = ["market", "detail", "warehouse", "position", "fino"];

function parseDetailSeg(raw: string | null): DetailSeg {
  return DETAIL_SEGS.includes(raw as DetailSeg) ? (raw as DetailSeg) : "market";
}

export function Ovlab() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => parseTab(params.get("tab")));
  const [detailSeg, setDetailSeg] = useState<DetailSeg>(() => parseDetailSeg(params.get("seg")));
  const [flowSeg, setFlowSeg] = useState<FlowSeg>("alert");

  useEffect(() => {
    setTab(parseTab(params.get("tab")));
    setDetailSeg(parseDetailSeg(params.get("seg")));
  }, [params]);

  const goKline = (symbol: string) => {
    const p = new URLSearchParams(params);
    p.set("tab", "kline");
    if (symbol) p.set("symbol", symbol);
    setParams(p, { replace: true });
  };

  if (tab === "review") {
    return (
      <Suspense fallback={<PageFallback />}>
        <DerivCockpit onPickSymbol={goKline} />
      </Suspense>
    );
  }

  return (
    <div>
      {tab === "detail" && (
        <div className="mb-3 px-1 pt-1">
          <ChipGroup>
            {([
              ["market", "全市场"],
              ["detail", "单品种"],
              ["warehouse", "持仓历史"],
              ["position", "持仓排名"],
              ["fino", "机构观点"],
            ] as const).map(([k, label]) => (
              <Chip key={k} active={detailSeg === k} onClick={() => setDetailSeg(k)}>{label}</Chip>
            ))}
          </ChipGroup>
        </div>
      )}
      {tab === "flow" && (
        <div className="mb-3 px-1 pt-1">
          <ChipGroup>
            {([
              ["alert", "异动榜"],
              ["data", "异动资金流"],
            ] as const).map(([k, label]) => (
              <Chip key={k} active={flowSeg === k} onClick={() => setFlowSeg(k)}>{label}</Chip>
            ))}
          </ChipGroup>
        </div>
      )}
      <Suspense fallback={<PageFallback />}>
        {tab === "kline" && <DerivLightChart />}
        {tab === "quote" && <VolSurfacePanel />}
        {tab === "detail" && detailSeg === "market" && (
          <MarketPanel onPickSymbol={goKline} />
        )}
        {tab === "detail" && detailSeg === "detail" && <DetailPanel />}
        {tab === "detail" && detailSeg === "warehouse" && <WarehousePanel />}
        {tab === "detail" && detailSeg === "position" && <PositionRankPanel />}
        {tab === "detail" && detailSeg === "fino" && <FinoViewsPanel />}
        {tab === "flow" && flowSeg === "alert" && <FlowAlertPanel />}
        {tab === "flow" && flowSeg === "data" && <FlowDataPanel />}
      </Suspense>
    </div>
  );
}
