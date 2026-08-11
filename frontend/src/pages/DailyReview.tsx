import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import * as echarts from "echarts";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { GlanceStrip, type GlanceMetric } from "@/components/ui/GlanceStrip";
import { SegmentNav, useSegment } from "@/components/ui/SegmentNav";
import { ReviewIndexPanel } from "@/components/review/ReviewIndexPanel";
import { ReviewSentimentPanel } from "@/components/review/ReviewSentimentPanel";
import { ReviewShortPanel } from "@/components/review/ReviewShortPanel";
import { ReviewRankRow } from "@/components/review/ReviewRankRow";
import { ReviewBoardsSeg } from "@/components/review/ReviewBoardsSeg";
import { ReviewMoneySeg } from "@/components/review/ReviewMoneySeg";
import { ReviewRiskSeg } from "@/components/review/ReviewRiskSeg";
import { WATCH_MINUTE_MAX, type IdxPanel } from "@/components/review/constants";
import { fmt, pctTone } from "@/components/review/format";
import { reviewPending } from "@/components/review/reviewPending";
import { formatClock } from "@/lib/freshness";
import {
  api, ApiError, type IndexQuote, type MarketOverview, type ShortTermEmotion,
  type TurnoverTop, type GlobalIndex, type DailyDragonTiger, type BoardFlow,
  type HotList, type MonitorPool, type AnomalyPool, type LimitPool, type IndustryData,
  type ThsLimitUpPool, type IwencaiItem, type EtfFlow, type ShareholderChanges,
  type LprData, type CnBondYield, type AShareLightKline, type Quote,
} from "@/lib/api";
import { hasLlm, chatStream } from "@/lib/llm";
import { storageGet, storageSet } from "@/lib/storage";
import { getAShareSession } from "@/lib/ashareSession";
import { loadWatch } from "@/lib/watchlist";

const TOP_AUTO_MS = 30_000;
const TOP_AUTO_KEY = "ashare.review.topAuto";
const IDX_PANEL_KEY = "ashare.review.idxPanel";

// A-share / China-platform convention: red up, green down (incl. global indices here).
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
  const [session, setSession] = useState(() => getAShareSession());
  const [idxPanel, setIdxPanel] = useState<IdxPanel>(() => {
    const s = storageGet(IDX_PANEL_KEY);
    return s === "global" || s === "watch" || s === "cn" ? s : "cn";
  });
  const [idxMinute, setIdxMinute] = useState<Record<string, AShareLightKline | null>>({});
  const [idxMinuteDone, setIdxMinuteDone] = useState(false);
  const [watchCodes, setWatchCodes] = useState<string[]>(() => loadWatch());
  const [watchQuotes, setWatchQuotes] = useState<Record<string, Quote>>({});
  const [watchMinute, setWatchMinute] = useState<Record<string, AShareLightKline | null>>({});
  const [watchDone, setWatchDone] = useState(false);
  const bondChartRef = useRef<HTMLDivElement>(null);
  const bondEchartRef = useRef<echarts.ECharts | null>(null);

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

  const topUpdatedLabel = formatClock(topUpdatedAt, { refreshing: topRefreshing });

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
      api.hotList("ths", "hour", 25).catch(() => null),
      api.industry(20).catch(() => null),
    ]).then(([ht, ind]) => {
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
      api.hotList("ths", "hour", 25).catch(() => null),
      api.stockMonitor().catch(() => null),
      api.priceAnomaly(40).catch(() => null),
      pLimit,
      api.industry(20).catch(() => null),
      api.boardFlow(boardType, boardPeriod, 20).catch(() => null),
    ]).then(([ht, mo, an, , ind, bf]) => {
      setHot(ht); setMonitor(mo); setAnomaly(an);
      setIndustry(ind); setBoardFlow(bf);
    }).finally(() => setExtraDone(true));

    void Promise.all([pIdx, pGlobal, pOv, pEmo, pTo, pExtra]).finally(() => {
      setTopUpdatedAt(new Date());
    });
  };

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

  useEffect(() => {
    const tick = () => setSession(getAShareSession());
    tick();
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    storageSet(IDX_PANEL_KEY, idxPanel);
  }, [idxPanel]);

  // Domestic index minute charts — prefetch as soon as indices arrive (not only CN tab).
  // Progressive: paint each spark as it lands; keep stale bars while refreshing.
  useEffect(() => {
    const syms = indices.map((i) => i.symbol).filter((s): s is string => !!s);
    if (!syms.length) return;
    let cancelled = false;
    setIdxMinuteDone(false);
    void Promise.all(
      syms.map(async (sym) => {
        try {
          const d = await api.ashareLightKline(sym, "1", 240);
          if (!cancelled) {
            setIdxMinute((prev) => ({ ...prev, [sym]: d }));
          }
          return [sym, d] as const;
        } catch {
          if (!cancelled) {
            setIdxMinute((prev) => (sym in prev ? prev : { ...prev, [sym]: null }));
          }
          return [sym, null] as const;
        }
      }),
    ).then(() => {
      if (!cancelled) setIdxMinuteDone(true);
    });
    return () => { cancelled = true; };
  }, [indices]);

  // Keep watch count badge fresh when top strip refreshes
  useEffect(() => {
    setWatchCodes(loadWatch());
  }, [topUpdatedAt]);

  // Watchlist quotes + minute charts
  useEffect(() => {
    if (idxPanel !== "watch") return;
    const codes = loadWatch();
    setWatchCodes(codes);
    if (!codes.length) {
      setWatchQuotes({});
      setWatchMinute({});
      setWatchDone(true);
      return;
    }
    let cancelled = false;
    setWatchDone(false);
    const slice = codes.slice(0, WATCH_MINUTE_MAX);
    void (async () => {
      try {
        const q = await api.quote(codes.join(","));
        if (!cancelled) setWatchQuotes(q);
      } catch {
        if (!cancelled) setWatchQuotes({});
      }
      const rows = await Promise.all(
        slice.map(async (c) => {
          try {
            const d = await api.ashareLightKline(c, "1", 240);
            return [c, d] as const;
          } catch {
            return [c, null] as const;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, AShareLightKline | null> = {};
      for (const [c, d] of rows) next[c] = d;
      setWatchMinute(next);
      setWatchDone(true);
    })();
    return () => { cancelled = true; };
  }, [idxPanel, topUpdatedAt]);

  // CN bond yield mini curve (money tab)
  useEffect(() => {
    if (seg !== "money") return;
    const el = bondChartRef.current;
    const pts = bondY?.curve_points ?? [];
    if (!el || pts.length < 2) return;

    let chart = bondEchartRef.current;
    if (!chart || chart.getDom() !== el) {
      chart?.dispose();
      chart = echarts.init(el, undefined, { renderer: "canvas" });
      bondEchartRef.current = chart;
    }
    const cssHsl = (name: string, fallback: string) => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return raw ? `hsl(${raw})` : fallback;
    };
    const cText = cssHsl("--chart-text", "#94a3b8");
    const cAxis = cssHsl("--chart-axis", "#475569");
    const cGrid = cssHsl("--chart-grid", "#334155");
    const cPrimary = cssHsl("--primary", "#f35d2b");
    const step = Math.max(1, Math.floor(pts.length / 40));
    const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    chart.setOption({
      animation: false,
      grid: { left: 36, right: 8, top: 12, bottom: 22 },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          const p = arr[0] as { data?: [number, number] } | undefined;
          const d = p?.data;
          if (!d) return "";
          return `${d[0]}Y: ${Number(d[1]).toFixed(2)}%`;
        },
      },
      xAxis: {
        type: "value",
        name: "年",
        nameTextStyle: { color: cText, fontSize: 10 },
        axisLabel: { color: cText, fontSize: 9, formatter: (v: number) => `${v}` },
        axisLine: { lineStyle: { color: cAxis } },
        splitLine: { show: false },
        min: 0,
        max: 30,
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: cText, fontSize: 9, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { color: cGrid, opacity: 0.25 } },
      },
      series: [{
        type: "line",
        data: sampled,
        showSymbol: false,
        smooth: 0.25,
        lineStyle: { color: cPrimary, width: 2 },
        areaStyle: { color: "rgba(243,93,43,0.08)" },
      }],
    }, { notMerge: true });
    requestAnimationFrame(() => chart?.resize());
    const ro = new ResizeObserver(() => chart?.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [seg, bondY]);

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

  const askAi = (
    <>
      <button
        type="button"
        onClick={runReview}
        disabled={reviewLoading}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-2.5 py-1.5 text-[11px] font-medium text-primary btn-press ring-1 ring-primary/20 hover:bg-primary/25 disabled:opacity-50 sm:text-xs"
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
  const shIdx = indices.find((i) => i.name.includes("上证")) ?? indices[0];
  const cyIdx = indices.find((i) => i.name.includes("创业")) ?? indices.find((i) => i.name.includes("深证"));

  const glanceMetrics: GlanceMetric[] = [
    {
      label: shIdx?.name || "上证",
      value: shIdx?.price != null ? fmt(shIdx.price) : "—",
      tone: shIdx && Number.isFinite(shIdx.change_pct) ? pctTone(shIdx.change_pct) : "muted",
      sub: shIdx
        ? `${shIdx.change_pct > 0 ? "+" : ""}${shIdx.change_pct}% · ${shIdx.change_amt > 0 ? "+" : ""}${fmt(shIdx.change_amt)}`
        : (ovDone || !idxErr ? "—" : "未接通"),
    },
    {
      label: cyIdx?.name || "创业板",
      value: cyIdx?.price != null ? fmt(cyIdx.price) : "—",
      tone: cyIdx && Number.isFinite(cyIdx.change_pct) ? pctTone(cyIdx.change_pct) : "muted",
      sub: cyIdx
        ? `${cyIdx.change_pct > 0 ? "+" : ""}${cyIdx.change_pct}% · ${cyIdx.change_amt > 0 ? "+" : ""}${fmt(cyIdx.change_amt)}`
        : "—",
    },
    {
      label: "涨跌家数",
      value: sentiment ? `${sentiment.up}/${sentiment.down}` : "—",
      tone: "primary",
      sub: sentiment?.breadth ? `宽度 ${sentiment.breadth}` : (ovDone ? "暂无" : "加载中…"),
    },
    {
      label: "涨停 / 跌停",
      value: sentiment ? `${sentiment.zt}/${sentiment.dt}` : "—",
      tone: "muted",
      sub: emotion?.max_boards != null
        ? `最高板 ${emotion.max_boards}`
        : (emoDone || ovDone ? "短线情绪" : "加载中…"),
    },
  ];

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="每日复盘"
          subtitle={`${today} · 大盘 / 情绪 / 板块资金一屏看全，交给你的 AI 做复盘`}
        />
      )}

      <GlanceStrip
        title="复盘一眼"
        subtitle={`${today} · ${session.hint}`}
        metrics={glanceMetrics}
        session={session}
        updatedAt={topUpdatedAt}
        refreshing={topRefreshing}
        onRefresh={refreshTopRows}
        auto={topAuto}
        onAutoChange={setTopAuto}
        autoHint="约 30 秒"
        actions={askAi}
      />

      <div className="mb-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(220px,26%)_minmax(0,1fr)_minmax(260px,30%)]">
        <ReviewIndexPanel
          idxPanel={idxPanel}
          onIdxPanel={setIdxPanel}
          updatedLabel={topUpdatedLabel}
          session={session}
          indices={indices}
          idxErr={idxErr}
          idxMinute={idxMinute}
          idxMinuteDone={idxMinuteDone}
          globalIdx={globalIdx}
          watchCodes={watchCodes}
          watchQuotes={watchQuotes}
          watchMinute={watchMinute}
          watchDone={watchDone}
        />
        <ReviewSentimentPanel
          sentiment={sentiment}
          ovDone={ovDone}
          updatedLabel={topUpdatedLabel}
          indTop={indTop}
          indBot={indBot}
          pending={reviewPending(false, "lines")}
        />
        <ReviewShortPanel
          emotion={emotion}
          emoDone={emoDone}
          updatedLabel={topUpdatedLabel}
          pending={reviewPending(false, "lines")}
        />
      </div>

      <ReviewRankRow
        updatedLabel={topUpdatedLabel}
        industry={industry}
        hot={hot}
        turnover={turnover}
        extraDone={extraDone}
        industryPending={reviewPending(false)}
        hotPending={reviewPending(false)}
        turnoverPending={reviewPending(toDone)}
      />

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
              <div className="prose prose-sm dark:prose-invert mt-3 max-w-none text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{review}</ReactMarkdown>
              </div>
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

      {seg === "boards" && (
        <ReviewBoardsSeg
          lhb={lhb}
          lhbDone={lhbDone}
          iwencaiReady={iwencaiReady}
          iwencaiQ={iwencaiQ}
          onIwencaiQ={setIwencaiQ}
          iwencaiBusy={iwencaiBusy}
          iwencaiErr={iwencaiErr}
          iwencaiItems={iwencaiItems}
          onRunIwencai={() => void runIwencai()}
        />
      )}

      {seg === "money" && (
        <ReviewMoneySeg
          boardFlow={boardFlow}
          boardType={boardType}
          onBoardType={setBoardType}
          boardPeriod={boardPeriod}
          onBoardPeriod={setBoardPeriod}
          sectors={sectors}
          etfFlow={etfFlow}
          etfSort={etfSort}
          onEtfSort={setEtfSort}
          lpr={lpr}
          bondY={bondY}
          bondChartRef={bondChartRef}
          shChg={shChg}
          shType={shType}
          onShType={setShType}
          extraDone={extraDone}
          ovDone={ovDone}
          moneyDone={moneyDone}
        />
      )}

      {seg === "risk" && (
        <ReviewRiskSeg
          monitor={monitor}
          anomaly={anomaly}
          limitPool={limitPool}
          thsLimit={thsLimit}
          limitKind={limitKind}
          onLimitKind={setLimitKind}
          extraDone={extraDone}
        />
      )}

      {!embedded && <Disclaimer />}
    </div>
  );
}
