import { useState } from "react";
import { QuoteLine, klineHref } from "@/components/cockpit/QuoteLine";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";

const POLL_MS = 20_000;

type Tab = "hot" | "up" | "down";
const TABS: { key: Tab; label: string; sort: "amount" | "changepercent"; asc: 0 | 1 }[] = [
  { key: "hot", label: "热门股", sort: "amount", asc: 0 },
  { key: "up", label: "涨幅榜", sort: "changepercent", asc: 0 },
  { key: "down", label: "跌幅榜", sort: "changepercent", asc: 1 },
];

/** A-share rank with turnover amount on every row. */
export function StockRankPanel() {
  const [tab, setTab] = useState<Tab>("hot");
  const conf = TABS.find((t) => t.key === tab)!;
  const { data, error } = usePolling(
    () => api.stockRank(conf.sort, conf.asc, 30),
    POLL_MS,
    [tab],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-700/40 px-1.5 py-1">
        <ChipGroup>
          {TABS.map((t) => (
            <Chip key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</Chip>
          ))}
        </ChipGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <div className="flex items-center justify-between px-1.5 py-0.5 text-[10px] text-slate-600">
          <span># 名称</span>
          <span>成交额 · 现价</span>
        </div>
        {(data ?? []).map((s, i) => (
          <QuoteLine
            key={s.symbol || s.code}
            name={s.name}
            price={s.price}
            pct={s.pct}
            amount={s.amount}
            rank={i + 1}
            href={klineHref(s.code)}
          />
        ))}
        {!data && (
          <p className="py-6 text-center text-[11px] text-slate-600">
            {error ? "榜单源未接通, 自动重试中" : "加载中…"}
          </p>
        )}
      </div>
    </div>
  );
}
