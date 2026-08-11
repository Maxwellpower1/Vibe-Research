import type { CtpSettlementRangeData } from "@/lib/api";

export type SettleChartKey = "equity" | "nav" | "cum_return" | "cum_pnl_wan";
export const SETTLE_CHARTS: { key: SettleChartKey; label: string; unit: string }[] = [
  { key: "equity", label: "市值权益", unit: "万" },
  { key: "nav", label: "净值曲线", unit: "" },
  { key: "cum_return", label: "累计收益率", unit: "%" },
  { key: "cum_pnl_wan", label: "累计收益", unit: "万" },
];
export const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
export type CalMetric = "pnl" | "income" | "commission";
export const CAL_METRICS: { key: CalMetric; label: string }[] = [
  { key: "pnl", label: "盈亏" },
  { key: "income", label: "收益" },
  { key: "commission", label: "手续费" },
];

export type CalDayHit = {
  date: string;
  trading_day: string;
  pnl: number;
  income: number;
  return: number;
  commission: number;
  equity?: number;
};

/** Build calendar rows from perf (preferred) with series commission fallback. */
export function buildCalDays(range: CtpSettlementRangeData): CalDayHit[] {
  const seriesComm = Object.fromEntries(
    (range.series || [])
      .filter((p) => p.status === "ok")
      .map((p) => [p.date, Number(p.commission ?? 0)]),
  );
  const perf = range.analytics?.perf;
  if (perf?.length) {
    return perf.map((p) => {
      const commission = Number(
        p.commission != null && !Number.isNaN(Number(p.commission))
          ? p.commission
          : (seriesComm[p.date] ?? 0),
      );
      const pnl = Number(p.daily_pnl || 0);
      const income = p.daily_income != null
        ? Number(p.daily_income)
        : Math.round((pnl - commission) * 100) / 100;
      return {
        date: p.date,
        trading_day: p.trading_day,
        pnl,
        income,
        return: Number(p.daily_return || 0),
        commission,
        equity: p.equity,
      };
    });
  }
  return (range.analytics?.calendar_daily || []).map((d) => {
    const commission = Number(
      d.commission != null && !Number.isNaN(Number(d.commission))
        ? d.commission
        : (seriesComm[d.date] ?? 0),
    );
    const pnl = Number(d.pnl || 0);
    const income = d.income != null
      ? Number(d.income)
      : Math.round((pnl - commission) * 100) / 100;
    return {
      date: d.date,
      trading_day: d.trading_day,
      pnl,
      income,
      return: Number(d.return || 0),
      commission,
      equity: d.equity,
    };
  });
}
/** CTP wide tables: rely on .data-table; mark numeric headers via ctpTh. */
export const CTP_NUM_HEADERS = new Set([
  "总仓", "今/昨", "开仓成本/手", "昨结", "结算价", "占用保证金", "持仓盈亏", "平仓盈亏",
  "开/平量", "冻结(多/空)", "手续费", "开仓价", "剩余", "已平", "保证金",
  "平仓盈亏(逐笔)", "持仓盈亏(逐笔)", "平仓盈亏(逐日)", "报单价", "止损价",
  "成交/剩余/总量", "成交价", "手数", "成交额",
  "市值权益", "日盈亏", "日收益", "净值", "累计收益(万)", "出入金",
  "市值权益(万)", "日盈亏(万)",
]);
export const ctpTh = (h: string) => (CTP_NUM_HEADERS.has(h) ? "num" : "");
/** Legacy cell class placeholder kept for CTP tables that still compose cn(td, ...). */
export const td = "";

