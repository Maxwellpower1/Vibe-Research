import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Loader2, AlertCircle, RefreshCw, ArrowDownUp, TrendingUp, TrendingDown, Flame, Trophy, Activity, ShieldAlert, Search } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { SectionHeader, ChipGroup, Chip } from "@/components/ui/SectionHeader";
import { SegmentNav, useSegment } from "@/components/ui/SegmentNav";
import {
  api, ApiError, type IndexQuote, type MarketOverview, type ShortTermEmotion,
  type TurnoverTop, type GlobalIndex, type DailyDragonTiger, type BoardFlow, type HsgtLive,
  type HotList, type MonitorPool, type AnomalyPool, type LimitPool, type IndustryData,
  type ThsLimitUpPool, type IwencaiItem, type EtfFlow, type ShareholderChanges,
  type LprData, type CnBondYield,
} from "@/lib/api";
import { hasLlm, chatStream } from "@/lib/llm";
import { SaveNoteButton } from "@/components/ui/SaveNoteButton";
import { storageGet, storageSet } from "@/lib/storage";
import { cn } from "@/lib/utils";

const TOP_AUTO_MS = 30_000;
const TOP_AUTO_KEY = "ashare.review.topAuto";

// A股红涨绿跌。全球市场（美股/港股指数）**也沿用红涨**——与整个看板及东财等中国平台一致，
// 对中国用户最不易看错（Simon 2026-07-05 确认；非国际绿涨惯例，是有意选择，勿改）。
const pctColor = (p: number) => (p > 0 ? "text-danger" : p < 0 ? "text-success" : "text-muted-foreground");
const pctTone = (p: number) => (p > 0 ? "up" : p < 0 ? "down" : "flat") as "up" | "down" | "flat";
const fmt = (v: number) => v.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const yi = (v: number | null) => (v == null ? "—" : `${fmt(v / 1e8)} 亿`); // 元 → 亿

function PctChip({ pct }: { pct: number | null | undefined }) {
  if (pct == null || !Number.isFinite(pct)) return <span className="pct-chip flat">—</span>;
  return (
    <span className={cn("pct-chip", pctTone(pct))}>
      {pct > 0 ? "+" : ""}{pct}%
    </span>
  );
}

const SEG_KEYS = ["boards", "money", "risk"] as const;

export function DailyReview({ embedded = false }: { embedded?: boolean } = {}) {
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [idxErr, setIdxErr] = useState(false);
  const [review, setReview] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [needConfig, setNeedConfig] = useState(false);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [emotion, setEmotion] = useState<ShortTermEmotion | null>(null);
  const [turnover, setTurnover] = useState<TurnoverTop | null>(null);
  const [lhb, setLhb] = useState<DailyDragonTiger | null>(null);
  const [globalIdx, setGlobalIdx] = useState<GlobalIndex[]>([]);
  const [boardFlow, setBoardFlow] = useState<BoardFlow | null>(null);
  const [boardType, setBoardType] = useState<"industry" | "concept" | "region">("industry");
  const [boardPeriod, setBoardPeriod] = useState<"today" | "5d" | "10d">("today");
  const [hsgt, setHsgt] = useState<HsgtLive | null>(null);
  const [hot, setHot] = useState<HotList | null>(null);
  const [monitor, setMonitor] = useState<MonitorPool | null>(null);
  const [anomaly, setAnomaly] = useState<AnomalyPool | null>(null);
  const [limitPool, setLimitPool] = useState<LimitPool | null>(null);
  const [limitKind, setLimitKind] = useState<"zt" | "zb" | "dt" | "yzt" | "jm">("zt");
  const [thsLimit, setThsLimit] = useState<ThsLimitUpPool | null>(null);
  const [industry, setIndustry] = useState<IndustryData | null>(null);
  const [iwencaiReady, setIwencaiReady] = useState(false);
  const [iwencaiQ, setIwencaiQ] = useState("");
  const [iwencaiBusy, setIwencaiBusy] = useState(false);
  const [iwencaiErr, setIwencaiErr] = useState<string | null>(null);
  const [iwencaiItems, setIwencaiItems] = useState<IwencaiItem[]>([]);
  const [etfFlow, setEtfFlow] = useState<EtfFlow | null>(null);
  const [etfSort, setEtfSort] = useState<"net_inflow" | "change_pct">("net_inflow");
  const [shChg, setShChg] = useState<ShareholderChanges | null>(null);
  const [shType, setShType] = useState<"all" | "增持" | "减持">("all");
  const [lpr, setLpr] = useState<LprData | null>(null);
  const [bondY, setBondY] = useState<CnBondYield | null>(null);
  const [moneyDone, setMoneyDone] = useState(false);

  // 各数据块请求是否已结束：区分「加载中」与「数据源暂不可用」（非交易时段/被限流时后端返回空）
  const [ovDone, setOvDone] = useState(false);
  const [emoDone, setEmoDone] = useState(false);
  const [toDone, setToDone] = useState(false);
  const [lhbDone, setLhbDone] = useState(false);
  const [extraDone, setExtraDone] = useState(false);
  const [topRefreshing, setTopRefreshing] = useState(false);
  const [topUpdatedAt, setTopUpdatedAt] = useState<Date | null>(null);
  const [topAuto, setTopAuto] = useState(() => storageGet(TOP_AUTO_KEY) !== "0");
  const topRefreshingRef = useRef(false);

  const [seg, setSeg] = useSegment("ashare.review", [...SEG_KEYS], "boards");

  const topUpdatedLabel = topUpdatedAt
    ? topUpdatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    : (topRefreshing ? "更新中…" : "—");

  /** Refresh row1 + row2 only: 全球 / 盘面一眼 / 短线 / 行业 / 热榜 / 成交额. */
  const refreshTopRows = useCallback(() => {
    if (topRefreshingRef.current) return;
    topRefreshingRef.current = true;
    setTopRefreshing(true);
    setIdxErr(false);
    setOvDone(false);
    setEmoDone(false);
    setToDone(false);
    setExtraDone(false);

    const pIdx = api.indices().then(setIndices).catch(() => { setIdxErr(true); setIndices([]); });
    const pGlobal = api.globalIndices().then(setGlobalIdx).catch(() => setGlobalIdx([]));
    const pOv = api.marketOverview().then(setOverview).catch(() => setOverview(null)).finally(() => setOvDone(true));
    const pEmo = api.emotion().then(setEmotion).catch(() => setEmotion(null)).finally(() => setEmoDone(true));
    const pTo = api.turnoverTop().then(setTurnover).catch(() => setTurnover(null)).finally(() => setToDone(true));
    const pExtra = Promise.all([
      api.hsgt().catch(() => null),
      api.hotList("ths", "hour", 25).catch(() => null),
      api.industry(20).catch(() => null),
    ]).then(([h, ht, ind]) => {
      setHsgt(h);
      setHot(ht);
      setIndustry(ind);
    }).finally(() => setExtraDone(true));

    void Promise.all([pIdx, pGlobal, pOv, pEmo, pTo, pExtra]).finally(() => {
      setTopUpdatedAt(new Date());
      setTopRefreshing(false);
      topRefreshingRef.current = false;
    });
  }, []);

  useEffect(() => {
    storageSet(TOP_AUTO_KEY, topAuto ? "1" : "0");
  }, [topAuto]);

  useEffect(() => {
    if (!topAuto) return;
    const t = window.setInterval(() => refreshTopRows(), TOP_AUTO_MS);
    return () => window.clearInterval(t);
  }, [topAuto, refreshTopRows]);

  /** Full page bootstrap (top rows + tab panels below). */
  const loadIndices = () => {
    setOvDone(false); setEmoDone(false); setToDone(false); setLhbDone(false); setExtraDone(false);
    setIdxErr(false);
    const pIdx = api.indices().then(setIndices).catch(() => setIdxErr(true));
    const pGlobal = api.globalIndices().then(setGlobalIdx).catch(() => {});
    const pOv = api.marketOverview().then(setOverview).catch(() => {}).finally(() => setOvDone(true));
    const pEmo = api.emotion().then(setEmotion).catch(() => {}).finally(() => setEmoDone(true));
    const pTo = api.turnoverTop().then(setTurnover).catch(() => {}).finally(() => setToDone(true));
    api.dailyDragonTiger({ top: 40 }).then(setLhb).catch(() => setLhb(null)).finally(() => setLhbDone(true));
    const pLimit = limitKind === "jm"
      ? api.thsLimitUp().then((d) => { setThsLimit(d); return null; }).catch(() => { setThsLimit(null); return null; })
      : api.limitPools(limitKind, 40).then((d) => { setLimitPool(d); return d; }).catch(() => null);
    const pExtra = Promise.all([
      api.hsgt().catch(() => null),
      api.hotList("ths", "hour", 25).catch(() => null),
      api.stockMonitor().catch(() => null),
      api.priceAnomaly(40).catch(() => null),
      pLimit,
      api.industry(20).catch(() => null),
      api.boardFlow(boardType, boardPeriod, 20).catch(() => null),
    ]).then(([h, ht, mo, an, , ind, bf]) => {
      setHsgt(h); setHot(ht); setMonitor(mo); setAnomaly(an);
      setIndustry(ind); setBoardFlow(bf);
    }).finally(() => setExtraDone(true));

    void Promise.all([pIdx, pGlobal, pOv, pEmo, pTo, pExtra]).finally(() => {
      setTopUpdatedAt(new Date());
    });
  };

  // 数据块占位：请求没回来 = 加载中；回来了但为空 = 数据源暂不可用（别让用户干等）
  const pending = (done: boolean) => (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      {!done && <Loader2 className="h-4 w-4 animate-spin text-primary/70" />}
      <p className="text-sm text-muted-foreground/65">
        {done ? "暂无数据：非交易时段或数据源暂时不可用，可点刷新重试" : "加载中…"}
      </p>
    </div>
  );

  useEffect(() => {
    loadIndices();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- bootstrap once

  useEffect(() => {
    api.boardFlow(boardType, boardPeriod, 20).then(setBoardFlow).catch(() => setBoardFlow(null));
  }, [boardType, boardPeriod]);

  useEffect(() => {
    if (limitKind === "jm") {
      api.thsLimitUp().then(setThsLimit).catch(() => setThsLimit(null));
      return;
    }
    api.limitPools(limitKind, 40).then(setLimitPool).catch(() => setLimitPool(null));
  }, [limitKind]);

  /** Money-tab extras: ETF flow / insider changes / LPR / CN bond yield (lazy). */
  useEffect(() => {
    if (seg !== "money") return;
    setMoneyDone(false);
    Promise.all([
      api.etfFlow(etfSort, 40).catch(() => null),
      api.shareholderChanges({ changeType: shType, limit: 40 }).catch(() => null),
      api.lpr(730).catch(() => null),
      api.cnBondYield("treasury").catch(() => null),
    ]).then(([ef, sc, lp, by]) => {
      setEtfFlow(ef);
      setShChg(sc);
      setLpr(lp);
      setBondY(by);
    }).finally(() => setMoneyDone(true));
  }, [seg, etfSort, shType]);

  useEffect(() => {
    api.iwencaiStatus().then((s) => setIwencaiReady(!!s.configured)).catch(() => setIwencaiReady(false));
  }, []);

  const runIwencai = async () => {
    const q = iwencaiQ.trim();
    if (!q) return;
    setIwencaiBusy(true);
    setIwencaiErr(null);
    try {
      const r = await api.iwencaiSearch(q, "report", 20);
      setIwencaiItems(r.items || []);
      if (!(r.items || []).length) setIwencaiErr("无结果");
    } catch (e) {
      setIwencaiItems([]);
      setIwencaiErr(e instanceof ApiError ? e.message : "问财搜索失败");
    } finally {
      setIwencaiBusy(false);
    }
  };

  const today = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

  const dataSummary = indices.length
    ? indices.map((i) => `${i.name} ${i.price}（${i.change_pct > 0 ? "+" : ""}${i.change_pct}%）`).join("；")
    : "（指数数据未取到）";

  const runReview = async () => {
    setReviewErr(null);
    setNeedConfig(false);
    if (!hasLlm()) { setNeedConfig(true); return; }
    setReviewLoading(true);
    setReview("");
    const prompt =
      `以下是今天 A 股大盘的客观数据：\n${dataSummary}\n\n` +
      "请用中文做一段当天大盘复盘：整体涨跌、主要指数表现、盘面值得注意的点。" +
      "只做客观陈述与多视角分析，不预测涨跌、不推荐任何标的、不构成投资建议。";
    try {
      await chatStream([{ role: "user", content: prompt }], `今日大盘数据：${dataSummary}`, {
        onDelta: (t) => setReview((r) => r + t),
      });
    } catch (e) {
      setReviewErr(e instanceof ApiError ? e.message : "复盘失败");
    } finally {
      setReviewLoading(false);
    }
  };

  const sentiment = overview?.sentiment;
  const sectors = overview?.sectors || [];
  const sentCells = sentiment ? [
    { k: "涨停", v: sentiment.zt, up: true },
    { k: "真实涨停", v: sentiment.zt_real, up: true },
    { k: "跌停", v: sentiment.dt, up: false },
    { k: "真实跌停", v: sentiment.dt_real, up: false },
    { k: "活跃度", v: sentiment.active, up: null },
  ] : [];
  const breadthTotal = sentiment
    ? Math.max(1, (sentiment.up || 0) + (sentiment.down || 0) + (sentiment.flat || 0))
    : 1;
  const upShare = sentiment ? (sentiment.up || 0) / breadthTotal : 0;
  const downShare = sentiment ? (sentiment.down || 0) / breadthTotal : 0;
  const flatShare = sentiment ? (sentiment.flat || 0) / breadthTotal : 0;

  const askAi = (
    <>
      <button
        type="button"
        onClick={runReview}
        disabled={reviewLoading}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-2.5 py-1.5 text-[11px] font-medium text-primary shadow-glow hover:bg-primary/25 disabled:opacity-50 sm:text-xs"
      >
        {reviewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {review ? "重新复盘" : "AI 复盘"}
      </button>
      <AskAiButton
        context={`今日大盘数据：${dataSummary}`}
        label="问 AI"
        suggestions={["今天大盘怎么走", "哪些指数领涨领跌", "盘面有什么值得注意"]}
      />
    </>
  );

  const showReviewPanel = Boolean(review || reviewLoading || needConfig || reviewErr);

  const indTop = industry?.top?.[0];
  const indBot = industry?.bottom?.[0];
  const hgtYi = hsgt?.latest?.hgt_yi;

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="每日复盘"
          subtitle={`${today} · 大盘 / 情绪 / 板块资金一屏看全，交给你的 AI 做复盘`}
        />
      )}

      <div className="mb-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(220px,26%)_minmax(0,1fr)_minmax(260px,30%)]">
        {/* 全球指数 */}
        <GlassCard className="!mb-0 !p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5">
            <p className="text-sm font-semibold text-foreground">全球</p>
            <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">{topUpdatedLabel}</p>
          </div>

          {indices.length === 0 && globalIdx.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground/65">
              {idxErr ? "指数未接通，可点刷新重试" : "加载中…"}
            </p>
          ) : (
            <div className="max-h-[22rem] overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {["指数", "市场", "点位", "涨跌%"].map((h) => (
                      <th key={h} className={h === "点位" || h === "涨跌%" ? "num" : ""}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {indices.map((ix) => (
                    <tr key={`a-${ix.name}`}>
                      <td className="font-medium">{ix.name}</td>
                      <td className="text-muted-foreground">A股</td>
                      <td className={cn("num font-mono font-semibold", pctColor(ix.change_pct))}>{ix.price}</td>
                      <td className="num"><PctChip pct={ix.change_pct} /></td>
                    </tr>
                  ))}
                  {globalIdx.map((g) => (
                    <tr key={g.key}>
                      <td className="font-medium">{g.name}</td>
                      <td className="text-muted-foreground">{g.region}</td>
                      <td className={cn("num font-mono font-semibold", g.change_pct == null ? "text-foreground" : pctColor(g.change_pct))}>
                        {g.price ?? "—"}
                      </td>
                      <td className="num"><PctChip pct={g.change_pct} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>

        {/* 盘面一眼 + 市场情绪（常开） */}
        <div className="flex h-full min-h-0 flex-col rounded-2xl border border-border/60 bg-muted/15 p-3 sm:p-3.5">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <p className="text-sm font-semibold text-foreground">盘面一眼 · 市场情绪</p>
              <button
                type="button"
                onClick={() => refreshTopRows()}
                disabled={topRefreshing}
                className="inline-flex items-center gap-1 rounded-lg border border-border/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-primary disabled:opacity-50"
                title="刷新第一行与第二行：全球 / 盘面 / 短线 / 行业 / 热榜 / 成交额"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", topRefreshing && "animate-spin")} />
                {topRefreshing ? "刷新中" : "刷新"}
              </button>
              <button
                type="button"
                onClick={() => setTopAuto((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px]",
                  topAuto
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/50 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
                title={topAuto ? "关闭自动更新（约 30 秒）" : "开启自动更新（约 30 秒）"}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", topAuto ? "bg-primary animate-pulse" : "bg-muted-foreground/40")} />
                {topAuto ? "自动" : "手动"}
              </button>
              {askAi}
            </div>
            <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">{topUpdatedLabel}</p>
          </div>

          {!sentiment?.breadth && !ovDone ? (
            <p className="py-6 text-center text-sm text-muted-foreground/65">加载中…</p>
          ) : !sentiment?.breadth ? (
            <p className="py-6 text-center text-sm text-muted-foreground/65">市场情绪暂不可用，可点刷新重试</p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { k: "大盘宽度", v: sentiment.breadth, hint: "冰点 / 偏弱 / 中性 / 偏强 / 普涨" },
                  { k: "题材投机", v: sentiment.speculation, hint: "冰点 / 普通 / 活跃 / 亢奋" },
                ].map((m) => (
                  <div key={m.k} className="rounded-xl border border-border/40 bg-gradient-to-br from-primary/10 to-muted/20 px-3 py-2.5">
                    <p className="text-xs text-muted-foreground">{m.k}</p>
                    <p className="mt-0.5 text-2xl font-bold tracking-tight text-primary">{m.v}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground/55">{m.hint}</p>
                  </div>
                ))}
              </div>
              {/* 上涨 / 下跌联动可视化 */}
              <div className="mt-2 rounded-xl border border-border/40 bg-card/40 px-3 py-2.5">
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0 text-left">
                    <p className="text-xs text-muted-foreground">上涨家数</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-danger">{sentiment.up}</p>
                    <p className="text-[11px] text-danger/80">{(upShare * 100).toFixed(1)}%</p>
                  </div>
                  <div className="min-w-0 text-center">
                    <p className="text-xs text-muted-foreground">平盘</p>
                    <p className="font-mono text-sm font-semibold tabular-nums text-muted-foreground">{sentiment.flat}</p>
                    <p className="text-[11px] text-muted-foreground/70">{(flatShare * 100).toFixed(1)}%</p>
                  </div>
                  <div className="min-w-0 text-right">
                    <p className="text-xs text-muted-foreground">下跌家数</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-success">{sentiment.down}</p>
                    <p className="text-[11px] text-success/80">{(downShare * 100).toFixed(1)}%</p>
                  </div>
                </div>
                <div
                  className="mt-2.5 flex h-3.5 overflow-hidden rounded-full bg-muted/40"
                  title={`上涨 ${sentiment.up} · 平盘 ${sentiment.flat} · 下跌 ${sentiment.down}`}
                >
                  <div
                    className="bg-danger transition-[width] duration-500 ease-out"
                    style={{ width: `${upShare * 100}%` }}
                  />
                  <div
                    className="bg-muted-foreground/35 transition-[width] duration-500 ease-out"
                    style={{ width: `${flatShare * 100}%` }}
                  />
                  <div
                    className="bg-success transition-[width] duration-500 ease-out"
                    style={{ width: `${downShare * 100}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground/60">
                  <span>红涨占比</span>
                  <span className="font-mono tabular-nums">
                    {sentiment.up}:{sentiment.down}
                    {sentiment.up + sentiment.down > 0
                      ? ` · 涨跌比 ${(sentiment.up / Math.max(1, sentiment.down)).toFixed(2)}`
                      : ""}
                  </span>
                  <span>绿跌占比</span>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {sentCells.map((c) => (
                  <div key={c.k} className="min-w-0 rounded-xl border border-border/40 bg-card/40 px-2 py-2 text-center">
                    <p className="truncate text-xs text-muted-foreground">{c.k}</p>
                    <p className={cn(
                      "mt-0.5 truncate font-mono text-base font-bold tabular-nums",
                      c.up === null ? "text-foreground" : c.up ? "text-danger" : "text-success",
                    )}>{c.v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {hgtYi != null && (
                  <div className="min-w-0 rounded-xl border border-border/40 bg-card/40 px-2.5 py-2">
                    <p className="text-xs text-muted-foreground">北向沪</p>
                    <p className={cn("mt-0.5 font-mono text-base font-bold tabular-nums", pctColor(hgtYi))}>
                      {hgtYi > 0 ? "+" : ""}{fmt(hgtYi)} 亿
                    </p>
                  </div>
                )}
                {indTop && (
                  <div className="min-w-0 rounded-xl border border-border/40 bg-card/40 px-2.5 py-2">
                    <p className="text-xs text-muted-foreground">行业强</p>
                    <p className={cn("mt-0.5 truncate text-base font-bold", pctColor(indTop.change_pct))}>{indTop.name}</p>
                    <p className="text-xs text-muted-foreground/70">
                      {indTop.change_pct > 0 ? "+" : ""}{indTop.change_pct}%
                    </p>
                  </div>
                )}
                {indBot && (
                  <div className="min-w-0 rounded-xl border border-border/40 bg-card/40 px-2.5 py-2">
                    <p className="text-xs text-muted-foreground">行业弱</p>
                    <p className={cn("mt-0.5 truncate text-base font-bold", pctColor(indBot.change_pct))}>{indBot.name}</p>
                    <p className="text-xs text-muted-foreground/70">
                      {indBot.change_pct > 0 ? "+" : ""}{indBot.change_pct}%
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 短线：常开在顶部右侧 */}
        <GlassCard className="!mb-0 !p-0 overflow-hidden lg:col-span-2 xl:col-span-1">
          <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <Flame className="h-3.5 w-3.5 text-primary/80" /> 短线
            </p>
            <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">{topUpdatedLabel}</p>
          </div>
          {!emotion || emotion.zt_count === undefined ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground/65">
              {emoDone ? "暂无短线数据" : "加载中…"}
            </p>
          ) : (
            <div className="grid max-h-[22rem] grid-cols-[9.5rem_minmax(0,1fr)]">
              {/* 指标竖排靠左 */}
              <div className="space-y-0.5 overflow-auto border-r border-border/40 p-2">
                {[
                  { k: "涨停", v: `${emotion.zt_count}`, cls: "text-danger" },
                  { k: "跌停", v: `${emotion.dt_count}`, cls: "text-success" },
                  { k: "最高板", v: `${emotion.max_boards}`, cls: "text-primary" },
                  { k: "连板+", v: `${emotion.lianban_count}`, cls: "text-primary" },
                  {
                    k: "封板率",
                    v: emotion.seal_rate == null ? "—" : `${(emotion.seal_rate * 100).toFixed(1)}%`,
                    cls: "text-danger",
                  },
                  {
                    k: "炸板率",
                    v: emotion.break_rate == null ? "—" : `${(emotion.break_rate * 100).toFixed(1)}%`,
                    cls: "text-success",
                  },
                  {
                    k: "晋级率",
                    v: emotion.promotion_rate == null ? "—" : `${(emotion.promotion_rate * 100).toFixed(1)}%`,
                    cls: "text-danger",
                  },
                ].map((c) => (
                  <div key={c.k} className="flex items-baseline justify-between gap-2 rounded-md px-1.5 py-1.5">
                    <p className="shrink-0 text-xs text-muted-foreground">{c.k}</p>
                    <p className={cn("text-right font-mono text-lg font-bold tabular-nums leading-tight", c.cls)}>{c.v}</p>
                  </div>
                ))}
              </div>
              {/* 连板股靠右 */}
              <div className="min-w-0 overflow-auto">
                <p className="sticky top-0 z-10 border-b border-border/40 bg-card/90 px-2.5 py-1.5 text-[10px] text-muted-foreground/70 backdrop-blur">
                  连板股 · 非推荐
                </p>
                {emotion.lianban_stocks.length === 0 ? (
                  <p className="px-3 py-6 text-xs text-muted-foreground/50">今日无 2 板以上</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        {["名称", "连板", "涨停%", "行业"].map((h) => (
                          <th key={h} className={h === "连板" || h === "涨停%" ? "num" : ""}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {emotion.lianban_stocks.slice(0, 12).map((s) => (
                        <tr key={s.code}>
                          <td>
                            <Link to={`/a-share?tab=chart&code=${s.code}`} className="hover:text-primary">
                              <span className="font-medium">{s.name}</span>{" "}
                              <span className="text-muted-foreground/50">{s.code}</span>
                            </Link>
                          </td>
                          <td className="num font-bold text-primary">{s.boards}</td>
                          <td className="num"><span className="pct-chip up">+{s.pct}%</span></td>
                          <td className="max-w-[5.5rem] truncate text-muted-foreground" title={s.industry || undefined}>
                            {s.industry || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </GlassCard>
      </div>

      {/* 第二行：行业涨跌 / 同花顺热榜 / 成交额 TOP */}
      <div className="mb-5 grid gap-3 lg:grid-cols-3">
        <GlassCard className="!mb-0 !p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
            <p className="text-sm font-semibold">行业涨跌</p>
            <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">{topUpdatedLabel}</p>
          </div>
          {!industry?.top?.length ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground/65">
              {extraDone ? "暂无行业数据" : "加载中…"}
            </p>
          ) : (
            <div className="max-h-[22rem] overflow-auto p-2">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div>
                  <p className="mb-1.5 px-1 text-[10px] font-medium text-danger">涨幅 Top</p>
                  {industry.top.slice(0, 10).map((r) => (
                    <div key={r.code || r.name} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-muted/25">
                      <span className="w-4 text-muted-foreground/45">{r.rank}</span>
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      <PctChip pct={r.change_pct} />
                    </div>
                  ))}
                </div>
                <div>
                  <p className="mb-1.5 px-1 text-[10px] font-medium text-success">相对弱势</p>
                  {(industry.bottom || []).slice(0, 10).map((r, i) => (
                    <div key={r.code || r.name} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-muted/25">
                      <span className="w-4 text-muted-foreground/45">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      <PctChip pct={r.change_pct} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </GlassCard>

        <GlassCard className="!mb-0 !p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
            <p className="text-sm font-semibold">同花顺热榜</p>
            <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">{topUpdatedLabel}</p>
          </div>
          {!hot?.rows?.length ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground/65">
              {extraDone ? "暂无热榜数据" : "加载中…"}
            </p>
          ) : (
            <div className="max-h-[22rem] space-y-0.5 overflow-auto p-2">
              {hot.rows.slice(0, 20).map((r, i) => (
                <Link
                  key={r.code || i}
                  to={`/a-share?tab=chart&code=${r.code}`}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-primary/10"
                >
                  <span className="w-5 font-mono text-xs text-muted-foreground/45">{r.rank ?? i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  <PctChip pct={r.pct == null ? null : Number(r.pct)} />
                  {r.rank_chg != null && (
                    <span className={cn(
                      "w-9 shrink-0 text-right font-mono text-[11px]",
                      (r.rank_chg ?? 0) > 0 ? "text-danger" : (r.rank_chg ?? 0) < 0 ? "text-success" : "text-muted-foreground",
                    )}>
                      {r.rank_chg > 0 ? `↑${r.rank_chg}` : r.rank_chg < 0 ? `↓${Math.abs(r.rank_chg)}` : "—"}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard className="!mb-0 !p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
            <p className="text-sm font-semibold">成交额 TOP</p>
            <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">{topUpdatedLabel}</p>
          </div>
          {!turnover || turnover.stocks.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground/65">
              {toDone ? "暂无数据" : "加载中…"}
            </p>
          ) : (
            <div className="max-h-[22rem] overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {["#", "名称", "涨跌%", "成交额"].map((h) => (
                      <th key={h} className={h !== "名称" ? "num" : ""}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {turnover.stocks.slice(0, 20).map((s, i) => (
                    <tr key={s.code}>
                      <td className="num text-muted-foreground/50">{i + 1}</td>
                      <td>
                        <Link to={`/a-share?tab=chart&code=${s.code}`} className="hover:text-primary">
                          <span className="font-medium">{s.name}</span>{" "}
                          <span className="text-muted-foreground/50">{s.code}</span>
                        </Link>
                      </td>
                      <td className="num"><PctChip pct={s.pct} /></td>
                      <td className="num font-mono">{yi(s.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </div>

      {showReviewPanel && (
        <GlassCard glow className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> AI 当日复盘
            </h3>
            {reviewLoading && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 生成中…
              </span>
            )}
          </div>
          {needConfig && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
              还没接入 AI。<Link to="/settings" className="text-primary">先去接入你的 AI</Link>，之后一键出复盘。
            </div>
          )}
          {reviewErr && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /> {reviewErr}
            </div>
          )}
          {review ? (
            <>
              <div className="prose prose-sm prose-invert mt-3 max-w-none text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{review}</ReactMarkdown>
              </div>
              {!reviewLoading && (
                <div className="mt-3">
                  <SaveNoteButton kind="复盘" title={`每日复盘 ${today}`} content={review} />
                </div>
              )}
            </>
          ) : null}
        </GlassCard>
      )}

      <SegmentNav
        storageKey="ashare.review"
        sticky
        items={[
          { key: "boards", label: "龙虎榜" },
          { key: "money", label: "资金" },
          { key: "risk", label: "风险" },
        ]}
        value={seg}
        onChange={setSeg}
      />

      {/* 龙虎榜 */}
      {seg === "boards" && (
        <div>
          <SectionHeader
            icon={<Trophy className="h-3.5 w-3.5 text-primary/80" />}
            title="全市场龙虎榜"
            hint="按席位净买额 · 非推荐"
            meta={lhb?.date ? `${lhb.date} · ${lhb.total_records} 条` : (lhbDone ? "暂无" : "加载中…")}
          />
          <GlassCard className="!p-0 overflow-hidden">
            {!lhb || lhb.stocks.length === 0 ? (
              <div className="p-5">{pending(lhbDone)}</div>
            ) : (
              <div className="max-h-[28rem] overflow-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      {["#", "名称", "涨跌%", "净买(万)", "买入(万)", "卖出(万)", "换手%", "上榜原因"].map((h) => (
                        <th key={h} className={h !== "名称" && h !== "上榜原因" ? "num" : ""}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lhb.stocks.map((s, i) => (
                      <tr key={`${s.code}-${s.reason}-${i}`}>
                        <td className="num text-muted-foreground/50">{i + 1}</td>
                        <td>
                          <Link to={`/a-share?tab=chart&code=${s.code}`} className="hover:text-primary">
                            <span className="font-medium">{s.name}</span>{" "}
                            <span className="text-muted-foreground/50">{s.code}</span>
                          </Link>
                        </td>
                        <td className="num"><PctChip pct={s.change_pct} /></td>
                        <td className={cn("num font-mono", pctColor(s.net_buy_wan))}>
                          {s.net_buy_wan > 0 ? "+" : ""}{fmt(s.net_buy_wan)}
                        </td>
                        <td className="num text-muted-foreground">{fmt(s.buy_wan)}</td>
                        <td className="num text-muted-foreground">{fmt(s.sell_wan)}</td>
                        <td className="num text-muted-foreground">{s.turnover_pct}</td>
                        <td className="max-w-[220px] truncate text-muted-foreground" title={s.reason}>
                          {s.reason || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>

          <div className="mt-6">
            <SectionHeader
              icon={<Search className="h-3.5 w-3.5 text-primary/80" />}
              title="问财研报"
              hint="iwencai NL 主题检索 · 需配置 key"
              meta={iwencaiReady ? "已配置" : "未配置 key"}
            />
            <GlassCard>
              {!iwencaiReady ? (
                <p className="text-sm text-muted-foreground">
                  在 <code className="rounded bg-muted/50 px-1">backend/.env</code> 设置{" "}
                  <code className="rounded bg-muted/50 px-1">IWENCAI_API_KEY</code> 后重启后端即可语义搜研报
                  （如「人形机器人 丝杠」）。按个股搜研报请用详情页东财列表。
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={iwencaiQ}
                      onChange={(e) => setIwencaiQ(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void runIwencai()}
                      placeholder="主题关键词，如 人形机器人 行星滚柱丝杠"
                      className="min-w-0 flex-1 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50"
                    />
                    <button
                      type="button"
                      onClick={() => void runIwencai()}
                      disabled={iwencaiBusy || !iwencaiQ.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {iwencaiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                      搜索
                    </button>
                  </div>
                  {iwencaiErr && (
                    <p className="mt-2 text-xs text-destructive">{iwencaiErr}</p>
                  )}
                  {iwencaiItems.length > 0 && (
                    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                      {iwencaiItems.map((it, i) => (
                        <div key={`${it.title}-${i}`} className="border-b border-border/40 pb-2 text-sm last:border-0">
                          <div className="flex items-baseline gap-2">
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{it.publish_date || "—"}</span>
                            <span className="min-w-0 flex-1 font-medium leading-snug">{it.title}</span>
                          </div>
                          {(it.organization || it.url) && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                              {it.organization || ""}
                              {it.url ? (
                                <>
                                  {" · "}
                                  <a href={it.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">原文</a>
                                </>
                              ) : null}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </GlassCard>
          </div>
        </div>
      )}

      {/* 资金：北向 + 板块流 + 轮动（行业/热榜/成交额已常开在上方） */}
      {seg === "money" && (
        <div className="space-y-6">
          <div>
            <SectionHeader
              icon={<Activity className="h-3.5 w-3.5 text-primary/80" />}
              title="北向资金"
              hint="沪股通可用 · 深股通仅供参考"
              meta={hsgt?.latest?.time ? `截至 ${hsgt.latest.time}` : (extraDone ? "暂无" : "加载中…")}
            />
            <GlassCard>
              {!hsgt?.latest ? (
                pending(extraDone)
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border/40 bg-muted/20 p-3.5 text-center">
                    <p className="text-[11px] text-muted-foreground">沪股通累计净买</p>
                    <p className={cn("mt-1 font-mono text-xl font-bold", pctColor(hsgt.latest.hgt_yi ?? 0))}>
                      {hsgt.latest.hgt_yi == null ? "—" : `${hsgt.latest.hgt_yi > 0 ? "+" : ""}${fmt(hsgt.latest.hgt_yi)} 亿`}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/40 bg-muted/20 p-3.5 text-center">
                    <p className="text-[11px] text-muted-foreground">深股通累计净买</p>
                    <p className={cn("mt-1 font-mono text-xl font-bold", pctColor(hsgt.latest.sgt_yi ?? 0))}>
                      {hsgt.latest.sgt_yi == null ? "—" : `${hsgt.latest.sgt_yi > 0 ? "+" : ""}${fmt(hsgt.latest.sgt_yi)} 亿`}
                    </p>
                  </div>
                  <div className="col-span-2 rounded-xl border border-border/30 bg-muted/15 p-3.5 text-center sm:col-span-1">
                    <p className="text-[11px] text-muted-foreground">说明</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">{hsgt.note || "同花顺分钟流向"}</p>
                  </div>
                </div>
              )}
            </GlassCard>
          </div>

          <div>
            <SectionHeader
              icon={<TrendingUp className="h-3.5 w-3.5 text-primary/80" />}
              title="板块资金流"
              hint="东财 · 主力净流入"
              meta={boardFlow?.rows?.length ? `${boardFlow.rows.length} 条` : (extraDone ? "暂无" : "加载中…")}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <ChipGroup>
                    {([["industry", "行业"], ["concept", "概念"], ["region", "地域"]] as const).map(([k, label]) => (
                      <Chip key={k} active={boardType === k} onClick={() => setBoardType(k)}>{label}</Chip>
                    ))}
                  </ChipGroup>
                  <ChipGroup>
                    {([["today", "今日"], ["5d", "5日"], ["10d", "10日"]] as const).map(([k, label]) => (
                      <Chip key={k} active={boardPeriod === k} onClick={() => setBoardPeriod(k)}>{label}</Chip>
                    ))}
                  </ChipGroup>
                </div>
              }
            />
            <GlassCard className="!p-0 overflow-hidden">
              {!boardFlow?.rows?.length ? (
                <div className="p-5">{pending(extraDone)}</div>
              ) : (
                <div className="max-h-[28rem] overflow-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {["#", "板块", "涨跌%", "主力净流入", "净占比", "领涨股"].map((h) => (
                          <th key={h} className={h !== "板块" && h !== "领涨股" ? "num" : ""}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {boardFlow.rows.map((r) => (
                        <tr key={`${r.code}-${r.name}`}>
                          <td className="num text-muted-foreground/50">{r.rank}</td>
                          <td className="font-medium">{r.name}</td>
                          <td className="num"><PctChip pct={r.change_pct} /></td>
                          <td className={cn("num font-mono", pctColor(r.main_net))}>
                            {r.main_net > 0 ? "+" : ""}{fmt(r.main_net / 1e8)} 亿
                          </td>
                          <td className="num text-muted-foreground">{r.main_pct}%</td>
                          <td className="text-muted-foreground">{r.leader || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
          </div>

          <div>
            <SectionHeader
              icon={<ArrowDownUp className="h-3.5 w-3.5 text-primary/80" />}
              title="资金轮动速览"
              hint="行业级净流入 / 流出"
              meta={sectors.length ? `${sectors.length} 行业` : (ovDone ? "暂无" : "加载中…")}
            />
            <div className="grid gap-4 md:grid-cols-2">
              {[
                { title: "流入 Top", icon: TrendingUp, color: "text-danger", rows: sectors.slice(0, 6) },
                { title: "流出 Top", icon: TrendingDown, color: "text-success", rows: [...sectors].slice(-6).reverse() },
              ].map((col) => (
                <GlassCard key={col.title} className="!p-4">
                  <h4 className={cn("mb-3 flex items-center gap-1.5 text-sm font-semibold", col.color)}>
                    <col.icon className="h-4 w-4" /> {col.title}
                  </h4>
                  {col.rows.length === 0 ? (
                    pending(ovDone)
                  ) : (
                    <div className="space-y-1">
                      {col.rows.map((s, i) => (
                        <div key={s.name} className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-sm hover:bg-muted/25">
                          <span className="w-5 text-xs text-muted-foreground/45">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate">{s.name}</span>
                          <PctChip pct={s.pct} />
                          <span className={cn("w-20 text-right font-mono text-xs", pctColor(s.net))}>{s.net > 0 ? "+" : ""}{fmt(s.net)} 亿</span>
                        </div>
                      ))}
                    </div>
                  )}
                </GlassCard>
              ))}
            </div>
          </div>

          <div>
            <SectionHeader
              icon={<TrendingUp className="h-3.5 w-3.5 text-primary/80" />}
              title="ETF 资金流"
              hint="东财 · 主力净流入(亿)"
              meta={etfFlow?.rows?.length ? `${etfFlow.rows.length} 只` : (moneyDone ? "暂无" : "加载中…")}
              actions={(
                <ChipGroup>
                  {([["net_inflow", "净流入"], ["change_pct", "涨跌幅"]] as const).map(([k, label]) => (
                    <Chip key={k} active={etfSort === k} onClick={() => setEtfSort(k)}>{label}</Chip>
                  ))}
                </ChipGroup>
              )}
            />
            <GlassCard className="!p-0 overflow-hidden">
              {!etfFlow?.rows?.length ? (
                <div className="p-5">{pending(moneyDone)}</div>
              ) : (
                <div className="max-h-[28rem] overflow-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {["#", "代码", "名称", "涨跌%", "主力净流入", "超大单", "大单"].map((h) => (
                          <th key={h} className={h === "名称" || h === "代码" ? "" : "num"}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {etfFlow.rows.map((r, i) => (
                        <tr key={r.code}>
                          <td className="num text-muted-foreground/50">{i + 1}</td>
                          <td className="font-mono text-xs">
                            <Link to={`/a-share?tab=chart&code=${r.code}`} className="hover:text-primary">{r.code}</Link>
                          </td>
                          <td className="font-medium">{r.name}</td>
                          <td className="num"><PctChip pct={r.change_pct} /></td>
                          <td className={cn("num font-mono", pctColor(r.main_net_inflow))}>
                            {r.main_net_inflow > 0 ? "+" : ""}{fmt(r.main_net_inflow)} 亿
                          </td>
                          <td className={cn("num font-mono text-xs", pctColor(r.super_large_net))}>
                            {r.super_large_net > 0 ? "+" : ""}{fmt(r.super_large_net)}
                          </td>
                          <td className={cn("num font-mono text-xs", pctColor(r.large_net))}>
                            {r.large_net > 0 ? "+" : ""}{fmt(r.large_net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
            <p className="mt-1.5 text-[11px] text-muted-foreground/55">客观公开榜单，只呈现事实，不构成买卖建议。</p>
          </div>

          <div>
            <SectionHeader
              icon={<Activity className="h-3.5 w-3.5 text-primary/80" />}
              title="利率 · LPR / 国债"
              hint="中国货币网 · 中债登"
              meta={
                lpr?.latest?.date || bondY?.date
                  ? `LPR ${lpr?.latest?.date ?? "—"} · 曲线 ${bondY?.date || "—"}`
                  : (moneyDone ? "暂无" : "加载中…")
              }
            />
            <div className="grid gap-4 md:grid-cols-2">
              <GlassCard className="!p-4">
                <h4 className="mb-3 text-sm font-semibold">LPR 报价</h4>
                {!lpr?.latest ? (
                  pending(moneyDone)
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-center">
                        <p className="text-[11px] text-muted-foreground">1 年期</p>
                        <p className="mt-1 font-mono text-xl font-bold">{lpr.latest.one_year.toFixed(2)}%</p>
                      </div>
                      <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-center">
                        <p className="text-[11px] text-muted-foreground">5 年期以上</p>
                        <p className="mt-1 font-mono text-xl font-bold">{lpr.latest.five_year.toFixed(2)}%</p>
                      </div>
                    </div>
                    {lpr.rows.length > 1 && (
                      <div className="mt-3 max-h-36 space-y-1 overflow-y-auto border-t border-border/40 pt-2">
                        {lpr.rows.slice(0, 8).map((r) => (
                          <div key={r.date} className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                            <span className="w-24 shrink-0">{r.date}</span>
                            <span className="flex-1">1Y {r.one_year.toFixed(2)}%</span>
                            <span>5Y {r.five_year.toFixed(2)}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </GlassCard>
              <GlassCard className="!p-4">
                <h4 className="mb-3 text-sm font-semibold">中债国债收益率</h4>
                {!bondY?.terms || Object.keys(bondY.terms).length === 0 ? (
                  pending(moneyDone)
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {(["1Y", "2Y", "5Y", "10Y", "30Y"] as const).map((k) => (
                        <div key={k} className="min-w-[4.5rem] rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2 text-center">
                          <p className="text-[10px] text-muted-foreground">{k}</p>
                          <p className="font-mono text-sm font-semibold">
                            {bondY.terms[k] != null ? `${bondY.terms[k].toFixed(2)}%` : "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                      <span>
                        10Y-2Y{" "}
                        <span className="font-mono text-foreground">
                          {bondY.spread_10_2 == null ? "—" : `${bondY.spread_10_2 > 0 ? "+" : ""}${bondY.spread_10_2.toFixed(2)}`}
                        </span>
                      </span>
                      <span>
                        30Y-10Y{" "}
                        <span className="font-mono text-foreground">
                          {bondY.spread_30_10 == null ? "—" : `${bondY.spread_30_10 > 0 ? "+" : ""}${bondY.spread_30_10.toFixed(2)}`}
                        </span>
                      </span>
                      {bondY.date && <span className="ml-auto">{bondY.date}</span>}
                    </div>
                  </>
                )}
              </GlassCard>
            </div>
          </div>

          <div>
            <SectionHeader
              icon={<ShieldAlert className="h-3.5 w-3.5 text-primary/80" />}
              title="股东 / 高管增减持"
              hint="东财披露 · 客观呈现"
              meta={shChg?.rows?.length ? `${shChg.rows.length} 条` : (moneyDone ? "暂无" : "加载中…")}
              actions={(
                <ChipGroup>
                  {([["all", "全部"], ["增持", "增持"], ["减持", "减持"]] as const).map(([k, label]) => (
                    <Chip key={k} active={shType === k} onClick={() => setShType(k)}>{label}</Chip>
                  ))}
                </ChipGroup>
              )}
            />
            <GlassCard className="!p-0 overflow-hidden">
              {!shChg?.rows?.length ? (
                <div className="p-5">{pending(moneyDone)}</div>
              ) : (
                <div className="max-h-[28rem] overflow-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {["日期", "代码", "名称", "变动人", "方向", "股数", "均价", "职务"].map((h) => (
                          <th key={h} className={h === "股数" || h === "均价" ? "num" : ""}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shChg.rows.map((r, i) => (
                        <tr key={`${r.code}-${r.date}-${r.person}-${i}`}>
                          <td className="font-mono text-xs text-muted-foreground">{r.date}</td>
                          <td className="font-mono text-xs">
                            <Link to={`/a-share?tab=chart&code=${r.code}`} className="hover:text-primary">{r.code}</Link>
                          </td>
                          <td className="font-medium">{r.name}</td>
                          <td className="max-w-[6rem] truncate">{r.person || "—"}</td>
                          <td className={cn("text-xs font-medium", r.change_type === "增持" ? "text-danger" : "text-success")}>
                            {r.change_type}
                          </td>
                          <td className="num font-mono text-xs">
                            {r.change_shares ? `${(r.change_shares / 1e4).toFixed(1)} 万` : "—"}
                          </td>
                          <td className="num font-mono text-xs">{r.avg_price ? fmt(r.avg_price) : "—"}</td>
                          <td className="max-w-[5rem] truncate text-xs text-muted-foreground">{r.position || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
            <p className="mt-1.5 text-[11px] text-muted-foreground/55">公开披露数据，仅供了解变动事实，不构成买卖建议。</p>
          </div>
        </div>
      )}

      {/* 风险：监控池 + 异动 + 打板池 */}
      {seg === "risk" && (
        <div className="space-y-6">
          <div>
            <SectionHeader
              icon={<ShieldAlert className="h-3.5 w-3.5 text-warning" />}
              title="重点监控池"
              hint="交易所风险警示"
              meta={monitor?.count != null ? `${monitor.count} 只` : (extraDone ? "暂无" : "加载中…")}
            />
            <GlassCard className="!p-0 overflow-hidden">
              {!monitor?.rows?.length ? (
                <div className="p-5">{pending(extraDone)}</div>
              ) : (
                <div className="max-h-64 space-y-0.5 overflow-y-auto p-2">
                  {monitor.rows.map((r) => (
                    <Link key={r.code} to={`/a-share?tab=chart&code=${r.code}`}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-warning/10">
                      <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{r.code}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                      <span className="shrink-0 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">{r.market}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/55">{r.start}~{r.end}</span>
                    </Link>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>

          <div>
            <SectionHeader
              icon={<ShieldAlert className="h-3.5 w-3.5 text-warning" />}
              title="日内异动"
              hint="严重异常波动"
              meta={anomaly?.date ?? (extraDone ? "暂无" : "加载中…")}
            />
            <GlassCard className="!p-0 overflow-hidden">
              {!anomaly?.items?.length ? (
                <div className="p-5">{pending(extraDone)}</div>
              ) : (
                <div className="max-h-64 space-y-0.5 overflow-y-auto p-2">
                  {anomaly.items.slice(0, 30).map((r, i) => (
                    <Link key={`${r.code}-${i}`} to={`/a-share?tab=chart&code=${r.code}`}
                      className="block rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-warning/10">
                      <div className="flex items-center gap-2">
                        <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{r.code}</span>
                        <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                        <PctChip pct={r.change_pct} />
                      </div>
                      <p className="mt-0.5 truncate pl-[3.75rem] text-[11px] text-muted-foreground/60">{r.rule}</p>
                    </Link>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>

          <div>
            <SectionHeader
              icon={<Flame className="h-3.5 w-3.5 text-primary/80" />}
              title="打板池明细"
              hint="客观公开榜单 · 非推荐"
              meta={
                limitKind === "jm"
                  ? (thsLimit?.date ? `${thsLimit.date} · 共 ${thsLimit.total} 只` : (extraDone ? "暂无" : "加载中…"))
                  : (limitPool?.date ? `${limitPool.date} · 共 ${limitPool.total} 只` : (extraDone ? "暂无" : "加载中…"))
              }
              actions={(
                <ChipGroup>
                  {([["zt", "涨停"], ["zb", "炸板"], ["dt", "跌停"], ["yzt", "昨涨停"], ["jm", "揭秘"]] as const).map(([k, label]) => (
                    <Chip key={k} active={limitKind === k} onClick={() => setLimitKind(k)}>{label}</Chip>
                  ))}
                </ChipGroup>
              )}
            />
            <GlassCard className="!p-0 overflow-hidden">
              {limitKind === "jm" ? (
                !thsLimit?.rows?.length ? (
                  <div className="p-5">{pending(extraDone)}</div>
                ) : (
                  <div className="max-h-[28rem] overflow-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {["名称", "涨跌%", "几天几板", "题材原因", "板型", "封板率%", "首次"].map((h) => (
                            <th key={h} className={h === "名称" || h === "题材原因" || h === "板型" ? "" : "num"}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {thsLimit.rows.map((s) => (
                          <tr key={`${s.code}-${s.name}`}>
                            <td>
                              <Link to={`/a-share?tab=chart&code=${s.code}`} className="hover:text-primary">
                                <span className="font-medium">{s.name}</span>{" "}
                                <span className="text-muted-foreground/50">{s.code}</span>
                              </Link>
                            </td>
                            <td className="num"><PctChip pct={s.pct} /></td>
                            <td className="num font-mono text-xs">{s.high_days || "—"}</td>
                            <td className="max-w-[10rem] truncate text-muted-foreground" title={s.reason}>{s.reason || "—"}</td>
                            <td className="text-muted-foreground">{s.board_type || "—"}</td>
                            <td className="num font-mono text-xs">{s.seal_rate != null ? s.seal_rate : "—"}</td>
                            <td className="num font-mono text-xs text-muted-foreground">{s.first_time || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : !limitPool?.rows?.length ? (
                <div className="p-5">{pending(extraDone)}</div>
              ) : (
                <div className="max-h-[28rem] overflow-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {["名称", "涨跌%", "连板/统计", "换手%", "行业"].map((h) => (
                          <th key={h} className={h !== "名称" && h !== "行业" ? "num" : ""}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {limitPool.rows.map((s) => (
                        <tr key={`${s.code}-${s.name}`}>
                          <td>
                            <Link to={`/a-share?tab=chart&code=${s.code}`} className="hover:text-primary">
                              <span className="font-medium">{s.name}</span>{" "}
                              <span className="text-muted-foreground/50">{s.code}</span>
                            </Link>
                          </td>
                          <td className="num"><PctChip pct={s.pct} /></td>
                          <td className="num font-mono text-xs">
                            {s.limit_days != null ? `${s.limit_days}板` : s.zt_stat || (s.dt_days != null ? `${s.dt_days}跌停` : "—")}
                          </td>
                          <td className="num text-muted-foreground">{s.turnover ?? "—"}</td>
                          <td className="text-muted-foreground">{s.industry || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
          </div>
        </div>
      )}

      {!embedded && <Disclaimer />}
    </div>
  );
}
