/**
 * Pack the Daily Review cockpit into a text snapshot for the user's AI.
 *
 * CLI chat cannot call tools, so the prompt must already contain the board.
 * API chat can still fetch more, but a full snapshot keeps both paths honest.
 * Missing panels are listed at the end so the model does not invent numbers.
 */

import { COMMODITIES, WORLD_INDEX_DEFS } from "@/config/cockpit";
import {
  api,
  type BoardFlowIntraday,
  type ClsTelegraphItem,
  type CnBondYield,
  type DailyDragonTiger,
  type EtfFlow,
  type EtfShares,
  type HsgtLive,
  type IndexQuote,
  type IndustryData,
  type LprData,
  type MarketBreadth,
  type MarketOverview,
  type SectorBoard,
  type ShareholderChanges,
  type ShortTermEmotion,
  type StockFlow,
  type StockRankRow,
} from "@/lib/api";
import { newsTag } from "@/lib/newsTag";
import { peekQuotes, type HubQuote } from "@/lib/quoteHub";
import { peekTelegraphItems, type FeedSource } from "@/lib/telegraphHub";

export const REVIEW_CONTEXT_MAX_CHARS = 24_000;

export type SectorKind = "01" | "02";

export interface ReviewContextInput {
  indices: IndexQuote[];
  overview: MarketOverview | null;
  emotion: ShortTermEmotion | null;
  industry: IndustryData | null;
  lhb: DailyDragonTiger | null;
  etfFlow: EtfFlow | null;
  etfShares: EtfShares | null;
  etfSharesList?: EtfShares[];
  shChg: ShareholderChanges | null;
  lpr: LprData | null;
  bondY: CnBondYield | null;
  hsgt: HsgtLive | null;
  breadth: MarketBreadth | null;
  watchCodes: string[];
  sectorKind?: SectorKind;
  newsSource?: FeedSource;
}

type QuoteLike = { name?: string; price: number; pct: number; amount?: number };

export interface LiveCockpitSlice {
  worldQuotes: Record<string, QuoteLike>;
  commodities: Record<string, QuoteLike>;
  watchQuotes: Record<string, HubQuote>;
  sectorUp: SectorBoard[];
  sectorDown: SectorBoard[];
  boardFlow: BoardFlowIntraday[];
  moneyFlow: StockFlow | null;
  rankHot: StockRankRow[];
  rankUp: StockRankRow[];
  rankDown: StockRankRow[];
  news: { source: FeedSource; items: NewsLine[] };
}

export interface NewsLine {
  time: string;
  title: string;
  tag?: string;
  body?: string;
}

const INDEX_CODES = WORLD_INDEX_DEFS.map((d) => d.code);
const FUT_CODES = COMMODITIES.map((c) => c.code);

export function fmtSignedPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = Number(v);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function fmtYi(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

export function take<T>(rows: T[] | null | undefined, n: number): T[] {
  return (rows ?? []).slice(0, n);
}

function fmtRate(v: number): string {
  const pct = v <= 1 ? v * 100 : v;
  return `${pct.toFixed(1)}%`;
}

function join(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join("\n");
}

function section(title: string, body: string | null | undefined): string | null {
  const t = (body || "").trim();
  return t ? `【${title}】\n${t}` : null;
}

function stockLine(name: string, extra: string): string {
  return `${name} ${extra}`.trim();
}

function quoteLine(name: string, price?: number, pct?: number, amount?: number): string {
  const bits = [
    name,
    price != null && Number.isFinite(price) ? String(price) : "",
    fmtSignedPct(pct),
    amount != null && Number.isFinite(amount) && amount !== 0 ? `额${fmtYi(amount)}` : "",
  ].filter(Boolean);
  return bits.join(" ");
}

const NEWS_N = 12;

export function formatNewsLine(it: ClsTelegraphItem): NewsLine {
  const extra = (it.content || it.summary || "").replace(/\s+/g, " ").trim();
  const tag = newsTag(it.title, extra);
  const time = (it.time || "").slice(11, 16) || (it.time || "").slice(-8, -3);
  const body = extra && extra !== it.title ? extra : "";
  return {
    time,
    title: it.title,
    tag: tag?.label,
    body: body || undefined,
  };
}

function peekNews(src: FeedSource): NewsLine[] {
  return take(peekTelegraphItems(src), NEWS_N).map(formatNewsLine);
}

async function fetchNews(src: FeedSource): Promise<ClsTelegraphItem[] | null> {
  if (src === "lives") {
    const lives = await api.marketLives(1, NEWS_N);
    return (lives.items || []).map((it) => ({
      id: it.id, title: it.title, content: it.content, time: it.time,
    }));
  }
  const cls = await api.clsTelegraph(NEWS_N);
  return cls.items || [];
}

function peekCockpitLive(input: ReviewContextInput): LiveCockpitSlice {
  const src = input.newsSource ?? "cls";
  const watch = input.watchCodes.slice(0, 20);
  const quotes = peekQuotes([...INDEX_CODES, ...FUT_CODES, ...watch]);
  const worldQuotes: Record<string, HubQuote> = {};
  const commodities: Record<string, HubQuote> = {};
  const watchQuotes: Record<string, HubQuote> = {};
  for (const c of INDEX_CODES) if (quotes[c]) worldQuotes[c] = quotes[c];
  for (const c of FUT_CODES) if (quotes[c]) commodities[c] = quotes[c];
  for (const c of watch) if (quotes[c]) watchQuotes[c] = quotes[c];
  return {
    worldQuotes,
    commodities,
    watchQuotes,
    sectorUp: [],
    sectorDown: [],
    boardFlow: [],
    moneyFlow: null,
    rankHot: [],
    rankUp: [],
    rankDown: [],
    news: { source: src, items: peekNews(src) },
  };
}

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    console.warn("[review-context] live fetch failed", e);
    return null;
  }
}

/** Fill panels that are not in the review-snapshot hook (same APIs the cells poll). */
export async function fetchCockpitLive(input: ReviewContextInput): Promise<LiveCockpitSlice> {
  const live = peekCockpitLive(input);
  const kind = input.sectorKind ?? "01";
  const needWorld = INDEX_CODES.filter((c) => !live.worldQuotes[c]);
  const needComm = FUT_CODES.filter((c) => !live.commodities[c]);

  const src = input.newsSource ?? "cls";
  const [up, down, hot, rankUp, rankDown, flows, money, world, comm, news] = await Promise.all([
    settle(api.sectorBoards(kind, "0", 12)),
    settle(api.sectorBoards(kind, "1", 12)),
    settle(api.stockRank("amount", 0, 10)),
    settle(api.stockRank("changepercent", 0, 10)),
    settle(api.stockRank("changepercent", 1, 10)),
    settle(api.boardFlowIntraday(12, false)),
    settle(api.stockFlow(12)),
    needWorld.length ? settle(api.marketQuotes(needWorld)) : Promise.resolve(null),
    needComm.length ? settle(api.commodities(needComm.join(","))) : Promise.resolve(null),
    settle(fetchNews(src)),
  ]);

  live.sectorUp = up ?? [];
  live.sectorDown = down ?? [];
  live.rankHot = hot ?? [];
  live.rankUp = rankUp ?? [];
  live.rankDown = rankDown ?? [];
  live.boardFlow = flows ?? [];
  live.moneyFlow = money;
  if (world) Object.assign(live.worldQuotes, world);
  if (comm) Object.assign(live.commodities, comm);
  if (news?.length) live.news = { source: src, items: take(news, NEWS_N).map(formatNewsLine) };
  return live;
}

function worldSection(input: ReviewContextInput, live: LiveCockpitSlice): string | null {
  const fromHub = WORLD_INDEX_DEFS.map((d) => {
    const q = live.worldQuotes[d.code];
    if (!q) return null;
    return quoteLine(q.name || d.label, q.price, q.pct, "amount" in q ? q.amount : undefined);
  }).filter((x): x is string => Boolean(x));
  if (fromHub.length) return fromHub.join("；");
  if (!input.indices.length) return null;
  return input.indices
    .map((i) => quoteLine(i.name, i.price, i.change_pct))
    .join("；");
}

function sentimentSection(input: ReviewContextInput): string | null {
  const s = input.overview?.sentiment;
  const b = input.breadth;
  const bits: string[] = [];
  if (s && (s.up + s.down + s.flat) > 0) {
    bits.push(`上涨${s.up} 平${s.flat} 下跌${s.down}；涨停${s.zt}(真实${s.zt_real}) 跌停${s.dt}(真实${s.dt_real})`);
    if (s.breadth) bits.push(`广度 ${s.breadth}`);
    if (s.speculation) bits.push(`投机 ${s.speculation}`);
    if (s.date) bits.push(`日期 ${s.date}`);
  }
  if (b && b.n) {
    const pcts = [
      b.p10 != null ? `p10 ${fmtSignedPct(b.p10)}` : "",
      b.p25 != null ? `p25 ${fmtSignedPct(b.p25)}` : "",
      b.p50 != null ? `p50 ${fmtSignedPct(b.p50)}` : "",
      b.p75 != null ? `p75 ${fmtSignedPct(b.p75)}` : "",
      b.p90 != null ? `p90 ${fmtSignedPct(b.p90)}` : "",
      b.avg != null ? `均 ${fmtSignedPct(b.avg)}` : "",
    ].filter(Boolean);
    bits.push(`全A分位 n=${b.n}${pcts.length ? ` ${pcts.join(" ")}` : ""}`);
    if (b.histogram?.length) {
      bits.push(`分布 ${b.histogram.map((h) => `${h.label}:${h.count}`).join(" ")}`);
    }
  }
  return bits.length ? bits.join("\n") : null;
}

function emotionSection(e: ShortTermEmotion | null): string | null {
  if (!e) return null;
  const bits = [
    `涨停${e.zt_count} 跌停${e.dt_count} 炸板${e.zb_count} 昨涨停${e.yzt_count}`,
    `最高连板${e.max_boards} 连板家数${e.lianban_count}`,
    e.seal_rate != null ? `封板率${fmtRate(e.seal_rate)}` : "",
    e.break_rate != null ? `炸板率${fmtRate(e.break_rate)}` : "",
    e.promotion_rate != null ? `晋级率${fmtRate(e.promotion_rate)}` : "",
  ].filter(Boolean);
  if (e.seals) {
    bits.push(`封板 真${e.seals.sealed_up}/假${e.seals.fake_up} 跌停封 真${e.seals.sealed_down}/假${e.seals.fake_down}`);
  }
  const up = take(e.zt_stocks?.length ? e.zt_stocks : e.lianban_stocks, 8);
  if (up.length) {
    bits.push(`连板 ${up.map((s) => `${s.name}(${s.boards}板 ${fmtSignedPct(s.pct)} ${s.industry || ""})`.trim()).join("；")}`);
  }
  const down = take(e.dt_stocks, 6);
  if (down.length) {
    bits.push(`跌停 ${down.map((s) => `${s.name}(${s.boards}跌 ${s.industry || ""})`.trim()).join("；")}`);
  }
  return bits.join("\n");
}

function boardLine(b: SectorBoard): string {
  const lead = b.lead_name
    ? ` 领${b.lead_name}${b.lead_pct != null ? fmtSignedPct(b.lead_pct, 1) : ""}`
    : "";
  return `${b.name} ${fmtSignedPct(b.pct)}${lead}`;
}

function sectorSection(input: ReviewContextInput, live: LiveCockpitSlice): string | null {
  const kind = input.sectorKind === "02" ? "概念" : "行业";
  const bits: string[] = [];
  if (live.sectorUp.length) bits.push(`领涨${kind} ${take(live.sectorUp, 8).map(boardLine).join("；")}`);
  if (live.sectorDown.length) bits.push(`领跌${kind} ${take(live.sectorDown, 8).map(boardLine).join("；")}`);
  if (!bits.length && input.industry) {
    const top = take(input.industry.top, 8).map((r) => `${r.name} ${fmtSignedPct(r.change_pct)}`);
    const bot = take(input.industry.bottom, 8).map((r) => `${r.name} ${fmtSignedPct(r.change_pct)}`);
    if (top.length) bits.push(`行业强 ${top.join("；")}`);
    if (bot.length) bits.push(`行业弱 ${bot.join("；")}`);
  }
  return bits.length ? bits.join("\n") : null;
}

function flowSection(live: LiveCockpitSlice): string | null {
  const rows = live.boardFlow.filter((r) => Number.isFinite(r.net_in));
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.net_in - a.net_in);
  const inn = take(sorted.filter((r) => r.net_in > 0), 8)
    .map((r) => `${r.name} ${fmtYi(r.net_in)}`);
  const out = take([...sorted].reverse().filter((r) => r.net_in < 0), 8)
    .map((r) => `${r.name} ${fmtYi(r.net_in)}`);
  const bits: string[] = [];
  if (inn.length) bits.push(`流入 ${inn.join("；")}`);
  if (out.length) bits.push(`流出 ${out.join("；")}`);
  return bits.length ? bits.join("\n") : null;
}

function moneySection(live: LiveCockpitSlice): string | null {
  const rows = take(live.moneyFlow?.rows, 10);
  if (!rows.length) return null;
  return rows
    .map((r) => stockLine(r.name, `${fmtSignedPct(r.change_pct)} 主力${fmtYi(r.main_net)} ${r.main_pct != null ? `${r.main_pct.toFixed(1)}%` : ""}`.trim()))
    .join("；");
}

function rankSection(live: LiveCockpitSlice): string | null {
  const line = (rows: StockRankRow[]) =>
    take(rows, 8).map((s) => stockLine(s.name, `${fmtSignedPct(s.pct)} 额${fmtYi(s.amount)}`)).join("；");
  const bits: string[] = [];
  if (live.rankHot.length) bits.push(`热门 ${line(live.rankHot)}`);
  if (live.rankUp.length) bits.push(`涨幅 ${line(live.rankUp)}`);
  if (live.rankDown.length) bits.push(`跌幅 ${line(live.rankDown)}`);
  return bits.length ? bits.join("\n") : null;
}

function commoditySection(live: LiveCockpitSlice): string | null {
  const lines = COMMODITIES.map((c) => {
    const q = live.commodities[c.code];
    if (!q) return null;
    return quoteLine(q.name || c.label, q.price, q.pct);
  }).filter((x): x is string => Boolean(x));
  return lines.length ? lines.join("；") : null;
}

function watchSection(input: ReviewContextInput, live: LiveCockpitSlice): string | null {
  const codes = take(input.watchCodes, 20);
  if (!codes.length) return null;
  return codes.map((c) => {
    const q = live.watchQuotes[c];
    return q ? quoteLine(q.name || c, q.price, q.pct, q.amount) : c;
  }).join("；");
}

function newsSection(live: LiveCockpitSlice): string | null {
  if (!live.news.items.length) return null;
  const label = live.news.source === "lives" ? "新浪/见闻" : "财联社";
  const blocks = live.news.items.map((it, i) => {
    const tag = it.tag ? `[${it.tag}] ` : "";
    const time = it.time ? `${it.time} ` : "";
    const head = `${i + 1}. ${time}${tag}${it.title}`;
    return it.body ? `${head}\n${it.body}` : head;
  });
  return `${label}\n${blocks.join("\n")}`;
}

function lhbSection(lhb: DailyDragonTiger | null): string | null {
  const rows = take(lhb?.stocks, 8);
  if (!rows.length) return null;
  const head = lhb?.date ? `${lhb.date} 共${lhb.total_records}条` : "";
  const body = rows
    .map((s) => `${s.name} ${fmtSignedPct(s.change_pct)} 净买${s.net_buy_wan.toFixed(0)}万 ${s.reason || ""}`.trim())
    .join("；");
  return [head, body].filter(Boolean).join("\n");
}

function moneyExtraSection(input: ReviewContextInput): string | null {
  const bits: string[] = [];
  if (input.hsgt?.latest) {
    const l = input.hsgt.latest;
    bits.push(`北向 ${l.time || ""} 沪${l.hgt_yi ?? "—"}亿 深${l.sgt_yi ?? "—"}亿`.trim());
  }
  const etf = input.etfFlow?.rows ?? [];
  if (etf.length) {
    const inn = take([...etf].sort((a, b) => b.main_net_inflow - a.main_net_inflow), 5)
      .map((r) => `${r.name} ${fmtYi(r.main_net_inflow)} ${fmtSignedPct(r.change_pct)}`);
    const out = take([...etf].sort((a, b) => a.main_net_inflow - b.main_net_inflow), 5)
      .map((r) => `${r.name} ${fmtYi(r.main_net_inflow)} ${fmtSignedPct(r.change_pct)}`);
    bits.push(`ETF流入 ${inn.join("；")}`);
    bits.push(`ETF流出 ${out.join("；")}`);
  }
  const shareList = input.etfSharesList?.length
    ? input.etfSharesList
    : (input.etfShares ? [input.etfShares] : []);
  for (const sh of shareList) {
    if (!sh?.latest) continue;
    bits.push(`${sh.name || sh.code} 份额${sh.latest.shares_yi.toFixed(2)}亿 日增${sh.chg_yi ?? "—"}亿`);
  }
  const chg = take(input.shChg?.rows, 5);
  if (chg.length) {
    bits.push(`增减持 ${chg.map((r) => `${r.name} ${r.change_type} ${r.person}`).join("；")}`);
  }
  if (input.lpr?.latest) {
    bits.push(`LPR ${input.lpr.latest.date} 1Y ${input.lpr.latest.one_year}% 5Y ${input.lpr.latest.five_year}%`);
  }
  if (input.bondY?.terms && Object.keys(input.bondY.terms).length) {
    const t = input.bondY.terms;
    const pick = ["2Y", "10Y", "30Y"].map((k) => (t[k] != null ? `${k} ${t[k]}%` : "")).filter(Boolean);
    const spr = input.bondY.spread_10_2 != null ? ` 10Y-2Y ${input.bondY.spread_10_2.toFixed(2)}` : "";
    bits.push(`国债 ${input.bondY.date} ${pick.join(" ")}${spr}`.trim());
  }
  return bits.length ? bits.join("\n") : null;
}

const EXPECTED = [
  "全球指数",
  "涨跌分布",
  "涨跌停",
  "板块热点",
  "板块资金",
  "主力净流入",
  "个股榜单",
  "大宗商品",
  "实时热点",
  "自选",
  "龙虎榜",
  "资金利率",
] as const;

export function missingPanels(text: string): string[] {
  return EXPECTED.filter((name) => !text.includes(`【${name}】`));
}

function assembleReviewContext(input: ReviewContextInput, slice: LiveCockpitSlice): string {
  const body = join([
    section("全球指数", worldSection(input, slice)),
    section("涨跌分布", sentimentSection(input)),
    section("涨跌停", emotionSection(input.emotion)),
    section("板块热点", sectorSection(input, slice)),
    section("板块资金", flowSection(slice)),
    section("主力净流入", moneySection(slice)),
    section("个股榜单", rankSection(slice)),
    section("大宗商品", commoditySection(slice)),
    section("实时热点", newsSection(slice)),
    section("自选", watchSection(input, slice)),
    section("龙虎榜", lhbSection(input.lhb)),
    section("资金利率", moneyExtraSection(input)),
  ]);
  const miss = missingPanels(body);
  const footer = miss.length
    ? `\n【未取到】${miss.join("、")}。这些格子没有数据, 不要编造数字。`
    : "";
  return (body || "（复盘看板数据尚未加载）") + footer;
}

export function buildReviewContext(input: ReviewContextInput, live?: LiveCockpitSlice): string {
  const slice = live ?? peekCockpitLive(input);
  let newsItems = slice.news.items;
  let packed = { ...slice, news: { ...slice.news, items: newsItems } };
  let text = assembleReviewContext(input, packed);
  // Prefer dropping older headlines over cutting a body mid-sentence.
  while (text.length > REVIEW_CONTEXT_MAX_CHARS && newsItems.length > 3) {
    newsItems = newsItems.slice(0, -1);
    packed = { ...slice, news: { ...slice.news, items: newsItems } };
    text = assembleReviewContext(input, packed);
  }
  if (text.length <= REVIEW_CONTEXT_MAX_CHARS) return text;
  return `${text.slice(0, REVIEW_CONTEXT_MAX_CHARS)}\n…(快照已截断)`;
}

export async function collectReviewContext(input: ReviewContextInput): Promise<string> {
  const live = await fetchCockpitLive(input);
  return buildReviewContext(input, live);
}

export const REVIEW_PROMPT_TASK =
  "请用中文做当天大盘复盘, 按下面顺序写, 有数据才写、没数据就跳过:\n" +
  "1. 整体涨跌与主要指数(含外围)\n" +
  "2. 涨跌分布 / 情绪 / 涨跌停\n" +
  "3. 板块与资金(领涨领跌、主力净流入)\n" +
  "4. 个股榜与龙虎(只陈述公开榜单, 不荐股)\n" +
  "5. 实时热点/快讯全文里与盘面相关的客观信息\n" +
  "只做客观陈述与多视角分析, 不预测涨跌、不推荐任何标的、不构成投资建议。" +
  "数字必须来自上面的快照, 不要编造。";
