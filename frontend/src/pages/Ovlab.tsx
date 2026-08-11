import { useState } from "react";
import { Activity, CandlestickChart, History, MessagesSquare, Search, Table2, Zap } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { cn } from "@/lib/utils";
import { MarketPanel } from "@/components/ovlab/MarketPanel";
import { DetailPanel } from "@/components/ovlab/DetailPanel";
import { FlowAlertPanel, FlowDataPanel } from "@/components/ovlab/FlowPanels";
import { WarehousePanel } from "@/components/ovlab/WarehousePanel";
import { LightChartPanel } from "@/components/ovlab/LightChartPanel";
import { VolSurfacePanel } from "@/components/ovlab/VolSurfacePanel";
import { PositionRankPanel } from "@/components/ovlab/PositionRankPanel";
import { FinoViewsPanel } from "@/components/ovlab/FinoViewsPanel";

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

      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/20 p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors",
              tab === key
                ? "bg-primary/15 font-medium text-primary ring-1 ring-primary/25"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "market" && <MarketPanel onPickSymbol={(s) => { setChartSymbol(s); setTab("chart"); }} />}
      {tab === "detail" && <DetailPanel />}
      {tab === "flow-alert" && <FlowAlertPanel />}
      {tab === "flow-data" && <FlowDataPanel />}
      {tab === "warehouse" && <WarehousePanel />}
      {tab === "chart" && <LightChartPanel initialSymbol={chartSymbol} />}
      {tab === "vol-surface" && <VolSurfacePanel />}
      {tab === "position" && <PositionRankPanel />}
      {tab === "fino" && <FinoViewsPanel />}

      <Disclaimer />
    </div>
  );
}


