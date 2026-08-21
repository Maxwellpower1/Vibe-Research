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

export type LiveSettlePreview = {
  date: string;
  tradingDay: string;
  equity: number;
  dailyPnl: number;
  dailyIncome: number;
  dailyRet: number;
  commission: number;
  depositWithdraw: number;
  nav: number;
  cumIncome: number;
};

type LivePerfPt = {
  date: string;
  equity: number;
  nav: number;
  daily_return?: number;
  cum_income?: number;
  cum_pnl: number;
};

type SettleSummary = NonNullable<CtpSettlementRangeData["analytics"]>["summary"];
type SettleMonth = NonNullable<CtpSettlementRangeData["analytics"]>["monthly"][number];

/** Today's mark vs last settlement bill. Same formula as the settle chart live point. */
export function liveSettlePreview(opts: {
  equity: number | null | undefined;
  tradingDay?: string;
  deposit?: number;
  withdraw?: number;
  commission?: number;
  perf?: LivePerfPt[];
  fallbackDate: string;
}): LiveSettlePreview | null {
  const liveEq = opts.equity;
  if (liveEq == null || !Number.isFinite(Number(liveEq))) return null;
  const td = (opts.tradingDay || "").replace(/-/g, "");
  const date = /^\d{8}$/.test(td)
    ? `${td.slice(0, 4)}-${td.slice(4, 6)}-${td.slice(6, 8)}`
    : opts.fallbackDate;
  const perf = opts.perf || [];
  if (perf.some((p) => p.date === date)) return null;
  const last = perf.length ? perf[perf.length - 1] : null;
  if (!last || last.date === date) return null;
  const prevEq = Number(last.equity);
  if (!Number.isFinite(prevEq)) return null;
  const dw = Number(opts.deposit || 0) - Number(opts.withdraw || 0);
  const comm = Number(opts.commission || 0);
  const dailyPnl = Number(liveEq) - prevEq - dw;
  const dailyRet = prevEq ? dailyPnl / prevEq : 0;
  return {
    date,
    tradingDay: date.replace(/-/g, ""),
    equity: Number(liveEq),
    dailyPnl,
    dailyIncome: dailyPnl - comm,
    dailyRet,
    commission: comm,
    depositWithdraw: dw,
    nav: Number(last.nav) * (1 + dailyRet),
    cumIncome: Number(last.cum_income ?? last.cum_pnl) + (dailyPnl - comm),
  };
}

/** CAGR on calendar span, 365 natural days. */
export function annReturnNatural(
  nav: number,
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start || !end || !Number.isFinite(nav) || nav <= 0) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const span = Math.round((b - a) / 86_400_000);
  if (span <= 0) return null;
  return nav ** (365 / span) - 1;
}

/** Overlay today's mark on every settle summary field that can take an estimate. */
export function foldLiveSummary(
  s: SettleSummary,
  perf: LivePerfPt[] | undefined,
  live: LiveSettlePreview | null,
): SettleSummary {
  if (!live) return s;
  const hist = Math.max(0, s.days - 1);
  const n = hist + 1;
  const avg = (s.avg_daily_return * hist + live.dailyRet) / n;
  const rows = (perf || []).slice(1).map((p) => Number(p.daily_return || 0)).concat(live.dailyRet);
  let vol: number | null = null;
  let sharpe: number | null = null;
  if (rows.length >= 2) {
    const mean = rows.reduce((a, r) => a + r, 0) / rows.length;
    const std = Math.sqrt(rows.reduce((a, r) => a + (r - mean) ** 2, 0) / (rows.length - 1));
    vol = std;
    sharpe = std > 1e-12 ? (mean / std) * Math.sqrt(242) : null;
  }
  const peak = Math.max(0, ...(perf || []).map((p) => Number(p.nav) || 0), live.nav);
  const liveDd = peak > 0 ? live.nav / peak - 1 : 0;
  let win = s.win_days;
  let loss = s.loss_days;
  let flat = s.flat_days;
  if (live.dailyPnl > 1e-9) win += 1;
  else if (live.dailyPnl < -1e-9) loss += 1;
  else flat += 1;
  const decided = win + loss;
  const row = {
    date: live.date,
    trading_day: live.tradingDay,
    daily_pnl: live.dailyPnl,
    daily_return: live.dailyRet,
  };
  const totalPnl = s.total_pnl + live.dailyPnl;
  return {
    ...s,
    days: s.days + 1,
    end_date: live.date,
    end_equity: live.equity,
    total_pnl: totalPnl,
    total_pnl_wan: totalPnl / 10000,
    total_income: (s.total_income ?? s.total_pnl) + live.dailyIncome,
    total_commission: (s.total_commission ?? 0) + live.commission,
    total_return: live.nav - 1,
    nav: live.nav,
    max_drawdown: Math.min(s.max_drawdown, liveDd),
    win_days: win,
    loss_days: loss,
    flat_days: flat,
    win_rate: decided ? win / decided : null,
    avg_daily_return: avg,
    daily_volatility: vol,
    ann_return: annReturnNatural(live.nav, s.start_date, live.date),
    sharpe,
    best_day: !s.best_day || live.dailyPnl > s.best_day.daily_pnl ? row : s.best_day,
    worst_day: !s.worst_day || live.dailyPnl < s.worst_day.daily_pnl ? row : s.worst_day,
    total_deposit_withdraw: s.total_deposit_withdraw + live.depositWithdraw,
  };
}

export function foldLiveMonthly(monthly: SettleMonth[], live: LiveSettlePreview | null): SettleMonth[] {
  if (!live) return monthly;
  const ym = live.date.slice(0, 7);
  const winInc = live.dailyPnl > 1e-9 ? 1 : 0;
  const lossInc = live.dailyPnl < -1e-9 ? 1 : 0;
  const idx = monthly.findIndex((m) => m.month === ym);
  if (idx < 0) {
    return [...monthly, {
      month: ym,
      trading_day_start: live.tradingDay,
      trading_day_end: live.tradingDay,
      pnl: live.dailyPnl,
      income: live.dailyIncome,
      pnl_wan: live.dailyPnl / 10000,
      deposit_withdraw: live.depositWithdraw,
      commission: live.commission,
      days: 1,
      win_days: winInc,
      loss_days: lossInc,
      return: live.dailyRet,
      equity_start: live.equity - live.dailyPnl - live.depositWithdraw,
      equity_end: live.equity,
    }];
  }
  const m = monthly[idx];
  const next = monthly.slice();
  next[idx] = {
    ...m,
    trading_day_end: live.tradingDay,
    pnl: m.pnl + live.dailyPnl,
    income: (m.income ?? m.pnl) + live.dailyIncome,
    pnl_wan: (m.pnl + live.dailyPnl) / 10000,
    deposit_withdraw: m.deposit_withdraw + live.depositWithdraw,
    commission: m.commission + live.commission,
    days: m.days + 1,
    win_days: m.win_days + winInc,
    loss_days: m.loss_days + lossInc,
    return: (1 + Number(m.return || 0)) * (1 + live.dailyRet) - 1,
    equity_end: live.equity,
  };
  return next;
}

/** Build calendar rows from perf (preferred) with series commission fallback. */
export function buildCalDays(range: CtpSettlementRangeData, live?: LiveSettlePreview | null): CalDayHit[] {
  const seriesComm = Object.fromEntries(
    (range.series || [])
      .filter((p) => p.status === "ok")
      .map((p) => [p.date, Number(p.commission ?? 0)]),
  );
  const perf = range.analytics?.perf;
  const rows: CalDayHit[] = perf?.length
    ? perf.map((p) => {
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
    })
    : (range.analytics?.calendar_daily || []).map((d) => {
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
  if (live && !rows.some((r) => r.date === live.date)) {
    rows.push({
      date: live.date,
      trading_day: live.tradingDay,
      pnl: live.dailyPnl,
      income: live.dailyIncome,
      return: live.dailyRet,
      commission: live.commission,
      equity: live.equity,
    });
  }
  return rows;
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

