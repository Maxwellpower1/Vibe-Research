import { CockpitLayout, type CockpitRow } from "@/components/cockpit/CockpitLayout";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { FinProvider, useFin } from "@/components/fin/FinContext";
import { FinCalendarPanel } from "@/components/fin/FinCalendarPanel";
import { FinForecastPanel } from "@/components/fin/FinForecastPanel";
import { FinIndustryPanel } from "@/components/fin/FinIndustryPanel";
import { FinStockRankPanel } from "@/components/fin/FinStockRankPanel";
import { FinCompanyPanel } from "@/components/fin/FinCompanyPanel";
import { FinTrendPanel } from "@/components/fin/FinTrendPanel";
import { FinPeerPanel } from "@/components/fin/FinPeerPanel";

function FinBody() {
  const { period, setPeriod, periods } = useFin();
  const rows: CockpitRow[] = [
    {
      defaultH: 0.40,
      panels: [
        { id: "cal", title: "财报日历", defaultW: 0.22, mobileH: "h-[300px]", body: <FinCalendarPanel /> },
        { id: "fc", title: "业绩预告", defaultW: 0.28, mobileH: "h-[340px]", body: <FinForecastPanel /> },
        { id: "ind", title: "行业盈利榜", defaultW: 0.25, mobileH: "h-[360px]", body: <FinIndustryPanel /> },
        { id: "rk", title: "个股盈利榜", defaultW: 0.25, mobileH: "h-[400px]", body: <FinStockRankPanel /> },
      ],
    },
    {
      defaultH: 0.60,
      panels: [
        { id: "co", title: "公司财报", defaultW: 0.28, mobileH: "h-[380px]", body: <FinCompanyPanel /> },
        { id: "tr", title: "公司趋势", defaultW: 0.40, mobileH: "h-[360px]", body: <FinTrendPanel /> },
        { id: "pr", title: "同业对比", defaultW: 0.32, mobileH: "h-[360px]", body: <FinPeerPanel /> },
      ],
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background lg:h-full lg:overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-2 py-0.5">
        <p className="hidden truncate text-[10px] text-slate-500 sm:block">
          披露日历 · 预告 · 盈利榜 · 估值/公告/研报 · 美股日历
        </p>
        <div className="ml-auto">
          <ChipGroup>
            {periods.map((p) => (
              <Chip key={p.value} active={period === p.value} onClick={() => setPeriod(p.value)}>
                {p.label}
              </Chip>
            ))}
          </ChipGroup>
        </div>
      </div>
      <CockpitLayout rows={rows} />
    </div>
  );
}

export function FinWindow() {
  return (
    <FinProvider>
      <FinBody />
    </FinProvider>
  );
}
