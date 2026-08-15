import { useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Loader2, AlertCircle, RefreshCw, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { CockpitLayout, type CockpitRow } from "@/components/cockpit/CockpitLayout";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { ReviewIndexPanel } from "@/components/review/ReviewIndexPanel";
import { ReviewSentimentPanel } from "@/components/review/ReviewSentimentPanel";
import { ReviewShortPanel } from "@/components/review/ReviewShortPanel";
import { ReviewBoardsSeg } from "@/components/review/ReviewBoardsSeg";
import { ReviewMoneySeg } from "@/components/review/ReviewMoneySeg";
import { ReviewRiskSeg } from "@/components/review/ReviewRiskSeg";
import { ChainPanel } from "@/components/review/ChainPanel";
import { WorldIndexPanel } from "@/components/cockpit/WorldIndexPanel";
import { SectorHotPanel } from "@/components/cockpit/SectorHotPanel";
import { BoardFlowLivePanel } from "@/components/cockpit/BoardFlowLivePanel";
import { MoneyFlowRankPanel } from "@/components/cockpit/MoneyFlowRankPanel";
import { StockRankPanel } from "@/components/cockpit/StockRankPanel";
import { CommodityPanel } from "@/components/cockpit/CommodityPanel";
import { reviewPending } from "@/components/review/reviewPending";
import { useReviewData } from "@/hooks/useReviewData";
import { ApiError } from "@/lib/api";
import { hasLlm, chatStream } from "@/lib/llm";

export function DailyReview({ embedded = false }: { embedded?: boolean } = {}) {
  const d = useReviewData();
  const [review, setReview] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [needConfig, setNeedConfig] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [flowSector, setFlowSector] = useState<{ code: string; name: string } | null>(null);

  const runReview = async () => {
    setReviewErr(null);
    setNeedConfig(false);
    if (!hasLlm()) { setNeedConfig(true); return; }
    setReviewLoading(true);
    setReview("");
    const prompt =
      `以下是今天 A 股大盘的客观数据：\n${d.dataSummary}\n\n` +
      "请用中文做一段当天大盘复盘：整体涨跌、主要指数表现、盘面值得注意的点。" +
      "只做客观陈述与多视角分析，不预测涨跌、不推荐任何标的、不构成投资建议。";
    try {
      await chatStream([{ role: "user", content: prompt }], `今日大盘数据：${d.dataSummary}`, {
        onDelta: (t) => setReview((r) => r + t),
      });
    } catch (e) {
      setReviewErr(e instanceof ApiError ? e.message : "复盘失败");
    } finally {
      setReviewLoading(false);
    }
  };

  const showReviewPanel = Boolean(aiOpen && (review || reviewLoading || needConfig || reviewErr));

  const moneyProps = {
    boardFlow: d.boardFlow,
    boardType: d.boardType,
    onBoardType: d.setBoardType,
    boardPeriod: d.boardPeriod,
    onBoardPeriod: d.setBoardPeriod,
    sectors: d.sectors,
    etfFlow: d.etfFlow,
    etfSort: d.etfSort,
    onEtfSort: d.setEtfSort,
    lpr: d.lpr,
    bondY: d.bondY,
    shChg: d.shChg,
    shType: d.shType,
    onShType: d.setShType,
    extraDone: d.extraDone,
    ovDone: d.ovDone,
    moneyDone: d.moneyDone,
    stockFlow: d.stockFlow,
    boardStockFlow: d.boardStockFlow,
    flowBoard: d.flowBoard,
    onFlowBoard: d.setFlowBoard,
  };

  const indexShared = {
    updatedLabel: d.topUpdatedLabel,
    session: d.session,
    indices: d.indices,
    idxErr: d.idxErr,
    idxMinute: d.idxMinute,
    idxMinuteDone: d.idxMinuteDone,
    globalIdx: d.globalIdx,
    watchCodes: d.watchCodes,
    watchQuotes: d.watchQuotes,
    watchMinute: d.watchMinute,
    watchDone: d.watchDone,
  };

  const rows: CockpitRow[] = [
    {
      defaultH: 0.30,
      panels: [
        {
          id: "index",
          title: "全球关键指数",
          defaultW: 0.28,
          mobileH: "h-[420px]",
          body: <WorldIndexPanel />,
        },
        {
          id: "sectors",
          title: "市场板块实时热点",
          defaultW: 0.36,
          mobileH: "h-[420px]",
          body: <SectorHotPanel />,
        },
        {
          id: "sentiment",
          title: "情绪 / 短线",
          defaultW: 0.36,
          mobileH: "h-[480px]",
          body: (
            <div className="grid h-full min-h-0 grid-rows-2 overflow-hidden">
              <div className="min-h-0 overflow-auto border-b border-slate-700/40">
                <ReviewSentimentPanel
                  sentiment={d.sentiment}
                  ovDone={d.ovDone}
                  updatedLabel={d.topUpdatedLabel}
                  indTop={d.indTop}
                  indBot={d.indBot}
                  pending={reviewPending(false, "lines")}
                  hsgt={d.hsgt}
                />
              </div>
              <div className="min-h-0 overflow-hidden">
                <ReviewShortPanel
                  emotion={d.emotion}
                  emoDone={d.emoDone}
                  updatedLabel={d.topUpdatedLabel}
                  pending={reviewPending(false, "lines")}
                />
              </div>
            </div>
          ),
        },
      ],
    },
    {
      defaultH: 0.34,
      panels: [
        {
          id: "flow",
          title: "板块资金流向",
          defaultW: 0.28,
          mobileH: "h-[380px]",
          body: (
            <BoardFlowLivePanel
              selected={flowSector}
              onSelect={setFlowSector}
            />
          ),
        },
        {
          id: "moneyflow",
          title: "主力净流入排行",
          defaultW: 0.24,
          mobileH: "h-[380px]",
          body: (
            <MoneyFlowRankPanel
              sectorFilter={flowSector}
              onClearSector={() => setFlowSector(null)}
            />
          ),
        },
        {
          id: "rank",
          title: "个股榜单",
          defaultW: 0.26,
          mobileH: "h-[380px]",
          body: <StockRankPanel />,
        },
        {
          id: "goods",
          title: "大宗商品",
          defaultW: 0.22,
          mobileH: "h-[380px]",
          body: <CommodityPanel />,
        },
      ],
    },
    {
      defaultH: 0.36,
      panels: [
        {
          id: "watch",
          title: `自选${d.watchCodes.length ? ` ${d.watchCodes.length}` : ""}`,
          defaultW: 0.28,
          mobileH: "h-[400px]",
          body: (
            <ReviewIndexPanel
              variant="watch"
              idxPanel="watch"
              onIdxPanel={d.setIdxPanel}
              {...indexShared}
            />
          ),
        },
        {
          id: "risk",
          title: "涨跌停 / 监控",
          defaultW: 0.36,
          mobileH: "h-[380px]",
          body: (
            <ReviewRiskSeg
              monitor={d.monitor}
              anomaly={d.anomaly}
              limitPool={d.limitPool}
              thsLimit={d.thsLimit}
              limitKind={d.limitKind}
              onLimitKind={d.setLimitKind}
              extraDone={d.extraDone}
            />
          ),
        },
        {
          id: "detail",
          title: "龙虎 / 资金 / 产业链",
          defaultW: 0.36,
          mobileH: "h-[520px]",
          maxZoomW: 0.78,
          right: (
            <ChipGroup>
              {([
                ["boards", "龙虎"],
                ["money", "资金"],
                ["chain", "产业链"],
              ] as const).map(([k, label]) => (
                <Chip key={k} active={d.seg === k} onClick={() => d.setSeg(k)}>{label}</Chip>
              ))}
            </ChipGroup>
          ),
          body: (
            <div className="h-full min-h-0 overflow-auto p-1">
              {d.seg === "boards" ? (
                <ReviewBoardsSeg
                  lhb={d.lhb}
                  lhbDone={d.lhbDone}
                  iwencaiReady={d.iwencaiReady}
                  iwencaiQ={d.iwencaiQ}
                  onIwencaiQ={d.setIwencaiQ}
                  iwencaiBusy={d.iwencaiBusy}
                  iwencaiErr={d.iwencaiErr}
                  iwencaiItems={d.iwencaiItems}
                  onRunIwencai={() => void d.runIwencai()}
                />
              ) : d.seg === "chain" ? (
                <ChainPanel />
              ) : (
                <ReviewMoneySeg {...moneyProps} section="rest" />
              )}
            </div>
          ),
        },
      ],
    },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#070b12] lg:h-full lg:overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-700/40 bg-[#0a101c] px-2 py-0.5">
        <p className="hidden truncate text-[10px] text-slate-500 sm:block">
          {d.today} · {d.session.hint} · {d.topUpdatedLabel}
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={d.refreshTopRows}
            disabled={d.topRefreshing}
            className="inline-flex items-center gap-1 rounded border border-slate-700/60 bg-slate-800/40 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-cyan-500/50 hover:text-cyan-300 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${d.topRefreshing ? "animate-spin" : ""}`} />
            刷新
          </button>
          <button
            type="button"
            onClick={() => d.setTopAuto((v) => !v)}
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              d.topAuto
                ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                : "border-slate-700/60 text-slate-500"
            }`}
          >
            自动 30s
          </button>
          <button
            type="button"
            onClick={() => { setAiOpen(true); void runReview(); }}
            disabled={reviewLoading}
            className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {reviewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            AI 复盘
          </button>
          <AskAiButton
            context={`今日大盘数据：${d.dataSummary}`}
            label="问 AI"
            suggestions={["今天大盘怎么走", "哪些指数领涨领跌", "盘面有什么值得注意"]}
          />
        </div>
      </div>
      <CockpitLayout rows={rows} />

      {showReviewPanel && (
        <div className="absolute inset-x-2 top-10 z-30 max-h-[70%] overflow-auto rounded-md border border-cyan-500/40 bg-[#0c1320] p-3 shadow-[0_0_32px_rgba(34,211,238,0.18)] sm:inset-x-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
              <Sparkles className="h-4 w-4 text-cyan-400" /> AI 当日复盘
            </h3>
            <div className="flex items-center gap-2">
              {reviewLoading && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 生成中
                </span>
              )}
              <button
                type="button"
                onClick={() => setAiOpen(false)}
                className="rounded border border-slate-700/60 p-1 text-slate-400 hover:text-cyan-300"
                title="关闭"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {needConfig && (
            <div className="mt-3 flex items-center gap-2 rounded border border-warning/30 bg-warning/5 p-3 text-sm text-slate-400">
              <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
              还没接入 AI。<Link to="/settings" className="text-cyan-400">先去接入你的 AI</Link>，之后一键出复盘。
            </div>
          )}
          {reviewErr && (
            <div className="mt-3 flex items-center gap-2 rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /> {reviewErr}
            </div>
          )}
          {review ? (
            <div className="prose prose-sm dark:prose-invert mt-3 max-w-none text-slate-200">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{review}</ReactMarkdown>
            </div>
          ) : null}
        </div>
      )}

      {!embedded && <Disclaimer />}
    </div>
  );
}
