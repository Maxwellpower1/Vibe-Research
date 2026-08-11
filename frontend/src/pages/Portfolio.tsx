import { useEffect, useState } from "react";
import { Landmark, Waves } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { cn } from "@/lib/utils";
import { StockPortfolio } from "@/components/portfolio/StockPortfolio";
import { CtpPortfolio } from "@/components/portfolio/CtpPortfolio";

type Tab = "stock" | "ctp";

const TABS: { key: Tab; label: string; icon: typeof Landmark }[] = [
  { key: "ctp", label: "期货账户", icon: Waves },
  { key: "stock", label: "A股持仓", icon: Landmark },
];

export function Portfolio() {
  const [tab, setTab] = useState<Tab>("ctp");
  // Keep CTP mounted after first visit so tab switch does not wipe local cache.
  const [ctpVisited, setCtpVisited] = useState(true);
  useEffect(() => {
    if (tab === "ctp") setCtpVisited(true);
  }, [tab]);

  return (
    <div>
      <PageHeader
        title="我的持仓"
        subtitle="CTP 期货只读查询 · A股本地录入 · 不荐股不下单"
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
                ? "bg-primary/15 font-medium text-primary ring-1 ring-primary/25"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "stock" && <StockPortfolio />}
      {ctpVisited && (
        <div className={cn(tab !== "ctp" && "hidden")}>
          <CtpPortfolio />
        </div>
      )}

      <Disclaimer />
    </div>
  );
}
