import { QuoteStockRow } from "@/components/cockpit/QuoteStockRow";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";

const POLL_MS = 20_000;

export type RankTab = "hot" | "up" | "down";
export const RANK_TABS: { key: RankTab; label: string; sort: "amount" | "changepercent"; asc: 0 | 1 }[] = [
  { key: "hot", label: "热门股", sort: "amount", asc: 0 },
  { key: "up", label: "涨幅榜", sort: "changepercent", asc: 0 },
  { key: "down", label: "跌幅榜", sort: "changepercent", asc: 1 },
];

export function RankTabBar({
  tab,
  onTab,
}: {
  tab: RankTab;
  onTab: (t: RankTab) => void;
}) {
  return (
    <ChipGroup className="border-0 bg-transparent p-0">
      {RANK_TABS.map((t) => (
        <Chip key={t.key} active={tab === t.key} accent="amber" onClick={() => onTab(t.key)}>
          {t.label}
        </Chip>
      ))}
    </ChipGroup>
  );
}

/** A-share rank: spark + main-net / ratio + amount + price. */
export function StockRankPanel({ tab }: { tab: RankTab }) {
  const conf = RANK_TABS.find((t) => t.key === tab)!;
  const { data, error } = usePolling(
    () => api.stockRank(conf.sort, conf.asc, 30),
    POLL_MS,
    [tab],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-2 py-1 text-[10px] text-slate-500">
        <span># 名称</span>
        <span>主力资金 · 成交额 · 现价</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 pt-0">
        {(data ?? []).map((s, i) => (
          <QuoteStockRow
            key={s.symbol || s.code}
            code={s.code}
            name={s.name}
            price={s.price}
            pct={s.pct}
            amount={s.amount}
            turnover={s.turnover}
            mainNet={s.main_net}
            mainPct={s.main_pct}
            rank={i + 1}
          />
        ))}
        {!data && (
          <p className="py-6 text-center text-[11px] text-slate-600">
            {error ? "榜单源未接通, 自动重试中" : "榜单加载中…"}
          </p>
        )}
        {data && data.length === 0 && (
          <p className="py-6 text-center text-[11px] text-slate-600">暂无榜单</p>
        )}
      </div>
    </div>
  );
}
