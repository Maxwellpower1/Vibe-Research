import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, CandlestickChart } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { DailyReview } from "@/pages/DailyReview";
import { AShareLightChart } from "@/pages/AShareLightChart";
import { cn } from "@/lib/utils";

type Tab = "review" | "chart";

const TABS: { key: Tab; label: string; desc: string; icon: typeof Activity }[] = [
  { key: "review", label: "每日复盘", desc: "盘面 · 情绪 · 资金", icon: Activity },
  { key: "chart", label: "轻量图表", desc: "K线 · 估值 · 公告", icon: CandlestickChart },
];

function parseTab(raw: string | null): Tab {
  // Legacy tab=stock → chart (个股详情已并入轻量图表)
  if (raw === "chart" || raw === "stock") return "chart";
  return "review";
}

export function AShare() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => parseTab(params.get("tab")));

  // Sync tab <- URL (deep links from 复盘榜单 / 旧 /stock-data 跳转)
  useEffect(() => {
    const t = parseTab(params.get("tab"));
    setTab(t);
    // Normalize legacy ?tab=stock → ?tab=chart (keep code)
    if (params.get("tab") === "stock") {
      const p = new URLSearchParams(params);
      p.set("tab", "chart");
      setParams(p, { replace: true });
    }
  }, [params, setParams]);

  const switchTab = (next: Tab) => {
    setTab(next);
    const p = new URLSearchParams(params);
    if (next === "review") {
      p.delete("tab");
      p.delete("code");
    } else {
      p.set("tab", next);
    }
    setParams(p, { replace: true });
  };

  return (
    <div>
      <PageHeader title="A股" />

      <div className="mb-6 grid grid-cols-2 gap-1.5 rounded-2xl border border-border/60 bg-muted/15 p-1.5">
        {TABS.map(({ key, label, desc, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => switchTab(key)}
              className={cn(
                "group relative flex flex-col items-center gap-0.5 rounded-xl px-2 py-2.5 text-center transition-all sm:flex-row sm:items-center sm:gap-3 sm:px-3 sm:text-left",
                active
                  ? "bg-primary/15 text-primary shadow-glow"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                  active ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground group-hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm font-medium", active && "text-primary")}>{label}</span>
                <span className="hidden text-[11px] text-muted-foreground/60 sm:block">{desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      {tab === "review" && <DailyReview embedded />}
      {tab === "chart" && <AShareLightChart />}

      <Disclaimer />
    </div>
  );
}
