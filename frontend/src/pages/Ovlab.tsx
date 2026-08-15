import { lazy, Suspense, useState } from "react";
import { Activity, CandlestickChart, History, MessagesSquare, Search, Table2, Zap } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { PageFallback } from "@/components/ui/PageFallback";
import { cn } from "@/lib/utils";

const MarketPanel = lazy(() =>
  import("@/components/ovlab/MarketPanel").then((m) => ({ default: m.MarketPanel })),
);
const DetailPanel = lazy(() =>
  import("@/components/ovlab/DetailPanel").then((m) => ({ default: m.DetailPanel })),
);
const FlowAlertPanel = lazy(() =>
  import("@/components/ovlab/FlowPanels").then((m) => ({ default: m.FlowAlertPanel })),
);
const FlowDataPanel = lazy(() =>
  import("@/components/ovlab/FlowPanels").then((m) => ({ default: m.FlowDataPanel })),
);
const WarehousePanel = lazy(() =>
  import("@/components/ovlab/WarehousePanel").then((m) => ({ default: m.WarehousePanel })),
);
const LightChartPanel = lazy(() =>
  import("@/components/ovlab/LightChartPanel").then((m) => ({ default: m.LightChartPanel })),
);
const VolSurfacePanel = lazy(() =>
  import("@/components/ovlab/VolSurfacePanel").then((m) => ({ default: m.VolSurfacePanel })),
);
const PositionRankPanel = lazy(() =>
  import("@/components/ovlab/PositionRankPanel").then((m) => ({ default: m.PositionRankPanel })),
);
const FinoViewsPanel = lazy(() =>
  import("@/components/ovlab/FinoViewsPanel").then((m) => ({ default: m.FinoViewsPanel })),
);

type Tab = "market" | "detail" | "flow-alert" | "flow-data" | "warehouse" | "chart" | "vol-surface" | "position" | "fino";

const TABS: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: "market", label: "市场概览", icon: Activity },
  { key: "chart", label: "轻量图表", icon: CandlestickChart },
  { key: "detail", label: "单品种详情", icon: Search },
  { key: "vol-surface", label: "T型报价", icon: Table2 },
  { key: "flow-alert", label: "异动榜", icon: Zap },
  { key: "flow-data", label: "异动资金流", icon: Zap },
  { key: "warehouse", label: "持仓历史", icon: History },
  { key: "position", label: "持仓排名", icon: Table2 },
  { key: "fino", label: "机构观点", icon: MessagesSquare },
];

export function Ovlab() {
  const [tab, setTab] = useState<Tab>("market");
  const [chartSymbol, setChartSymbol] = useState("");

  return (
    <div>
      <PageHeader
        title="期权/期货"
        subtitle="OpenVlab 公开数据 · 市场概览 / 详情 / 期权&期货期限结构 / 异动榜 / 持仓历史 · 只客观呈现, 不推荐不预测"
      />

      <div className="mb-3 flex flex-wrap gap-0.5 rounded-md border border-border bg-card/90 p-0.5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]",
              tab === key
                ? "bg-cyan-500/15 font-medium text-cyan-300"
                : "text-slate-500 hover:text-slate-200",
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      <Suspense fallback={<PageFallback />}>
        {tab === "market" && <MarketPanel onPickSymbol={(s) => { setChartSymbol(s); setTab("chart"); }} />}
        {tab === "detail" && <DetailPanel />}
        {tab === "flow-alert" && <FlowAlertPanel />}
        {tab === "flow-data" && <FlowDataPanel />}
        {tab === "warehouse" && <WarehousePanel />}
        {tab === "chart" && <LightChartPanel initialSymbol={chartSymbol} />}
        {tab === "vol-surface" && <VolSurfacePanel />}
        {tab === "position" && <PositionRankPanel />}
        {tab === "fino" && <FinoViewsPanel />}
      </Suspense>

      <Disclaimer />
    </div>
  );
}
