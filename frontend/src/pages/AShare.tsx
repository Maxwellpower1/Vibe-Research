import { useState } from "react";
import { Activity, CandlestickChart } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { DailyReview } from "@/pages/DailyReview";
import { AShareLightChart } from "@/pages/AShareLightChart";
import { cn } from "@/lib/utils";

type Tab = "review" | "chart";

const TABS: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: "review", label: "每日复盘", icon: Activity },
  { key: "chart", label: "轻量图表", icon: CandlestickChart },
];

export function AShare() {
  const [tab, setTab] = useState<Tab>("review");

  return (
    <div>
      <PageHeader
        title="A股"
        subtitle="A 股投研看板 · 每日复盘 / 轻量图表 · 只客观呈现, 不推荐不预测"
      />

      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/20 p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors",
              tab === key
                ? "bg-primary/15 font-medium text-primary shadow-glow"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "review" && <DailyReview embedded />}
      {tab === "chart" && <AShareLightChart />}

      <Disclaimer />
    </div>
  );
}
