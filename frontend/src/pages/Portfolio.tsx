import { lazy, Suspense, useEffect, useState } from "react";
import { Landmark, Waves } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { PageFallback } from "@/components/ui/PageFallback";
import { cn } from "@/lib/utils";

const StockPortfolio = lazy(() =>
  import("@/components/portfolio/StockPortfolio").then((m) => ({ default: m.StockPortfolio })),
);
const CtpPortfolio = lazy(() =>
  import("@/components/portfolio/CtpPortfolio").then((m) => ({ default: m.CtpPortfolio })),
);

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

      <div className="mb-3 flex flex-wrap gap-0.5 rounded-md border border-slate-700/50 bg-[#0c1320]/90 p-0.5">
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
        {tab === "stock" && <StockPortfolio />}
        {ctpVisited && (
          <div className={cn(tab !== "ctp" && "hidden")}>
            <CtpPortfolio />
          </div>
        )}
      </Suspense>

      <Disclaimer />
    </div>
  );
}
