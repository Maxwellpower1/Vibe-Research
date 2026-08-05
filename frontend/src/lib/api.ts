// Vibe-Research 后端 API 客户端。/api → vite 代理到本地 FastAPI（默认 8900）。
// 后端未启动或数据源异常时抛 ApiError，页面据此优雅降级。

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// 后端访问密钥（对应后端部署时的 VR_API_KEY，公网部署防蹭用）。只存本地浏览器。
const ACCESS_KEY = "vr-access-key";

export function loadAccessKey(): string {
  try {
    return localStorage.getItem(ACCESS_KEY) || "";
  } catch {
    return "";
  }
}

export function saveAccessKey(key: string) {
  try {
    if (key) localStorage.setItem(ACCESS_KEY, key);
    else localStorage.removeItem(ACCESS_KEY);
  } catch {
    /* 隐私模式等场景 localStorage 不可用 */
  }
}

export function authHeaders(): Record<string, string> {
  const k = loadAccessKey();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

async function request<T>(path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: unknown): Promise<T> {
  let resp: Response;
  const headers: Record<string, string> = { ...authHeaders() };
  const opts: RequestInit = { method, cache: "no-store" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (Object.keys(headers).length > 0) opts.headers = headers;
  try {
    resp = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError("连接不到后端，请先启动 backend（uvicorn app:app --port 8900）", 0);
  }
  let payload: any = null;
  try {
    payload = await resp.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!resp.ok) {
    if (resp.status === 401) {
      throw new ApiError("后端开启了访问鉴权（VR_API_KEY）：请在「接入 AI」页底部填写后端访问密钥", 401);
    }
    throw new ApiError(payload?.detail || `HTTP ${resp.status}`, resp.status);
  }
  return (payload?.data ?? payload) as T;
}

const get = <T>(path: string) => request<T>(path, "GET");

export interface Quote {
  name: string; price: number; last_close: number; change_pct: number;
  pe_ttm: number; pb: number; mcap_yi: number; turnover_pct: number;
  limit_up: number; limit_down: number;
}

export interface Valuation {
  name: string; code: string; price: number; mcap_yi: number;
  pe_ttm: number; pb: number;
  eps_26e: number | null; eps_27e: number | null; pe_26e: number | null;
  cagr_pct: number | null; peg: number | null; digest_years: number | null;
  analyst_count: number; forecast_note?: string;
}

export interface Report {
  title: string; publishDate: string; orgSName: string;
  emRatingName?: string; indvInduName?: string; pdfUrl?: string | null;
}

export interface ValMetric {
  current: number; percentile: number; min: number; max: number;
  p20: number; p50: number; p80: number; n: number;
}
export interface ValPercentile {
  period: string; metrics: { pe_ttm?: ValMetric; pb?: ValMetric };
}

export interface Announcement {
  date: string; title: string; type: string; url: string;
}

export interface Financials {
  period: string | null;
  revenue: string | null; revenue_yoy: string | null;
  net_profit: string | null; net_profit_yoy: string | null;
  eps: string | null; bvps: string | null; roe: string | null;
  gross_margin: string | null; net_margin: string | null; op_cf_ps: string | null;
}

export interface NewsItem {
  新闻标题?: string; 发布时间?: string; 文章来源?: string; 新闻链接?: string;
}

/** 财联社电报 */
export interface ClsTelegraphItem {
  id?: string | number; title: string; content?: string; summary?: string;
  time: string; share_url?: string | null;
}
export interface ClsTelegraph {
  source?: string; count: number; items: ClsTelegraphItem[];
}

export interface FundFlowMinutePoint {
  time: string;
  main_net: number;
  small_net: number;
  mid_net: number;
  large_net: number;
  super_net: number;
}
export interface FundFlowMinute {
  code: string;
  count: number;
  day_main_net: number;
  latest: FundFlowMinutePoint | null;
  rows: FundFlowMinutePoint[];
}

export interface ThsLimitUpRow {
  code?: string; name?: string; price?: number | null; pct?: number | null;
  reason?: string; board_type?: string; seal_rate?: number | null;
  break_times?: number; seal_amount?: number | null;
  high_days?: string; first_time?: string; is_again?: number | boolean | null;
}
export interface ThsLimitUpPool {
  date: string; total: number; source?: string; note?: string; rows: ThsLimitUpRow[];
}

export interface IwencaiItem {
  title: string; publish_date?: string; score?: number;
  organization?: string; url?: string | null; channel?: string;
}
export interface IwencaiSearch {
  query: string; channel: string; count?: number; items: IwencaiItem[];
}

export interface IndexQuote {
  name: string; price: number; change_pct: number; change_amt: number;
}

export interface MarketSentiment {
  up: number; down: number; flat: number; zt: number; zt_real: number; dt: number; dt_real: number;
  active: string; breadth: string; speculation: string; date: string;
}
export interface SectorFlow {
  name: string; pct: number; net: number; inflow: number; outflow: number; firms: number;
}
export interface MarketOverview {
  sentiment: MarketSentiment; sectors: SectorFlow[]; updated: string;
}

// 短线情绪：连板梯队 / 最高连板 / 炸板率 / 封板率 / 晋级率 / 涨跌停家数 + 连板股清单（客观公开榜单）
export interface EmotionTier { boards: number; count: number; plus: boolean }
export interface LianbanStock {
  code: string; name: string; boards: number;
  price: number; pct: number; amount: number | null; float_cap: number | null; industry: string;
}
export interface ShortTermEmotion {
  date: string;
  zt_count: number; dt_count: number; zb_count: number;
  max_boards: number; lianban_count: number;
  ladder: EmotionTier[];
  lianban_stocks: LianbanStock[];
  seal_rate: number | null; break_rate: number | null; promotion_rate: number | null;
  yzt_count: number;
}

// 全市场成交额榜（客观公开榜单）
export interface TurnoverStock {
  code: string; name: string;
  price: number | null; pct: number | null;
  amount: number | null; mcap: number | null; float_cap: number | null; industry: string;
}
export interface TurnoverTop { stocks: TurnoverStock[]; updated: string }

/** 全市场龙虎榜（东财公开榜单，金额单位：万元） */
export interface DailyDragonTigerStock {
  code: string; name: string; reason: string;
  close: number; change_pct: number;
  net_buy_wan: number; buy_wan: number; sell_wan: number; turnover_pct: number;
}
export interface DailyDragonTiger {
  date: string; total_records: number; note?: string;
  stocks: DailyDragonTigerStock[];
}

export interface BoardFlowRow {
  rank: number; name: string; code: string;
  change_pct: number; main_net: number; main_pct: number; leader?: string;
  super_large_net?: number; large_net?: number; medium_net?: number; small_net?: number;
}
export interface BoardFlow {
  board_type: string; period: string; total: number; note?: string; rows: BoardFlowRow[];
}
export interface HsgtLive {
  date?: string; note?: string;
  latest: { time?: string; hgt_yi?: number | null; sgt_yi?: number | null } | null;
  points: Array<{ time: string; hgt_yi?: number | null; sgt_yi?: number | null }>;
}
export interface HotListRow {
  rank?: number; code?: string; name?: string;
  heat?: string | number; pct?: number | null; rank_chg?: number | null;
  price?: number | null; concepts?: string[]; tag?: string;
}
export interface HotList { period?: string; source?: string; rows: HotListRow[] }
export interface MonitorPool {
  date?: string; count?: number; note?: string;
  rows: Array<{ code: string; name: string; market: string; start: string; end: string; link?: string }>;
}
export interface AnomalyPool {
  date?: string; count?: number; note?: string;
  items: Array<{
    code?: string; name?: string; market?: string; change_pct?: number;
    deviation?: number; days?: number; rule?: string; is_today?: boolean;
  }>;
}
export interface LimitPool {
  pool: string; date: string; total: number; note?: string;
  rows: Array<{
    code?: string; name?: string; price?: number | null; pct?: number | null;
    turnover?: number | null; industry?: string; zt_stat?: string;
    limit_days?: number; break_times?: number; seal_fund?: number;
    first_seal?: string; last_seal?: string; dt_days?: number;
    amplitude?: number | null; speed?: number | null; y_limit_days?: number;
  }>;
}
export interface StockBasicInfo {
  code: string; name?: string; industry?: string;
  total_shares?: number | null; float_shares?: number | null;
  mcap?: number | null; float_mcap?: number | null;
  pe_ttm?: number | null; pb?: number | null; roe?: number | null;
  list_date?: string;
}

export interface RadarItem {
  title: string; url: string; time: string; source: string; summary?: string; zh?: string;
}
export interface Industry {
  key: string; name: string; accent: string; total: number; items: RadarItem[];
}
export interface RadarData {
  generated_at: string | null; recent_days: number; industries: Industry[];
  stats: { industries: number; total_sources: number; failed_sources?: number };
}

export interface Holding {
  code: string; name: string; price: number; shares: number; cost: number;
  market_value: number; pnl: number; pnl_pct: number;
}
export interface ClosedPosition {
  code: string; name: string; date: string; price: number; shares: number; cost: number;
  pnl: number; pnl_pct: number;
}
export interface PortfolioData {
  holdings: Holding[];
  totals: { market_value: number; cost: number; pnl: number; pnl_pct: number };
  closed: ClosedPosition[];
  realized_pnl: number;
  updated: string; last_refresh: string | null;
}

/** CTP 期货账户（只读查资金 / 持仓 / 委托 / 成交） */
export interface CtpPosition {
  exchange: string;
  instrument: string;
  direction: string;
  direction_code: string;
  hedge: string;
  position_date: string;
  position: number;
  yd_position: number;
  today_position: number;
  open_volume: number;
  close_volume: number;
  open_amount: number;
  close_amount: number;
  open_cost: number;
  position_cost: number;
  cost_per_lot: number;
  use_margin: number;
  exchange_margin: number;
  frozen_margin: number;
  frozen_cash: number;
  frozen_commission: number;
  long_frozen: number;
  short_frozen: number;
  close_profit: number;
  close_profit_by_date: number;
  close_profit_by_trade: number;
  position_profit: number;
  settlement_price: number;
  pre_settlement_price: number;
  margin_rate_by_money: number;
  margin_rate_by_volume: number;
  commission: number;
  cash_in: number;
  trading_day: string;
}
export interface CtpAccount {
  balance: number;
  /** 客户权益 / 动态权益 (Balance) */
  client_equity?: number;
  /** 市值权益 = 客户权益 + 多头期权市值 - 空头期权市值 */
  market_equity?: number;
  option_long_value?: number;
  option_short_value?: number;
  market_equity_method?: string;
  option_legs?: number;
  /** true while option ticks load in background */
  market_equity_pending?: boolean;
  available: number;
  curr_margin: number;
  exchange_margin: number;
  frozen_margin: number;
  frozen_cash: number;
  frozen_commission: number;
  pre_balance: number;
  pre_margin: number;
  deposit: number;
  withdraw: number;
  withdraw_quota: number;
  close_profit: number;
  position_profit: number;
  commission: number;
  credit: number;
  mortgage: number;
  cash_in: number;
  interest: number;
  delivery_margin: number;
  risk_ratio: number;
  currency: string;
  trading_day: string;
  account_id: string;
}
export interface CtpOrder {
  exchange: string;
  instrument: string;
  direction: string;
  direction_code: string;
  offset: string;
  hedge: string;
  price_type: string;
  limit_price: number;
  stop_price: number;
  volume_total: number;
  volume_traded: number;
  volume_left: number;
  min_volume: number;
  time_condition: string;
  volume_condition: string;
  status: string;
  status_code: string;
  submit_status: string;
  status_msg: string;
  order_sys_id: string;
  order_ref: string;
  order_local_id: string;
  broker_order_seq: number;
  insert_time: string;
  update_time: string;
  cancel_time: string;
  active_time: string;
  trading_day: string;
  front_id: number;
  session_id: number;
  force_close_reason: string;
  user_force_close: boolean;
  is_swap_order: boolean;
}
export interface CtpTrade {
  exchange: string;
  instrument: string;
  exchange_inst_id: string;
  direction: string;
  direction_code: string;
  offset: string;
  hedge: string;
  price: number;
  volume: number;
  amount: number;
  trade_id: string;
  order_sys_id: string;
  order_ref: string;
  order_local_id: string;
  broker_order_seq: number;
  trade_type: string;
  price_source: string;
  trade_source: string;
  trade_time: string;
  trading_day: string;
  sequence_no: number;
}
/** 持仓明细 (按开仓笔, 含逐笔平仓盈亏) */
export interface CtpPositionDetail {
  exchange: string;
  instrument: string;
  comb_instrument: string;
  direction: string;
  direction_code: string;
  hedge: string;
  open_date: string;
  trade_id: string;
  trade_type: string;
  open_price: number;
  volume: number;
  close_volume: number;
  close_amount: number;
  close_profit_by_date: number;
  close_profit_by_trade: number;
  position_profit_by_date: number;
  position_profit_by_trade: number;
  margin: number;
  exch_margin: number;
  margin_rate_by_money: number;
  margin_rate_by_volume: number;
  last_settlement_price: number;
  settlement_price: number;
  time_first_volume: number;
  trading_day: string;
}
export interface CtpPortfolioData {
  trading_day: string;
  account: CtpAccount;
  positions: CtpPosition[];
  details: CtpPositionDetail[];
  orders: CtpOrder[];
  trades: CtpTrade[];
  totals: {
    position_count: number;
    detail_count: number;
    order_count: number;
    trade_count: number;
    use_margin: number;
    position_profit: number;
    close_profit: number;
    detail_close_profit: number;
    detail_position_profit: number;
    market_equity?: number;
    option_long_value?: number;
    option_short_value?: number;
  };
  updated: string;
  user_masked: string;
  logged_in?: boolean;
  market_equity_pending?: boolean;
}
export interface CtpMarketEquityJob {
  status: "idle" | "pending" | "running" | "ready" | "error";
  seq: number;
  trading_day: string;
  updated: string | null;
  error: string | null;
  pending: boolean;
  account_patch: {
    client_equity?: number;
    market_equity?: number;
    option_long_value?: number;
    option_short_value?: number;
    market_equity_method?: string;
    option_legs?: number;
    market_equity_pending?: boolean;
  } | null;
}
export interface CtpStatus {
  configured: boolean;
  dependency_ok: boolean;
  dependency_msg: string;
  config_path: string;
  user_masked: string;
  ready: boolean;
  logged_in: boolean;
  logging_in: boolean;
  trading_day: string;
  host: string;
}
export interface CtpLogEntry {
  id: number;
  ts: string;
  level: string;
  message: string;
}
export interface CtpLogsData {
  logs: CtpLogEntry[];
  next_since: number;
  logged_in: boolean;
}
/** 结算单解析字段 */
export interface CtpSettlementParsed {
  equity: number | null;
  market_equity: number | null;
  client_equity: number | null;
  pre_balance: number | null;
  balance: number | null;
  available: number | null;
  deposit_withdraw: number | null;
  close_profit: number | null;
  position_profit: number | null;
  commission: number | null;
  curr_margin: number | null;
  risk_ratio: number | null;
  option_long_value: number | null;
  option_short_value: number | null;
}
export interface CtpSettlementData {
  trading_day: string;
  parsed: CtpSettlementParsed;
  content: string;
  chunk_count: number;
  updated: string;
  status?: string;
  from_cache?: boolean;
}
export interface CtpSettlementSeriesPoint {
  trading_day: string;
  date: string;
  equity: number | null;
  market_equity: number | null;
  client_equity: number | null;
  balance: number | null;
  available: number | null;
  deposit_withdraw?: number | null;
  close_profit: number | null;
  position_profit: number | null;
  commission: number | null;
  curr_margin: number | null;
  risk_ratio: number | null;
  status: string;
  from_cache: boolean;
  error: string | null;
  updated?: string;
}
export interface CtpSettlementPerfPoint {
  date: string;
  trading_day: string;
  equity: number;
  deposit_withdraw: number;
  commission: number;
  daily_pnl: number;
  /** income = daily_pnl - commission */
  daily_income?: number;
  daily_return: number;
  cum_pnl: number;
  cum_pnl_wan: number;
  cum_income?: number;
  cum_income_wan?: number;
  cum_return: number;
  nav: number;
  drawdown: number;
}
export interface CtpSettlementMonth {
  month: string;
  trading_day_start: string;
  trading_day_end: string;
  pnl: number;
  /** income = pnl - commission */
  income?: number;
  pnl_wan: number;
  deposit_withdraw: number;
  commission: number;
  days: number;
  win_days: number;
  loss_days: number;
  return: number;
  equity_start: number;
  equity_end: number;
}
export interface CtpSettlementAnalytics {
  perf: CtpSettlementPerfPoint[];
  monthly: CtpSettlementMonth[];
  calendar_daily: {
    date: string;
    trading_day: string;
    pnl: number;
    /** income = pnl - commission */
    income?: number;
    return: number;
    commission: number;
    equity: number;
  }[];
  summary: {
    days: number;
    start_date: string | null;
    end_date: string | null;
    start_equity: number | null;
    end_equity: number | null;
    total_pnl: number;
    total_pnl_wan: number;
    total_income?: number;
    total_commission?: number;
    total_return: number;
    nav: number;
    max_drawdown: number;
    win_days: number;
    loss_days: number;
    flat_days: number;
    win_rate: number | null;
    avg_daily_return: number;
    daily_volatility: number | null;
    ann_return: number | null;
    sharpe: number | null;
    best_day: { date: string; trading_day: string; daily_pnl: number; daily_return: number } | null;
    worst_day: { date: string; trading_day: string; daily_pnl: number; daily_return: number } | null;
    total_deposit_withdraw: number;
    method: string;
  };
  charts: {
    equity: { date: string; value: number }[];
    nav: { date: string; value: number }[];
    cum_return: { date: string; value: number }[];
    cum_pnl_wan: { date: string; value: number }[];
  };
}
export interface CtpSettlementRangeData {
  start: string;
  end: string;
  account: string;
  series: CtpSettlementSeriesPoint[];
  chart: { date: string; trading_day: string; equity: number; market_equity: number | null; client_equity: number | null }[];
  analytics?: CtpSettlementAnalytics;
  stats: {
    total_days: number;
    cached: number;
    fetched: number;
    empty: number;
    errors: number;
    missing: number;
  };
  cache_file: string;
  updated: string;
}

// 资金面 / 筹码 / 信号（v3.3 并入，均为「用户查的那只股」的公开数据）
export interface MarginRow { date: string; rzye: number; rzmre: number; rzche: number; rqye: number; rqmcl: number; rzrqye: number }
export interface BlockTradeRow { date: string; price: number; close: number; premium_pct: number; vol: number; amount: number; buyer: string; seller: string }
export interface HolderRow { date: string; holder_num: number; change_ratio: number; avg_shares: number }
export interface EtfFlowRow {
  code: string; name: string; price: number; change_pct: number; total_mv: number;
  main_net_inflow: number; super_large_net: number; large_net: number;
  medium_net: number; small_net: number; update_time?: string;
}
export interface EtfFlow {
  sort_by: string; total: number; note?: string; rows: EtfFlowRow[];
}
export interface ShareholderChangeRow {
  date: string; code: string; name: string; person: string; change_type: string;
  change_shares: number; change_ratio: number; avg_price: number;
  change_amount: number; after_holding: number; reason: string; position: string;
}
export interface ShareholderChanges {
  code?: string | null; change_type: string; total: number; note?: string;
  rows: ShareholderChangeRow[];
}
export interface LprRow { date: string; one_year: number; five_year: number }
export interface LprData {
  latest: LprRow | null; total: number; source?: string; note?: string; rows: LprRow[];
}
export interface CnBondYield {
  date: string; curve_type: string; source?: string;
  terms: Record<string, number>;
  spread_10_2?: number | null; spread_30_10?: number | null;
  curve_points?: number[][];
  error?: string; warning?: string;
}
export interface DividendRow { date: string; bonus_rmb: number; transfer_ratio: number; bonus_ratio: number | null; plan: string }
export interface FundFlowRow { date: string; main_net: number; small_net: number; mid_net: number; large_net: number; super_net: number }
export interface DtSeat { name: string; buy_amt: number; sell_amt: number; net: number }
export interface DragonTiger {
  records: { date: string; reason: string; net_buy: number; turnover: number }[];
  seats: { buy: DtSeat[]; sell: DtSeat[] };
  institution: { buy_amt: number; sell_amt: number; net_amt: number };
}
export interface LockupRow { date: string; type: string; shares: number; able_shares: number; ratio: number }
export interface Lockup { history: LockupRow[]; upcoming: LockupRow[] }
export interface Board { name: string; code: string; change_pct: number | string; lead_stock: string }
export interface Blocks { total: number; boards: Board[]; concept_tags: string[] }
export interface HotConcept { concept: string; bk: string; hit: number }
export interface QaRow { company: string; question: string; answer: string | null; answerer: string; ask_time: string }
export interface IndustryRow { rank: number; name: string; change_pct: number; code: string; up_count: number; down_count: number }
export interface IndustryData { top: IndustryRow[]; bottom: IndustryRow[]; total: number }

// 全球市场（美股 / 港股，移植自 global-stock-data · 东财域内源）
export interface GlobalIndex {
  key: string; name: string; region: string;
  price: number | null; change_pct: number | null;
}
export interface GlobalQuote {
  code: string; name: string;
  price: number | null; open: number | null; high: number | null; low: number | null;
  prev_close: number | null; amount: number | null; mcap: number | null; change_pct: number | null;
}
export interface GlobalMetrics {
  report_date: string;
  revenue: number | null; revenue_yoy: number | null; net_profit: number | null;
  eps: number | null; roe: number | null; gross_margin: number | null;
  net_margin: number | null; debt_ratio: number | null;
}
export interface GlobalStock {
  code: string; name: string; market: string;
  quote: GlobalQuote; metrics: GlobalMetrics | null;
}
export interface HkCashflowItem { amount: number | null; yoy: number | null }
export interface HkCashflowPeriod {
  report_date: string; report: string | null;
  currency: string | null; account_standard: string | null;
  items: Record<string, HkCashflowItem>;
}
export interface HkCashflow {
  code: string; name: string; market: string;
  currency: string | null; item_order: string[]; periods: HkCashflowPeriod[];
}
export interface UsKlineBar {
  date: string;
  open: number; high: number; low: number; close: number; volume: number;
}
export interface UsKline {
  code: string; name?: string; market: string; source?: string;
  /** qfq = forward adjusted; none = raw (sina fallback) */
  adjust?: "qfq" | "none" | string;
  bars: UsKlineBar[];
}

/** Yahoo valuation / analyst / holders bundle */
export interface GlobalValuation {
  code?: string; name?: string; market?: string; yahoo_symbol?: string;
  current_price?: number | null; target_mean?: number | null;
  target_high?: number | null; target_low?: number | null;
  recommendation?: string | null;
  trailing_pe?: number | null; forward_pe?: number | null; peg_ratio?: number | null;
  price_to_book?: number | null; enterprise_value?: number | null;
  ev_to_ebitda?: number | null; beta?: number | null;
  profit_margin?: number | null; operating_margin?: number | null; gross_margin?: number | null;
  return_on_equity?: number | null; return_on_assets?: number | null;
  earnings_growth?: number | null; revenue_growth?: number | null;
  dividend_yield?: number | null; short_ratio?: number | null;
  market_cap?: number | null; total_cash?: number | null; total_debt?: number | null;
}
export interface GlobalAnalyst {
  code?: string; name?: string; market?: string;
  eps_trend: Array<{
    period?: string; end_date?: string; eps_estimate?: number | null;
    eps_high?: number | null; eps_low?: number | null;
    revenue_estimate?: number | null; num_analysts?: number | null;
  }>;
  rating_trend: Array<{
    period?: string; strong_buy?: number; buy?: number; hold?: number;
    sell?: number; strong_sell?: number;
  }>;
  upgrade_downgrade: Array<{
    date?: number; firm?: string; to_grade?: string; from_grade?: string; action?: string;
  }>;
}
export interface GlobalHolders {
  code?: string; name?: string; market?: string;
  overview: {
    insiders_pct?: number | null; institutions_pct?: number | null;
    institutions_float_pct?: number | null; institutions_count?: number | null;
  };
  top_holders: Array<{
    name?: string; shares?: number | null; value?: number | null;
    pct_held?: number | null; report_date?: string | null;
  }>;
}
export interface GlobalFundamentals {
  code: string; name: string; market: string; note?: string;
  valuation: GlobalValuation | null;
  analyst: GlobalAnalyst | null;
  holders: GlobalHolders | null;
}
export interface GlobalStmtItem { amount: number | null; yoy: number | null }
export interface GlobalStatements {
  code: string; name: string; market: string; statement: string;
  currency: string | null; item_order: string[];
  periods: Array<{
    report_date: string; report?: string | null; currency?: string | null;
    items: Record<string, GlobalStmtItem>;
  }>;
}
export interface GlobalFundFlow {
  code: string; name: string; market: string;
  rows: Array<{
    date: string; main_net: number; small_net: number; mid_net: number;
    big_net: number; super_big_net: number; main_pct: number | null;
  }>;
}
export interface GlobalShortVolume {
  code: string; name: string; market: string; note?: string;
  rows: Array<{ date: string; short: number; short_exempt: number; total: number; ratio: number | null }>;
}
export interface GlobalSecFilings {
  code: string; name: string; cik: string; company_name?: string;
  filings: Array<{
    form: string; form_label?: string; date: string; description?: string; url?: string | null;
  }>;
}
export interface GlobalSecDaily {
  date: string; total: number; by_form: Record<string, number>;
  filings: Array<{
    form: string; form_label?: string; company: string; cik: string; date: string; url?: string | null;
  }>;
}
export interface GlobalEdgarScreener {
  compliance?: string; source?: string;
  tag: string; tag_label: string; period: string; unit: string;
  instant?: boolean; universe: number; ascending?: boolean;
  tags: Array<{ label: string; tag: string }>;
  rows: Array<{ cik?: number | string; entity?: string; value?: number; end?: string }>;
}
export interface GlobalMovers {
  board: string; market: string; total: number;
  stocks: Array<{
    code?: string; name?: string; price?: number | null; change_pct?: number | null;
    volume?: number | null; amount?: number | null; amplitude?: number | null;
  }>;
}
export interface GlobalShortRanking {
  date?: string; market?: string; universe?: number; min_total?: number; note?: string;
  rows: Array<{
    symbol: string; short: number; short_exempt: number; total: number; ratio: number | null;
  }>;
}
export interface GlobalStockNews {
  code: string; name?: string; market?: string; yahoo_symbol?: string;
  compliance?: string; source?: string;
  items: Array<{
    title?: string; publisher?: string; link?: string;
    publish_time?: string | null; publish_ts?: number | null; thumbnail?: string | null;
  }>;
}
export interface GlobalTreasuryPoint {
  tenor: string; yield: number; chg: number | null;
}
export interface GlobalTreasuryCurve {
  date: string; prev_date?: string | null;
  source?: string; compliance?: string;
  points: GlobalTreasuryPoint[];
  spreads: {
    ten_two?: number | null;
    thirty_ten?: number | null;
    ten_three_month?: number | null;
  };
}
export interface GlobalEarningsRow {
  date?: string; symbol?: string; name?: string; time?: string;
  eps_forecast?: string; market_cap?: string;
}
export interface GlobalEarningsCalendar {
  date: string; count: number;
  start?: string; end?: string; days?: number; total?: number;
  by_day?: Array<{ date: string; count: number; rows: GlobalEarningsRow[] }>;
  rows: GlobalEarningsRow[];
}
export interface GlobalOptContract {
  symbol?: string; expiry?: string; type?: string; strike?: number;
  bid?: number | null; ask?: number | null; volume?: number; open_interest?: number;
  iv?: number | null; delta?: number | null; gamma?: number | null;
  vega?: number | null; theta?: number | null; last_trade_price?: number | null;
  vol_oi_ratio?: number | null;
}
export interface GlobalOptSummary {
  call_volume: number; put_volume: number;
  put_call_volume_ratio: number | null;
  call_oi: number; put_oi: number;
  put_call_oi_ratio: number | null;
  volume_weighted_iv: number | null;
  net_delta_exposure_shares: number;
  contracts_total: number; contracts_traded: number;
}
export interface GlobalOptions {
  code: string; name: string; market: string; ticker: string;
  timestamp?: string; spot?: number | null; et_today?: string;
  compliance?: string; note?: string;
  expiries: string[];
  summary_all: GlobalOptSummary;
  summary_0dte: GlobalOptSummary | null;
  summary_7d: GlobalOptSummary | null;
  unusual_0dte: GlobalOptContract[];
  unusual_7d: GlobalOptContract[];
  atm_0dte: GlobalOptContract[];
}
/** A-share light chart bar (分时/5日/日K) */
export interface AShareLightBar {
  datetime: string;
  open: number; high: number; low: number; close: number;
  volume: number; amount?: number;
}
export interface AShareLightKline {
  code: string; name?: string;
  resolution: "1" | "5" | "1D" | string;
  adjust?: "qfq" | "none" | string;
  source?: string;
  prev_close?: number | null;
  bars: AShareLightBar[];
}

// OpenVlab 期权 / 期货波动率市场数据（移植自 openvlab.cn 爬虫, 公开 REST 接口）
export interface OvlabMarketRow {
  product_alias?: string; prodUnd?: string; product?: string;
  exchange?: string; sector_alias?: string; sector?: string;
  price?: number | string; ctn?: number | string;
  atmv_current?: number | string; atmv_1dchg?: number | string; atmv_percentile?: number | string;
  rv22?: number | string; valphaT?: number | string; carry?: number | string;
  skew_current?: number | string; skew_1dchg?: number | string; skew_percentile?: number | string;
  frontfwd_mom?: number | string; exp?: string; expiry_date?: string;
  last_time?: string; has_night_trading?: boolean | number; is_overseas?: boolean | number;
  [k: string]: unknown;
}
export type OvlabDetail = Record<string, unknown>;
export type OvlabVolatilityTs = Record<string, unknown>;
export type OvlabFutureTs = Record<string, unknown>;
export type OvlabFutureTsAll = Record<string, unknown>;
export interface OvlabFlowAlert {
  time?: string; instrument?: string; contract_code?: string;
  rule_id?: string; side?: string; price?: number | string;
  ctn?: string; open_interest?: number; window_volume?: number;
  window_premium?: number; pct_change?: string;
  [k: string]: unknown;
}
export interface OvlabWarehouseHistory {
  last_update_time?: string; value?: unknown; category?: string;
  ratioData?: unknown;
  [k: string]: unknown;
}
// 异动资金流 (flow-data)
export interface OvlabFlowDataRow {
  product_alias?: string; full_name?: string; product_und?: string;
  sector?: string; exchange?: string; instrument?: string;
  last_trade_price?: number; ctnPct?: number; underlying_price?: number;
  otmPct?: number; volume?: number; volume_value?: number;
  oi?: number; prevOi?: number; oiChange?: number; oiChangePct?: number; oiChangeVal?: number;
  strikePrice?: number; optType?: string; dte?: number;
  trade_at_ask?: number; trade_at_bid?: number; trade_at_mid?: number;
  ask_percentage?: number; bid_percentage?: number; mid_percentage?: number;
  contract_code?: string;
  [k: string]: unknown;
}
export interface OvlabFlowData {
  data: OvlabFlowDataRow[];
  totalCount?: number; page?: number; pageSize?: number; totalPages?: number;
}
export interface OvlabProductExpExpiry { exp?: number; expDate?: string; limit_up?: number; limit_down?: number; [k: string]: unknown }
export interface OvlabProductExp {
  sector?: string; sector_alias?: string; gui_order?: number;
  product?: string; product_und?: string; product_alias?: string;
  symbol?: string; symbol_und?: string; has_night_trading?: number;
  is_overseas?: string; exchange?: string;
  exps?: OvlabProductExpExpiry[];
  [k: string]: unknown;
}
export interface OvlabExchangeInfo { code?: string; name?: string; [k: string]: unknown }
export interface OvlabSectorInfo { code?: string; name?: string; [k: string]: unknown }

/** Market hover preview: price + IV intraday series (price-volatility-series) */
export interface OvlabPriceVolSeriesItem {
  symbol?: string;
  prices?: Array<[string, number]>;
  volatilities?: Array<[string, number]>;
  intervals?: Array<[string, string]>;
  [k: string]: unknown;
}

// 轻量行情图表
export interface OvlabKlineBar {
  trade_date: string; ts_code?: string;
  open: number; high: number; low: number; close: number;
  pre_close?: number; settle?: number; change1?: number; change2?: number;
  vol?: number; amount?: number; oi?: number; oi_chg?: number;
  [k: string]: unknown;
}
export interface OvlabKlineHistory { data: OvlabKlineBar[] }
export interface OvlabAtmvolHistory { data: Array<[string, number]> }
export interface OvlabLastBar {
  close: number; open: number; high: number; low: number;
  oi?: number; vol?: number; pre_close?: number; pre_close_1w?: number;
  trade_date?: string; [k: string]: unknown;
}
export interface OvlabSymbolInfo {
  ticker?: string; name?: string; exchange?: string; description?: string;
  sector?: string; type?: string; pricescale?: number; minmov?: number;
  session?: string; expiration_date?: string; [k: string]: unknown;
}
export interface OvlabSearchItem {
  ticker?: string; name?: string; exchange?: string; description?: string;
  sector?: string; type?: string; pricescale?: number; minmov?: number;
  session?: string; expiration_date?: string; [k: string]: unknown;
}
export type OvlabVolSurface = Record<string, Record<string, unknown>>;
export type OvlabSkewmap = Record<string, Record<string, unknown>>;
export type OvlabSurfacemap = Record<string, Record<string, unknown>>;

// 持仓排名 (flow/option-flow)
export interface OvlabPositionProduct {
  product: string;
  product_alias: string;
  exchange_name: string;
  codes: string[];
}
export interface OvlabPositionProducts {
  last_trading_day: string;
  products: OvlabPositionProduct[];
}
export interface OvlabRankRow {
  id?: number | null;
  code?: string;
  day?: string;
  underlyingCode?: string;
  rankTypeId?: number;
  rank?: number;
  memberName?: string;
  indicator?: number;
  indicatorIncrease?: number;
  [k: string]: unknown;
}
export interface OvlabRankChart {
  style?: Record<string, unknown>;
  brokers?: unknown[];
  current?: unknown[];
  change?: unknown[];
  increase?: unknown[];
  decrease?: unknown[];
  [k: string]: unknown;
}
export interface OvlabFuturePositionDetails {
  codes?: string[];
  futureName?: string;
  instrument?: string;
  tradingDay?: string;
  days?: string[];
  short_rank_table?: OvlabRankRow[];
  long_rank_table?: OvlabRankRow[];
  net_short_rank_table?: OvlabRankRow[];
  net_long_rank_table?: OvlabRankRow[];
  short_rank_chart?: OvlabRankChart;
  long_rank_chart?: OvlabRankChart;
  net_short_rank_chart?: OvlabRankChart;
  net_long_rank_chart?: OvlabRankChart;
  maxNetShort?: { memberName?: string; netIndicator?: number };
  maxNetLong?: { memberName?: string; netIndicator?: number };
  status?: number;
  [k: string]: unknown;
}
export type OvlabOptionPositionDetails = Record<string, unknown>;

// —— Fino 机构观点 ——
export interface FinoOverviewRow {
  product_name?: string;
  product_code?: string;
  date?: string;
  report_type?: string;
  bull_count?: number;
  neutral_count?: number;
  bear_count?: number;
  bull_percentage?: number;
  neutral_percentage?: number;
  bear_percentage?: number;
  bull_views?: string;
  neutral_views?: string;
  bear_views?: string;
  consensus_views?: string;
  disagreement_views?: string;
  [k: string]: unknown;
}
/** rating: "+1" bull / "0" neutral / "-1" bear */
export interface FinoDetailRow {
  date?: string;
  viewpoint?: string;
  rating?: string | number;
  detail?: string;
  product_code?: string;
  product_name?: string;
  uni_id?: string;
  source?: string;
  [k: string]: unknown;
}

export const api = {
  health: () => get<{ ok: boolean }>("/health"),
  indices: () => get<IndexQuote[]>("/indices"),
  marketOverview: () => get<MarketOverview>("/market/overview"),
  emotion: () => get<ShortTermEmotion>("/market/emotion"),
  turnoverTop: () => get<TurnoverTop>("/market/turnover-top"),
  dailyDragonTiger: (opts?: { date?: string; top?: number; minNetBuy?: number }) => {
    const p = new URLSearchParams();
    if (opts?.date) p.set("date", opts.date);
    if (opts?.top != null) p.set("top", String(opts.top));
    if (opts?.minNetBuy != null) p.set("min_net_buy", String(opts.minNetBuy));
    const q = p.toString();
    return get<DailyDragonTiger>(`/dragon-tiger/daily${q ? `?${q}` : ""}`);
  },
  boardFlow: (boardType = "industry", period = "today", top = 20) =>
    get<BoardFlow>(`/market/board-flow?board_type=${boardType}&period=${period}&top=${top}`),
  etfFlow: (sortBy: "net_inflow" | "change_pct" = "net_inflow", limit = 40) =>
    get<EtfFlow>(`/market/etf-flow?sort_by=${sortBy}&limit=${limit}`),
  shareholderChanges: (opts?: { code?: string; changeType?: "all" | "增持" | "减持"; limit?: number }) => {
    const p = new URLSearchParams();
    if (opts?.code) p.set("code", opts.code);
    if (opts?.changeType) p.set("change_type", opts.changeType);
    if (opts?.limit != null) p.set("limit", String(opts.limit));
    const q = p.toString();
    return get<ShareholderChanges>(`/shareholder-changes${q ? `?${q}` : ""}`);
  },
  lpr: (days = 365) => get<LprData>(`/market/lpr?days=${days}`),
  cnBondYield: (curveType: "treasury" | "policy" = "treasury") =>
    get<CnBondYield>(`/market/bond-yield?curve_type=${curveType}`),
  hsgt: () => get<HsgtLive>("/market/hsgt"),
  hotList: (source: "ths" | "em" = "ths", period = "hour", top = 30) =>
    get<HotList>(`/market/hot-list?source=${source}&period=${period}&top=${top}`),
  stockMonitor: () => get<MonitorPool>("/market/stock-monitor"),
  priceAnomaly: (top = 40) => get<AnomalyPool>(`/market/price-anomaly?top=${top}`),
  limitPools: (pool: "zt" | "zb" | "dt" | "yzt" = "zt", top = 40) =>
    get<LimitPool>(`/market/limit-pools?pool=${pool}&top=${top}`),
  stockBasic: (code: string) => get<StockBasicInfo>(`/stock-basic?code=${code}`),
  globalIndices: () => get<GlobalIndex[]>("/global/indices"),
  globalStock: (symbol: string, opts?: { withMetrics?: boolean }) => {
    const p = new URLSearchParams({ symbol });
    if (opts?.withMetrics === false) p.set("with_metrics", "false");
    return get<GlobalStock>(`/global/stock?${p}`);
  },
  usKline: (symbol: string, num = 180) =>
    get<UsKline>(`/global/us/kline?symbol=${encodeURIComponent(symbol)}&num=${num}`),
  hkKline: (symbol: string, num = 180) =>
    get<UsKline>(`/global/hk/kline?symbol=${encodeURIComponent(symbol)}&num=${num}`),
  hkCashflow: (symbol: string) => get<HkCashflow>(`/global/hk/cashflow?symbol=${encodeURIComponent(symbol)}`),
  globalEdgarScreener: (opts?: {
    tag?: string; year?: number; quarter?: number; top?: number; ascending?: boolean;
  }) => {
    const p = new URLSearchParams();
    if (opts?.tag) p.set("tag", opts.tag);
    if (opts?.year != null) p.set("year", String(opts.year));
    if (opts?.quarter != null) p.set("quarter", String(opts.quarter));
    if (opts?.top != null) p.set("top", String(opts.top));
    if (opts?.ascending) p.set("ascending", "true");
    const q = p.toString();
    return get<GlobalEdgarScreener>(`/global/edgar/screener${q ? `?${q}` : ""}`);
  },
  globalMovers: (board = "us_gainers", top = 20) =>
    get<GlobalMovers>(`/global/movers?board=${encodeURIComponent(board)}&top=${top}`),
  globalShortRanking: (top = 20, minTotal = 1_000_000) =>
    get<GlobalShortRanking>(`/global/short-ranking?top=${top}&min_total=${minTotal}`),
  globalStockNews: (symbol: string, count = 10) =>
    get<GlobalStockNews>(`/global/stock/news?symbol=${encodeURIComponent(symbol)}&count=${count}`),
  globalFundamentals: (symbol: string) =>
    get<GlobalFundamentals>(`/global/stock/fundamentals?symbol=${encodeURIComponent(symbol)}`),
  globalStatements: (symbol: string, statement: "income" | "balance" | "cashflow" = "income", periods = 5) =>
    get<GlobalStatements>(
      `/global/stock/statements?symbol=${encodeURIComponent(symbol)}&statement=${statement}&periods=${periods}`,
    ),
  globalFundFlow: (symbol: string, limit = 30) =>
    get<GlobalFundFlow>(`/global/stock/fund-flow?symbol=${encodeURIComponent(symbol)}&limit=${limit}`),
  globalShortVolume: (symbol: string, days = 10) =>
    get<GlobalShortVolume>(`/global/stock/short-volume?symbol=${encodeURIComponent(symbol)}&days=${days}`),
  globalSecFilings: (symbol: string, limit = 30) =>
    get<GlobalSecFilings>(`/global/stock/sec-filings?symbol=${encodeURIComponent(symbol)}&limit=${limit}`),
  globalSecDaily: (opts?: { date?: string; limit?: number }) => {
    const p = new URLSearchParams();
    if (opts?.date) p.set("date", opts.date);
    if (opts?.limit) p.set("limit", String(opts.limit));
    const q = p.toString();
    return get<GlobalSecDaily>(`/global/sec/daily${q ? `?${q}` : ""}`);
  },
  globalEarningsCalendar: (opts?: { date?: string; days?: number }) => {
    const p = new URLSearchParams();
    if (opts?.date) p.set("date", opts.date);
    if (opts?.days != null) p.set("days", String(opts.days));
    const q = p.toString();
    return get<GlobalEarningsCalendar>(`/global/earnings-calendar${q ? `?${q}` : ""}`);
  },
  globalTreasuryCurve: () => get<GlobalTreasuryCurve>("/global/treasury-curve"),
  globalOptions: (symbol: string, unusualTop = 15) =>
    get<GlobalOptions>(
      `/global/stock/options?symbol=${encodeURIComponent(symbol)}&unusual_top=${unusualTop}`,
    ),
  radar: () => get<RadarData>("/radar"),
  radarRefresh: () => request<RadarData>("/radar/refresh", "POST"),
  portfolio: () => get<PortfolioData>("/portfolio"),
  addHolding: (code: string, shares: number, cost: number) => request<PortfolioData>("/portfolio/holding", "POST", { code, shares, cost }),
  removeHolding: (code: string) => request<PortfolioData>(`/portfolio/holding?code=${code}`, "DELETE"),
  refreshPortfolio: () => request<PortfolioData>("/portfolio/refresh", "POST"),
  closePosition: (code: string, date: string, price: number, shares: number, cost: number) =>
    request<PortfolioData>("/portfolio/close", "POST", { code, date, price, shares, cost }),
  removeClosed: (index: number) => request<PortfolioData>(`/portfolio/close?index=${index}`, "DELETE"),
  ctpStatus: () => get<CtpStatus>("/portfolio/ctp/status"),
  ctpLogs: (since = 0) => get<CtpLogsData>(`/portfolio/ctp/logs?since=${since}`),
  ctpLogin: () => request<{
    logged_in: boolean;
    trading_day: string;
    user_masked: string;
    message: string;
    portfolio?: CtpPortfolioData | null;
  }>("/portfolio/ctp/login", "POST"),
  ctpLogout: () => request<{ logged_in: boolean; message: string }>("/portfolio/ctp/logout", "POST"),
  ctpPortfolio: () => get<CtpPortfolioData>("/portfolio/ctp"),
  ctpMarketEquity: () => get<CtpMarketEquityJob>("/portfolio/ctp/market-equity"),
  ctpSettlement: (day: string, force = false) =>
    get<CtpSettlementData>(
      `/portfolio/ctp/settlement?day=${encodeURIComponent(day)}&force=${force ? "true" : "false"}`,
    ),
  ctpSettlementRange: (opts: { start: string; end?: string; refresh?: boolean; force?: boolean }) => {
    const p = new URLSearchParams({ start: opts.start });
    if (opts.end) p.set("end", opts.end);
    p.set("refresh", opts.refresh === false ? "false" : "true");
    p.set("force", opts.force ? "true" : "false");
    return get<CtpSettlementRangeData>(`/portfolio/ctp/settlement/range?${p}`);
  },
  valuation: (code: string) => get<Valuation>(`/valuation?code=${code}`),
  percentile: (code: string) => get<ValPercentile>(`/valuation/percentile?code=${code}`),
  financials: (code: string) => get<Financials>(`/financials?code=${code}`),
  announcements: (code: string) => get<Announcement[]>(`/announcements?code=${code}`),
  quote: (codes: string) => get<Record<string, Quote>>(`/quote?codes=${codes}`),
  /** A 股轻量图：resolution 1=分时 / 5=五日 / 1D=日K前复权（腾讯） */
  ashareLightKline: (code: string, resolution = "1D", num = 365) =>
    get<AShareLightKline>(
      `/astock/light-kline?code=${encodeURIComponent(code)}&resolution=${encodeURIComponent(resolution)}&num=${num}`,
    ),
  reports: (code: string) => get<Report[]>(`/reports?code=${code}`),
  news: (code: string) => get<NewsItem[]>(`/news?code=${code}`),
  clsTelegraph: (limit = 50) => get<ClsTelegraph>(`/cls-telegraph?limit=${limit}`),
  globalNews: (limit = 50) => get<ClsTelegraph>(`/global-news?limit=${limit}`),
  margin: (code: string) => get<MarginRow[]>(`/margin?code=${code}`),
  blockTrade: (code: string) => get<BlockTradeRow[]>(`/block-trade?code=${code}`),
  holders: (code: string) => get<HolderRow[]>(`/holders?code=${code}`),
  dividend: (code: string) => get<DividendRow[]>(`/dividend?code=${code}`),
  fundFlow: (code: string) => get<FundFlowRow[]>(`/fund-flow?code=${code}`),
  fundFlowMinute: (code: string) => get<FundFlowMinute>(`/fund-flow/minute?code=${code}`),
  thsLimitUp: (date?: string) =>
    get<ThsLimitUpPool>(`/market/ths-limit-up${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  iwencaiStatus: () => get<{ configured: boolean }>("/iwencai/status"),
  iwencaiSearch: (q: string, channel: "report" | "announcement" | "news" = "report", size = 20) =>
    get<IwencaiSearch>(
      `/iwencai/search?q=${encodeURIComponent(q)}&channel=${channel}&size=${size}`,
    ),
  dragonTiger: (code: string) => get<DragonTiger>(`/dragon-tiger?code=${code}`),
  lockup: (code: string) => get<Lockup>(`/lockup?code=${code}`),
  blocks: (code: string) => get<Blocks>(`/blocks?code=${code}`),
  hotConcepts: (code: string) => get<HotConcept[]>(`/hot-concepts?code=${code}`),
  investorQa: (code: string) => get<QaRow[]>(`/investor-qa?code=${code}`),
  industry: (top = 20) => get<IndustryData>(`/industry?top=${top}`),
  // OpenVlab 期权 / 期货波动率
  ovlabMarket: () => get<OvlabMarketRow[]>("/ovlab/market"),
  ovlabDetail: (prodUnd: string, exps?: string) =>
    get<OvlabDetail>(`/ovlab/detail?prod_und=${encodeURIComponent(prodUnd)}${exps ? `&exps=${encodeURIComponent(exps)}` : ""}`),
  ovlabVolatilityTs: () => get<OvlabVolatilityTs>("/ovlab/volatility-ts"),
  ovlabFutureTsAll: () => get<OvlabFutureTsAll>("/ovlab/future-ts-all"),
  ovlabFutureTs: (prodUnd: string) => get<OvlabFutureTs>(`/ovlab/future-ts?prod_und=${encodeURIComponent(prodUnd)}`),
  ovlabFlowAlert: () => get<OvlabFlowAlert[]>("/ovlab/flow-alert"),
  ovlabFlowData: (product?: string, page = 1, pageSize = 50) =>
    request<OvlabFlowData>("/ovlab/flow-data", "POST", { product: product?.trim() || null, page, page_size: pageSize }),
  ovlabWarehouseHistory: (product: string) =>
    request<OvlabWarehouseHistory>("/ovlab/warehouse-history", "POST", { product }),
  ovlabSeasonalHistory: (years?: string[], product?: string) =>
    request<Record<string, unknown>>("/ovlab/warehouse-seasonal", "POST", { years, product }),
  ovlabProductExps: (prodUnd?: string) =>
    get<OvlabProductExp[]>(`/ovlab/product-exps${prodUnd ? `?prod_und=${encodeURIComponent(prodUnd)}` : ""}`),
  ovlabExchangeInfo: () => get<OvlabExchangeInfo[]>("/ovlab/exchange-info"),
  ovlabSectorInfo: () => get<OvlabSectorInfo[]>("/ovlab/sector-info"),
  ovlabNextTradingDay: () => get<string>("/ovlab/next-trading-day"),
  ovlabHolidays: (exchange: string) => get<unknown>(`/ovlab/holidays?exchange=${encodeURIComponent(exchange)}`),
  // 轻量行情图表 (分时/5日实时变化, 加 _t 避免中间层缓存串周期)
  ovlabKlineHistory: (symbol: string, resolution = "1D", fromTs?: number, toTs?: number) => {
    const p = new URLSearchParams({ symbol, resolution });
    if (fromTs != null) p.set("from_ts", String(fromTs));
    if (toTs != null) p.set("to_ts", String(toTs));
    if (resolution === "1" || resolution === "5") p.set("_t", String(Date.now()));
    return get<OvlabKlineHistory>(`/ovlab/kline-history?${p}`);
  },
  ovlabAtmvolHistory: (symbol: string, resolution = "1D", fromTs?: number, toTs?: number) => {
    const p = new URLSearchParams({ symbol, resolution });
    if (fromTs != null) p.set("from_ts", String(fromTs));
    if (toTs != null) p.set("to_ts", String(toTs));
    if (resolution === "1" || resolution === "5") p.set("_t", String(Date.now()));
    return get<OvlabAtmvolHistory>(`/ovlab/atmvol-history?${p}`);
  },
  ovlabLastBar: (code: string) => get<OvlabLastBar>(`/ovlab/last-bar?code=${encodeURIComponent(code)}`),
  /** Batch price + IV preview series. codes like ["MA:202609"].
   *  Send as JSON string so both old (codes:str) and new (codes:list|str) backends accept it.
   *  Upstream also expects codes as JSON.stringify(array). Cached 5min server-side. */
  ovlabPriceVolatilitySeries: (codes: string[]) =>
    request<OvlabPriceVolSeriesItem[]>("/ovlab/price-volatility-series", "POST", {
      codes: JSON.stringify(codes),
    }),
  ovlabSearchSymbols: (keyword: string) =>
    get<OvlabSearchItem[]>(`/ovlab/search-symbols?keyword=${encodeURIComponent(keyword)}`),
  ovlabSymbolInfo: (code: string) => get<OvlabSymbolInfo>(`/ovlab/symbol-info?code=${encodeURIComponent(code)}`),
  ovlabVolatilitySurface: (product: string) =>
    get<OvlabVolSurface>(`/ovlab/volatility-surface?product=${encodeURIComponent(product)}`),
  ovlabSkewmap: (selectedExpiries?: Record<string, unknown>) =>
    request<OvlabSkewmap>("/ovlab/skewmap", "POST", { selectedExpiries: selectedExpiries ?? {} }),
  ovlabSurfacemap: (product?: string) =>
    get<OvlabSurfacemap>(`/ovlab/surfacemap${product ? `?product=${encodeURIComponent(product)}` : ""}`),
  // 持仓排名
  ovlabOptionPositionProducts: () => get<OvlabPositionProducts>(`/ovlab/option-position-products`),
  ovlabOptionPositionDetails: (product: string, code: string, direction: "C" | "P", day: string) => {
    const p = new URLSearchParams({ product, code, direction, day });
    return get<OvlabOptionPositionDetails>(`/ovlab/option-position-details?${p}`);
  },
  ovlabFuturePositionProducts: () => get<OvlabPositionProducts>(`/ovlab/future-position-products`),
  ovlabFuturePositionDetails: (product: string, code: string, day: string) => {
    const p = new URLSearchParams({ product, code, direction: "0", day });
    return get<OvlabFuturePositionDetails>(`/ovlab/future-position-details?${p}`);
  },
  finoOverview: (report_type = "daily", start_date = "", end_date = "", codes = "") => {
    const p = new URLSearchParams({ report_type, start_date, end_date, codes });
    return get<FinoOverviewRow[]>(`/fino/overview?${p}`);
  },
  finoDetail: (report_type = "daily", start_date = "", end_date = "", codes = "") => {
    const p = new URLSearchParams({ report_type, start_date, end_date, codes });
    return get<FinoDetailRow[]>(`/fino/detail?${p}`);
  },
  weather: (city = "上海", days = 7) =>
    get<WeatherPayload>(`/weather?city=${encodeURIComponent(city)}&days=${days}`),
};

export interface WeatherCurrent {
  temp_c: number | null;
  feels_like_c: number | null;
  humidity: number | null;
  condition: string;
  wind_kmh: number | null;
  wind_dir: string;
  visibility_km: number | null;
  pressure_mb: number | null;
  uv: number | null;
  precip_mm: number | null;
}

export interface WeatherDay {
  date: string;
  max_c: number | null;
  min_c: number | null;
  avg_c: number | null;
  condition: string;
  chance_of_rain: number | null;
  uv: number | null;
}

export interface WeatherHourly {
  time: string;
  temp_c: number;
  feels_like_c: number | null;
  condition: string;
}

export interface WeatherPayload {
  source: string;
  query: string;
  location: string;
  current: WeatherCurrent;
  forecast: WeatherDay[];
  hourly?: WeatherHourly[];
  fallback_note?: string;
}
