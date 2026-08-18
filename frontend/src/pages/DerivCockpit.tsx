import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Activity, AlertCircle, Layers, LineChart, ListOrdered,
  Loader2, PieChart, RefreshCw, Sparkles, Star, Table, TrendingUp, Users, X, Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { CockpitLayout, type CockpitRow } from "@/components/cockpit/CockpitLayout";
import { useDerivData, type DerivData } from "@/hooks/useDerivData";
import { num } from "@/components/ovlab/shared";
import { formatClock } from "@/lib/freshness";
import { ApiError } from "@/lib/api";
import { chatStream, hasLlm } from "@/lib/llm";
import { cn } from "@/lib/utils";
import { IndexFutPanel } from "@/components/deriv/IndexFutPanel";
import { SectorHotPanel } from "@/components/deriv/SectorHotPanel";
import { AlertPanel } from "@/components/deriv/AlertPanel";
import { IvPanel } from "@/components/deriv/IvPanel";
import { RankMetricBar, RankPanel, type RankKey } from "@/components/deriv/RankPanel";
import { BreadthPanel } from "@/components/deriv/BreadthPanel";
import { TermStructPanel } from "@/components/deriv/TermStructPanel";
import { CommodityCell } from "@/components/deriv/CommodityCell";
import { WatchPanel } from "@/components/deriv/WatchPanel";
import { PositionCell } from "@/components/deriv/PositionCell";
import { TQuotePanel } from "@/components/deriv/TQuotePanel";
import { FreshTag, NightOnlySwitch, SessionBadge } from "@/components/deriv/derivShared";

/** Pack the visible cells in-browser for Ask AI; missing cells say 未取到. */
function packDerivContext(d: DerivData): string {
  const lines: string[] = ["# 期权/期货驾驶舱快照", `行情时间: ${formatClock(d.marketUpdated) || "未取到"}`];
  if (!d.rows) {
    lines.push("市场概览: 未取到");
  } else {
    lines.push("", "## 目录品种行情 (国内, 标的涨跌幅/平值隐波/隐波百分位)");
    for (const { def, row } of d.catalogRows) {
      const ctn = num(row.ctn);
      const iv = num(row.atmv_current);
      const ivp = num(row.atmv_percentile);
      lines.push(
        `- ${def.label}(${def.product}): 价 ${num(row.price)?.toFixed(2) ?? "-"}, 涨跌 ${ctn !== null ? (ctn * 100).toFixed(2) + "%" : "-"}, 隐波 ${iv?.toFixed(2) ?? "-"}, IVP ${ivp?.toFixed(0) ?? "-"}`,
      );
    }
  }
  if (!d.alerts) {
    lines.push("", "异动: 未取到");
  } else {
    lines.push("", `## 最新异动 (前 ${Math.min(15, d.alerts.length)} 条)`);
    for (const a of d.alerts.slice(0, 15)) {
      lines.push(`- ${String(a.time ?? "").slice(5, 16)} ${a.contract_code ?? "-"} ${a.rule_id ?? ""} ${a.pct_change ?? ""}`);
    }
  }
  return lines.join("\n");
}

export function DerivCockpit({ onPickSymbol }: { onPickSymbol?: (sym: string) => void }) {
  const d = useDerivData();
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [rankMetric, setRankMetric] = useState<RankKey>("ctn");
  const [nightOnly, setNightOnly] = useState(false);
  const [review, setReview] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [needConfig, setNeedConfig] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  useLayoutEffect(() => {
    setHeaderSlot(document.getElementById("cockpit-header-actions"));
  }, []);

  const sectorCount = d.rows
    ? new Set(d.rows.map((r) => String(r.sector_alias ?? "")).filter(Boolean)).size
    : 0;

  const runReview = async () => {
    setReviewErr(null);
    setNeedConfig(false);
    if (!hasLlm()) { setNeedConfig(true); return; }
    setReviewLoading(true);
    setReview("");
    try {
      const snap = packDerivContext(d);
      const prompt = [
        `以下是期权/期货驾驶舱的客观快照(与当前看板同源):\n${snap}`,
        "请写一段简洁的衍生品盘面复盘(中文, 300字内): 先总述股指/商品情绪与涨跌分布, 再点出隐波百分位极端(>=90 或 <=10)的品种, 最后列值得关注的异动合约。只陈述快照事实, 不做投资建议。",
      ].join("\n\n");
      await chatStream([{ role: "user", content: prompt }], snap, {
        onDelta: (t) => setReview((r) => r + t),
      });
    } catch (e) {
      setReviewErr(e instanceof ApiError ? e.message : "复盘失败");
    } finally {
      setReviewLoading(false);
    }
  };

  const showReviewPanel = Boolean(aiOpen && (review || reviewLoading || needConfig || reviewErr));

  const rows: CockpitRow[] = [
    {
      defaultH: 0.34,
      panels: [
        {
          id: "main-board",
          title: "股指 · 商品主力",
          hint: "紫色线为平值隐波",
          icon: <LineChart size={14} />,
          accent: "#38bdf8",
          defaultW: 0.44,
          mobileH: "h-[64vh]",
          right: (
            <span className="flex items-center gap-2">
              <NightOnlySwitch on={nightOnly} onChange={setNightOnly} />
              <FreshTag updated={d.marketUpdated} />
            </span>
          ),
          body: (
            <div className="flex h-full min-h-0 flex-col sm:flex-row">
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-b border-slate-800/60 sm:border-b-0 sm:border-r">
                <IndexFutPanel d={d} nightOnly={nightOnly} onPickSymbol={onPickSymbol} />
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                <CommodityCell d={d} nightOnly={nightOnly} onPickSymbol={onPickSymbol} />
              </div>
            </div>
          ),
        },
        {
          id: "sector-hot",
          title: "商品板块",
          hint: "同帧按板块聚合",
          icon: <Layers size={14} />,
          accent: "#2dd4bf",
          defaultW: 0.30,
          mobileH: "h-[46vh]",
          right: <FreshTag updated={d.marketUpdated} extra={`${sectorCount}板块`} />,
          body: <SectorHotPanel d={d} onPickSymbol={onPickSymbol} />,
        },
        {
          id: "alert",
          title: "异动 / 到期",
          icon: <Zap size={14} />,
          accent: "#f59e0b",
          defaultW: 0.26,
          mobileH: "h-[50vh]",
          right: <FreshTag updated={d.alertUpdated} extra={`${d.alerts?.length ?? 0}条`} />,
          body: <AlertPanel d={d} />,
        },
      ],
    },
    {
      defaultH: 0.34,
      panels: [
        {
          id: "iv",
          title: "隐波 / 溢价",
          icon: <Activity size={14} />,
          accent: "#a78bfa",
          defaultW: 0.26,
          mobileH: "h-[46vh]",
          right: <FreshTag updated={d.marketUpdated} />,
          body: <IvPanel d={d} onPickSymbol={onPickSymbol} />,
        },
        {
          id: "rank",
          title: "涨跌榜",
          icon: <ListOrdered size={14} />,
          accent: "#fbbf24",
          defaultW: 0.28,
          mobileH: "h-[46vh]",
          right: <RankMetricBar metric={rankMetric} onMetric={setRankMetric} />,
          body: <RankPanel d={d} metric={rankMetric} onPickSymbol={onPickSymbol} />,
        },
        {
          id: "breadth",
          title: "广度",
          hint: "涨跌分布 + IVP 直方图",
          icon: <PieChart size={14} />,
          accent: "#818cf8",
          defaultW: 0.22,
          mobileH: "h-[40vh]",
          right: <FreshTag updated={d.marketUpdated} />,
          body: <BreadthPanel d={d} />,
        },
        {
          id: "term-struct",
          title: "期限结构",
          hint: "近远月斜率",
          icon: <TrendingUp size={14} />,
          accent: "#34d399",
          defaultW: 0.24,
          mobileH: "h-[44vh]",
          right: <FreshTag updated={d.marketUpdated} />,
          body: <TermStructPanel d={d} />,
        },
      ],
    },
    {
      defaultH: 0.32,
      panels: [
        {
          id: "tquote",
          title: "T 型报价",
          hint: "理论价=Black-76",
          icon: <Table size={14} />,
          accent: "#e879f9",
          defaultW: 0.38,
          mobileH: "h-[56vh]",
          body: <TQuotePanel d={d} />,
        },
        {
          id: "watch",
          title: "自选合约",
          icon: <Star size={14} />,
          accent: "#22d3ee",
          defaultW: 0.34,
          mobileH: "h-[46vh]",
          right: <FreshTag updated={d.marketUpdated} extra="60s" />,
          body: <WatchPanel d={d} onPickSymbol={onPickSymbol} />,
        },
        {
          id: "position",
          title: "持仓排名",
          hint: "净多/净空第一",
          icon: <Users size={14} />,
          accent: "#fb7185",
          defaultW: 0.28,
          mobileH: "h-[44vh]",
          right: <FreshTag updated={d.marketUpdated} />,
          body: <PositionCell d={d} />,
        },
      ],
    },
  ];

  const headerActions = (
    <>
      <SessionBadge />
      <button
        type="button"
        onClick={d.refresh}
        disabled={d.refreshing}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded border border-slate-700/60 px-2 text-[10px] text-slate-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-300 disabled:opacity-50",
        )}
        title="重拉 market / 异动"
      >
        <RefreshCw className={cn("h-3 w-3", d.refreshing && "animate-spin")} />
        刷新
      </button>
      <button
        type="button"
        onClick={() => { setAiOpen(true); void runReview(); }}
        disabled={reviewLoading}
        className="inline-flex h-6 items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-2 text-[10px] text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
      >
        {reviewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        AI 复盘
      </button>
      <AskAiButton
        context=""
        getContext={() => packDerivContext(d)}
        label="问 AI"
        scopeKey="deriv"
        suggestions={[
          "今天哪些品种隐波百分位极端?",
          "商品板块强弱如何?",
          "最新异动集中在哪些合约?",
        ]}
      />
    </>
  );

  return (
    <div className="relative flex flex-col bg-background lg:h-full lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      {headerSlot ? createPortal(headerActions, headerSlot) : null}
      <CockpitLayout rows={rows} />

      {showReviewPanel && (
        <div className="absolute inset-x-2 top-10 z-30 max-h-[70%] overflow-auto rounded-md border border-cyan-500/40 bg-card p-3 shadow-[0_0_32px_rgba(34,211,238,0.18)] sm:inset-x-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
              <Sparkles className="h-4 w-4 text-cyan-400" /> AI 衍生品复盘
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
          <p className="mt-1 text-[10px] text-slate-500">
            已带入当前看板各格快照 (股指衍生 / 商品板块 / 隐波 / 涨跌榜 / 异动等)
          </p>
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
    </div>
  );
}
