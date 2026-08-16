import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as echarts from "echarts";
import { Copy, Play, Star, Trash2, Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  api,
  ApiError,
  type BacktestEvent,
  type BacktestResult,
  type BacktestRunSummary,
  type BacktestStrategy,
} from "@/lib/api";
import { loadWatch, parseCodes } from "@/lib/watchlist";
import { storageGet, storageSet } from "@/lib/storage";
import { cn } from "@/lib/utils";

const CFG_KEY = "vr-backtest-v1";
const REJECT_LABEL: Record<string, string> = {
  limit_up: "涨停买不进",
  limit_down: "跌停卖不出",
  t1: "T+1",
  no_cash: "现金不够",
  no_lot: "不够一手",
  no_slot: "没有空槽",
  no_price: "没有价",
  no_next_bar: "末日没有下一根",
  already_held: "已持有",
  end_forced: "收盘强平",
};

type Lookback = "1y" | "2y" | "3y";

interface Draft {
  codes: string;
  lookback: Lookback;
  strategy: BacktestStrategy;
  shortWin: number;
  longWin: number;
  events: string;
  fill: "open_t+1" | "close_t";
  capital: number;
  maxPositions: number;
  commissionPct: number;
  commissionMin: number;
  stampTaxPct: number;
  slippageBps: number;
  oosMode: "off" | "30" | "20" | "wf";
  tuneMa: boolean;
}

const STRATS: { id: BacktestStrategy; label: string; hint: string }[] = [
  { id: "hold", label: "买入持有", hint: "第一根可买日开仓, 拿到结束" },
  { id: "ma_cross", label: "均线金叉死叉", hint: "短均线上穿长均线买, 下穿卖" },
  { id: "dates", label: "指定买卖日", hint: "一行一条: 600519 buy 2024-03-01" },
];

function defaultDraft(): Draft {
  const watch = loadWatch();
  return {
    codes: watch.slice(0, 20).join(" ") || "600519",
    lookback: "2y",
    strategy: "hold",
    shortWin: 5,
    longWin: 20,
    events: "",
    fill: "open_t+1",
    capital: 1_000_000,
    maxPositions: 10,
    commissionPct: 0.025,
    commissionMin: 5,
    stampTaxPct: 0.05,
    slippageBps: 5,
    oosMode: "30",
    tuneMa: true,
  };
}

function loadDraft(): Draft {
  const raw = storageGet(CFG_KEY);
  if (!raw) return defaultDraft();
  try {
    return { ...defaultDraft(), ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    return defaultDraft();
  }
}

function parseEvents(raw: string): BacktestEvent[] {
  const out: BacktestEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{6})\s+(buy|sell)\s+(\d{4}-\d{2}-\d{2})$/i);
    if (!m) continue;
    out.push({ code: m[1], side: m[2].toLowerCase() as "buy" | "sell", date: m[3] });
  }
  return out;
}

function fmtPct(v: number | null | undefined, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 2) {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v)) return "—";
  return v.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function tone(v: number | null | undefined) {
  if (v == null || Number.isNaN(v) || v === 0) return "text-slate-300";
  return v > 0 ? "text-red-400" : "text-emerald-400";
}

function buildCopy(result: BacktestResult, codes: string[]) {
  const s = result.stats;
  const rej = Object.entries(result.execution.rejects)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${REJECT_LABEL[k] || k} ${n}`)
    .join(" / ");
  const lines = [
    "Vibe-Research 回测摘要 (研究模拟, 不荐股)",
    `标的: ${codes.join(", ")}`,
    `区间: ${result.universe?.start || "?"} ~ ${result.universe?.end || "?"} · ${result.universe?.bars || 0} 根`,
    `策略: ${result.strategy?.name || "?"}`,
    `净值: ${fmtNum(s.initial_capital, 0)} → ${fmtNum(s.final_equity, 0)} · 收益 ${fmtPct(s.total_return)} · CAGR ${fmtPct(s.cagr)}`,
    `夏普 ${s.sharpe.toFixed(2)} · 波动 ${fmtPct(s.vol)} · 最大回撤 ${fmtPct(s.max_drawdown)}`,
    s.excess_return != null ? `相对沪深300超额 ${fmtPct(s.excess_return)}` : "",
    result.oos
      ? `样本外切点 ${result.oos.split} · 续跑收益 ${fmtPct(result.oos.stats_oos.total_return)} · 新开账户 ${fmtPct(result.oos.stats_oos_fresh.total_return)}`
      : "",
    result.walk_forward
      ? `滚动切窗 ${result.walk_forward.summary.folds} 折 · 平均夏普 ${result.walk_forward.summary.mean_sharpe.toFixed(2)}`
      : "",
    `成交 ${s.trades} 笔 · 完成回合 ${s.round_trips} · 胜率 ${fmtPct(s.win_rate)}`,
    result.run_id ? `实验 ${result.run_id} · 数据哈希 ${result.data_hash || "?"}` : "",
    result.data_hash_match === false
      ? `行情已变, 实验哈希 ${result.data_hash || "?"} 现在 ${result.data_hash_now || "?"}`
      : result.data_hash_match === true
        ? "本机行情与实验哈希一致"
        : "",
    rej ? `未按信号成交: ${rej}` : "未按信号成交: 无",
    ...(result.warnings || []).map((w) => `注意: ${w}`),
  ];
  return lines.filter(Boolean).join("\n");
}

function EquityChart({ result }: { result: BacktestResult }) {
  const elRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const inst = echarts.init(el, undefined, { renderer: "canvas" });
    instRef.current = inst;
    const onResize = () => inst.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      inst.dispose();
      instRef.current = null;
    };
  }, []);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;
    const dates = result.equity_curve.map((p) => p.date);
    const eq = result.equity_curve.map((p) => p.equity);
    const dd = result.drawdown_curve.map((p) => p.drawdown * 100);
    const benchMap = new Map((result.benchmark?.curve || []).map((p) => [p.date, p.equity]));
    const bench = dates.map((d) => benchMap.get(d) ?? null);
    inst.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        backgroundColor: "#0f172a",
        borderColor: "#334155",
        textStyle: { color: "#e2e8f0", fontSize: 11 },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 56, right: 16, top: 28, height: "54%" },
        { left: 56, right: 16, top: "78%", height: "16%" },
      ],
      xAxis: [
        { type: "category", data: dates, gridIndex: 0, axisLabel: { show: false }, axisLine: { lineStyle: { color: "#334155" } } },
        { type: "category", data: dates, gridIndex: 1, axisLabel: { color: "#64748b", fontSize: 10 }, axisLine: { lineStyle: { color: "#334155" } } },
      ],
      yAxis: [
        {
          type: "value",
          gridIndex: 0,
          splitLine: { lineStyle: { color: "#1e293b" } },
          axisLabel: {
            color: "#64748b",
            fontSize: 10,
            formatter: (v: number) => `${Math.round(v / 10000)}万`,
          },
        },
        {
          type: "value",
          gridIndex: 1,
          splitLine: { lineStyle: { color: "#1e293b" } },
          axisLabel: { color: "#64748b", fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` },
        },
      ],
      legend: { top: 0, textStyle: { color: "#94a3b8", fontSize: 10 } },
      series: [
        {
          name: "净值",
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: eq,
          showSymbol: false,
          lineStyle: { color: "#22d3ee", width: 1.6 },
          areaStyle: { color: "rgba(34,211,238,0.12)" },
          markLine: result.oos?.split
            ? {
                symbol: "none",
                label: { color: "#fbbf24", fontSize: 10, formatter: "样本外" },
                lineStyle: { color: "#fbbf24", type: "dashed" },
                data: [{ xAxis: result.oos.split }],
              }
            : undefined,
        },
        {
          name: result.benchmark?.name || "沪深300",
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: bench,
          showSymbol: false,
          lineStyle: { color: "#f59e0b", width: 1.2, type: "dashed" },
        },
        {
          name: "回撤",
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: dd,
          showSymbol: false,
          lineStyle: { color: "#34d399", width: 1 },
          areaStyle: { color: "rgba(52,211,153,0.12)" },
        },
      ],
    });
    inst.resize();
  }, [result]);

  return <div ref={elRef} className="h-[320px] w-full" />;
}

export function Backtest() {
  const [params] = useSearchParams();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [runs, setRuns] = useState<BacktestRunSummary[]>([]);
  const boot = useRef(false);

  async function refreshRuns() {
    try {
      setRuns(await api.backtestRuns(20));
    } catch {
      setRuns([]);
    }
  }

  useEffect(() => {
    storageSet(CFG_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    void refreshRuns();
  }, []);

  const codes = useMemo(() => parseCodes(draft.codes).slice(0, 20), [draft.codes]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  async function runWith(next: Draft) {
    const list = parseCodes(next.codes).slice(0, 20);
    if (!list.length) {
      setError("先填至少 1 个 6 位 A 股代码");
      return;
    }
    setRunning(true);
    setError("");
    try {
      const oosOn = next.oosMode !== "off";
      const body = {
        codes: list,
        strategy: next.strategy,
        lookback: next.lookback,
        fill: next.fill,
        initial_capital: next.capital,
        max_positions: next.maxPositions,
        commission_pct: next.commissionPct / 100,
        commission_min: next.commissionMin,
        stamp_tax_pct: next.stampTaxPct / 100,
        slippage_bps: next.slippageBps,
        short_win: next.shortWin,
        long_win: next.longWin,
        events: next.strategy === "dates" ? parseEvents(next.events) : [],
        oos_frac: next.oosMode === "20" ? 0.2 : next.oosMode === "30" ? 0.3 : undefined,
        tune_ma: oosOn && next.tuneMa && next.strategy === "ma_cross",
        walk_forward: next.oosMode === "wf",
      };
      const out = await api.backtestRun(body);
      setResult(out);
      void refreshRuns();
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? e.message : "回测失败");
    } finally {
      setRunning(false);
    }
  }

  async function run() {
    await runWith(draft);
  }

  useEffect(() => {
    if (boot.current) return;
    const q = params.get("codes");
    if (!q) return;
    const parsed = parseCodes(q).slice(0, 20);
    if (!parsed.length) return;
    boot.current = true;
    const next: Draft = {
      ...loadDraft(),
      codes: parsed.join(" "),
      maxPositions: Math.min(20, Math.max(parsed.length, 1)),
      strategy: params.get("from") === "portfolio" ? "hold" : loadDraft().strategy,
      oosMode: "30",
    };
    setDraft(next);
    if (params.get("autostart") === "1") void runWith(next);
  }, [params]);

  async function copySummary() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildCopy(result, codes));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("复制失败, 请手动选中摘要");
    }
  }

  const rejects = result
    ? Object.entries(result.execution.rejects).filter(([, n]) => n > 0)
    : [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      <PageHeader
        title="回测"
        subtitle="A 股日线账户模拟. 信号日不等于成交日, 默认次日开盘. 研究用, 不荐股、不预测."
        actions={
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/15 px-3 py-1 text-[12px] font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {running ? "在跑…" : "跑回测"}
          </button>
        }
      />

      <div className="mb-3 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-100/80">
        一笔共享现金 · T+1 · 整手 100 · 佣金双边 · 印花税只卖 · 涨跌停看成交价对昨收.
        每只预算 = 净值 / 最大持仓数. 满仓 5 只就把最大持仓设成 5. ST 的 5% 从代码看不出来.
        原始价和复权因子分开, 只写已收盘 K. 实验落本机 runs/ 写完不改.
      </div>

      {runs.length > 0 && (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {runs.map((r) => {
            const active = result?.run_id === r.id;
            const name = typeof r.strategy === "string" ? r.strategy : r.strategy?.name;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  void api.backtestRunGet(r.id).then(setResult).catch((e) => {
                    setError(e instanceof ApiError ? e.message : "读实验失败");
                  });
                }}
                className={cn(
                  "shrink-0 rounded border px-2 py-1 text-left text-[10px]",
                  active ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-100" : "border-slate-700 text-slate-400 hover:text-slate-200",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono">{r.id.slice(0, 15)}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="text-slate-600 hover:text-rose-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      void api.backtestRunDelete(r.id).then(() => {
                        if (result?.run_id === r.id) setResult(null);
                        void refreshRuns();
                      });
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                </div>
                <div>
                  {name || "run"} · {r.total_return != null ? fmtPct(r.total_return) : "—"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        <GlassCard className="h-fit space-y-3 lg:sticky lg:top-2">
          <label className="block">
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
              <span>标的 (最多 20)</span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-200"
                  onClick={() => patch({ codes: loadWatch().slice(0, 20).join(" ") })}
                >
                  <Star className="h-3 w-3" />
                  自选
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-200"
                  onClick={() => {
                    void api.portfolio().then((p) => {
                      const got = (p.holdings || []).map((h) => h.code).filter(Boolean);
                      if (got.length) patch({ codes: got.slice(0, 20).join(" ") });
                    }).catch(() => setError("持仓没取到"));
                  }}
                >
                  <Wallet className="h-3 w-3" />
                  持仓
                </button>
              </span>
            </div>
            <textarea
              value={draft.codes}
              onChange={(e) => patch({ codes: e.target.value })}
              rows={3}
              className="w-full resize-y rounded border border-slate-700 bg-slate-950/60 px-2 py-1.5 font-mono text-[12px] text-slate-100 outline-none focus:border-cyan-500/50"
              placeholder="600519 000858 300750"
            />
            <p className="mt-1 text-[10px] text-slate-500">已识别 {codes.length} 只</p>
          </label>

          <div>
            <p className="mb-1 text-[11px] text-slate-400">区间</p>
            <div className="flex gap-1">
              {(["1y", "2y", "3y"] as Lookback[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => patch({ lookback: k })}
                  className={cn(
                    "rounded border px-2.5 py-1 text-[11px]",
                    draft.lookback === k
                      ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200"
                      : "border-slate-700 text-slate-400 hover:text-slate-200",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-[11px] text-slate-400">样本外</p>
            <div className="flex flex-wrap gap-1">
              {([
                ["off", "关"],
                ["30", "后 30%"],
                ["20", "后 20%"],
                ["wf", "滚动切窗"],
              ] as const).map(([k, lab]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => patch({ oosMode: k })}
                  className={cn(
                    "rounded border px-2.5 py-1 text-[11px]",
                    draft.oosMode === k
                      ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200"
                      : "border-slate-700 text-slate-400 hover:text-slate-200",
                  )}
                >
                  {lab}
                </button>
              ))}
            </div>
            {draft.oosMode !== "off" && draft.strategy === "ma_cross" && (
              <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={draft.tuneMa}
                  onChange={(e) => patch({ tuneMa: e.target.checked })}
                />
                只在样本内选均线, 样本外冻结
              </label>
            )}
            <p className={cn("mt-1 text-[10px]", draft.oosMode === "wf" && draft.lookback === "1y" ? "text-amber-200/80" : "text-slate-500")}>
              {draft.oosMode === "wf" && draft.lookback === "1y"
                ? "滚动切窗默认要 1 年训 + 1 季验, 1y 日 K 不够, 请改成 2y 或 3y."
                : draft.oosMode === "wf"
                  ? "每折 1 年训练 / 1 季检验, 新开账户. 不是把整段净值切开."
                  : draft.oosMode === "off"
                    ? "关掉后只看全样本, 均线会用到未来信息来挑参数."
                    : "切点后另开一笔钱验. 续跑数字和新建账户分开报."}
            </p>
          </div>

          <div className="space-y-1.5">
            {STRATS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => patch({ strategy: s.id })}
                className={cn(
                  "w-full rounded border px-2.5 py-2 text-left",
                  draft.strategy === s.id
                    ? "border-cyan-500/50 bg-cyan-500/10"
                    : "border-slate-700/70 hover:border-slate-500",
                )}
              >
                <div className="text-[12px] text-slate-100">{s.label}</div>
                <div className="text-[10px] text-slate-500">{s.hint}</div>
              </button>
            ))}
          </div>

          {draft.strategy === "ma_cross" && (
            <div className="grid grid-cols-2 gap-2">
              <NumField label="短均线" value={draft.shortWin} onChange={(v) => patch({ shortWin: v })} />
              <NumField label="长均线" value={draft.longWin} onChange={(v) => patch({ longWin: v })} />
            </div>
          )}
          {draft.strategy === "dates" && (
            <textarea
              value={draft.events}
              onChange={(e) => patch({ events: e.target.value })}
              rows={4}
              className="w-full rounded border border-slate-700 bg-slate-950/60 px-2 py-1.5 font-mono text-[11px] text-slate-100 outline-none focus:border-cyan-500/50"
              placeholder={"600519 buy 2024-03-01\n600519 sell 2024-06-01"}
            />
          )}

          <div className="grid grid-cols-2 gap-2">
            <NumField label="本金" value={draft.capital} onChange={(v) => patch({ capital: v })} />
            <NumField label="最大持仓" value={draft.maxPositions} onChange={(v) => patch({ maxPositions: v })} />
          </div>

          <details className="rounded border border-slate-800 bg-slate-950/40 px-2 py-1.5">
            <summary className="cursor-pointer text-[11px] text-slate-400">费用与成交</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <NumField label="佣金 %" value={draft.commissionPct} step={0.001} onChange={(v) => patch({ commissionPct: v })} />
              <NumField label="佣金最低" value={draft.commissionMin} onChange={(v) => patch({ commissionMin: v })} />
              <NumField label="印花税 %" value={draft.stampTaxPct} step={0.001} onChange={(v) => patch({ stampTaxPct: v })} />
              <NumField label="滑点 bps" value={draft.slippageBps} onChange={(v) => patch({ slippageBps: v })} />
            </div>
            <div className="mt-2 flex gap-1">
              {(["open_t+1", "close_t"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => patch({ fill: f })}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[10px]",
                    draft.fill === f
                      ? "border-cyan-500/50 text-cyan-200"
                      : "border-slate-700 text-slate-500",
                  )}
                >
                  {f === "open_t+1" ? "次日开盘" : "当日收盘"}
                </button>
              ))}
            </div>
          </details>
        </GlassCard>

        <div className="space-y-3">
          {error && <p className="text-[12px] text-rose-300">{error}</p>}
          {!result && !running && (
            <GlassCard>
              <EmptyState
                title="还没有跑过"
                description="左边填自选或持仓代码, 选策略, 点跑回测. 第一次会拉日 K 落到本机, 之后同一段会快很多."
              />
            </GlassCard>
          )}
          {running && (
            <GlassCard>
              <EmptyState title="在算" loading />
            </GlassCard>
          )}
          {result && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="收益" value={fmtPct(result.stats.total_return)} className={tone(result.stats.total_return)} />
                <Stat label="CAGR" value={fmtPct(result.stats.cagr)} className={tone(result.stats.cagr)} />
                <Stat label="夏普" value={result.stats.sharpe.toFixed(2)} />
                <Stat label="最大回撤" value={fmtPct(result.stats.max_drawdown)} className={tone(result.stats.max_drawdown)} />
                <Stat label="波动" value={fmtPct(result.stats.vol)} />
                <Stat label="胜率" value={fmtPct(result.stats.win_rate)} />
                <Stat label="成交" value={`${result.stats.trades} 笔`} />
                <Stat
                  label="相对300"
                  value={result.stats.excess_return == null ? "—" : fmtPct(result.stats.excess_return)}
                  className={tone(result.stats.excess_return ?? 0)}
                />
                {result.oos && (
                  <>
                    <Stat
                      label="样本外续跑"
                      value={fmtPct(result.oos.stats_oos.total_return)}
                      className={tone(result.oos.stats_oos.total_return)}
                    />
                    <Stat
                      label="样本外新开"
                      value={fmtPct(result.oos.stats_oos_fresh.total_return)}
                      className={tone(result.oos.stats_oos_fresh.total_return)}
                    />
                    <Stat label="样本外夏普" value={result.oos.stats_oos_fresh.sharpe.toFixed(2)} />
                  </>
                )}
              </div>

              <GlassCard className="p-2 sm:p-3">
                <div className="mb-1 flex items-center justify-between px-1">
                  <p className="text-[11px] text-slate-400">
                    {result.universe?.start} ~ {result.universe?.end} · {result.universe?.bars} 根
                    {result.run_id ? ` · ${result.run_id}` : ""}
                    {result.data_hash ? ` · ${result.data_hash}` : ""}
                    {result.data_hash_match === true ? " · 行情未变" : ""}
                    {result.data_hash_match === false ? (
                      <span className="text-amber-300"> · 行情已变</span>
                    ) : null}
                    {result.closed_end ? ` · 已收盘至 ${result.closed_end}` : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => void copySummary()}
                    className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-200"
                  >
                    <Copy className="h-3 w-3" />
                    {copied ? "已复制" : "复制给 AI"}
                  </button>
                </div>
                <EquityChart result={result} />
              </GlassCard>

              {rejects.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {rejects.map(([k, n]) => (
                    <span
                      key={k}
                      className="rounded border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300"
                    >
                      {REJECT_LABEL[k] || k} {n}
                    </span>
                  ))}
                </div>
              )}

              {result.walk_forward && (
                <GlassCard className="overflow-x-auto p-0">
                  <p className="px-2 py-1.5 text-[11px] text-slate-400">
                    滚动切窗 {result.walk_forward.summary.folds} 折 · 平均夏普{" "}
                    {result.walk_forward.summary.mean_sharpe.toFixed(2)} · 拼接收益{" "}
                    {fmtPct(result.walk_forward.summary.compound_return)}
                  </p>
                  <table className="w-full min-w-[640px] text-left text-[11px]">
                    <thead className="text-slate-500">
                      <tr className="border-b border-slate-800">
                        {["训练", "检验", "均线", "收益", "夏普"].map((h) => (
                          <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.walk_forward.folds.map((f) => (
                        <tr key={`${f.oos_start}-${f.oos_end}`} className="border-b border-slate-800/70">
                          <td className="px-2 py-1 font-mono text-slate-400">{f.is_start} ~ {f.is_end}</td>
                          <td className="px-2 py-1 font-mono text-slate-300">{f.oos_start} ~ {f.oos_end}</td>
                          <td className="px-2 py-1">{f.short_win}/{f.long_win}</td>
                          <td className={cn("px-2 py-1 font-mono", tone(f.stats.total_return))}>{fmtPct(f.stats.total_return)}</td>
                          <td className="px-2 py-1 font-mono">{f.stats.sharpe.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </GlassCard>
              )}

              {(result.warnings || []).length > 0 && (
                <ul className="space-y-0.5 text-[11px] text-amber-200/80">
                  {result.warnings!.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}

              <GlassCard className="overflow-x-auto p-0">
                <table className="w-full min-w-[720px] text-left text-[11px]">
                  <thead className="text-slate-500">
                    <tr className="border-b border-slate-800">
                      {["日期", "信号日", "代码", "方向", "价", "股数", "佣金", "印花税", "盈亏", "原因"].map((h) => (
                        <th key={h} className="px-2 py-1.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={`${t.date}-${t.symbol}-${t.side}-${i}`} className="border-b border-slate-800/70">
                        <td className="px-2 py-1 font-mono text-slate-300">{t.date}</td>
                        <td className="px-2 py-1 font-mono text-slate-500">{t.signal_date}</td>
                        <td className="px-2 py-1 font-mono">
                          {t.symbol.replace(/^(sh|sz|bj)/, "")}
                          {t.name ? <span className="ml-1 text-slate-500">{t.name}</span> : null}
                        </td>
                        <td className={cn("px-2 py-1", t.side === "buy" ? "text-red-400" : "text-emerald-400")}>
                          {t.side === "buy" ? "买" : "卖"}
                        </td>
                        <td className="px-2 py-1 font-mono tabular-nums">{fmtNum(t.price, 3)}</td>
                        <td className="px-2 py-1 font-mono tabular-nums">{t.shares}</td>
                        <td className="px-2 py-1 font-mono tabular-nums text-slate-400">{fmtNum(t.commission, 2)}</td>
                        <td className="px-2 py-1 font-mono tabular-nums text-slate-400">{fmtNum(t.stamp_tax, 2)}</td>
                        <td className={cn("px-2 py-1 font-mono tabular-nums", tone(t.pnl ?? 0))}>
                          {t.pnl == null ? "—" : fmtNum(t.pnl, 2)}
                        </td>
                        <td className="px-2 py-1 text-slate-500">{t.reason === "end" ? "收盘强平" : "信号"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.trades.length === 0 && (
                  <p className="px-3 py-6 text-center text-[12px] text-slate-500">这段没有成交</p>
                )}
              </GlassCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <GlassCard className="py-2">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={cn("mt-0.5 font-mono text-[16px] tabular-nums", className)}>{value}</p>
    </GlassCard>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] text-slate-500">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-slate-700 bg-slate-950/60 px-2 py-1 font-mono text-[12px] text-slate-100 outline-none focus:border-cyan-500/50"
      />
    </label>
  );
}
