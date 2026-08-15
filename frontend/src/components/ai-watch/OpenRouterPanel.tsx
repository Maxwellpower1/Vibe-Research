import { Fragment, useMemo, useRef, useState } from "react";
import { Cpu } from "lucide-react";
import { Panel, type PanelZoomProps } from "@/components/cockpit/Panel";
import { useAsyncPoll } from "@/hooks/useAiWatch";
import { useElementSize } from "@/hooks/useElementSize";
import { api, type OrUsageDay } from "@/lib/api";
import { computeOrChart } from "./openrouter-chart-math";

function fmtT(t: number): string {
  if (t >= 1e12) return `${(t / 1e12).toFixed(1)}T`;
  if (t >= 1e9) return `${(t / 1e9).toFixed(1)}B`;
  if (t >= 1e6) return `${(t / 1e6).toFixed(1)}M`;
  return String(t);
}

const PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
  "#86bcb6", "#d4a6c8", "#f1ce63", "#a0cbe8", "#e377c2",
  "#7f7f7f", "#00bcd4", "#ff5722", "#8bc34a",
];

const RANGE_DAYS: Record<"7d" | "14d" | "30d" | "60d" | "180d" | "1y", number> = {
  "7d": 7, "14d": 14, "30d": 30, "60d": 60, "180d": 180, "1y": 365,
};

const KNOWN_COLORS: Record<string, string> = {
  腾讯: "#4e79a7", 小米: "#f28e2b", DeepSeek: "#e15759", Anthropic: "#76b7b2",
  Google: "#59a14f", OpenAI: "#edc948", 智谱GLM: "#b07aa1", 月之暗面: "#ff9da7",
  MiniMax: "#9c755f", 阶跃星辰: "#bab0ac", NVIDIA: "#86bcb6", Mistral: "#d4a6c8",
  Meta: "#f1ce63", xAI: "#a0cbe8", Cohere: "#e377c2", 通义千问: "#7f7f7f",
  Poolside: "#00bcd4", inclusionai: "#ff5722", "nex-agi": "#8bc34a",
  其他: "#64748b", "🇨🇳中国": "#ef4444", "🇺🇸美国": "#3b82f6", "🌍其他": "#64748b",
};

function vendorColor(name: string): string {
  if (KNOWN_COLORS[name]) return KNOWN_COLORS[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function Chart({
  allDays, days, mode, agg,
}: {
  allDays: OrUsageDay[];
  days: OrUsageDay[];
  mode: "vendor" | "country";
  agg: "day" | "week";
}) {
  const { ref: boxRef, size } = useElementSize();
  const [hover, setHover] = useState<number | null>(null);
  const [hoverLayer, setHoverLayer] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const chart = useMemo(() => computeOrChart(allDays, days, mode, size), [allDays, days, mode, size]);
  const empty = !days || days.length < 2;

  // Keep boxRef on a stable wrapper. computeOrChart needs measured W/H; an early
  // return without the ref leaves size at 0 and the panel stuck on 暂无数据.
  return (
    <div ref={boxRef} className="relative flex h-full min-h-0 w-full flex-col">
      {!chart ? (
        <div className="flex h-full items-center justify-center text-[11px] text-slate-600">
          {empty ? "暂无数据" : ""}
        </div>
      ) : (
      <>
      <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-0.5 pb-1 text-[9px]">
        {chart.areas.map((a) => (
          <span key={a.name} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: vendorColor(a.name) }} />
            {a.name}
          </span>
        ))}
      </div>
      <div className="flex shrink-0 items-baseline gap-3 pb-1 text-[10px]">
        <span className="font-semibold text-slate-200">{fmtT(chart.last)}</span>
        <span className={chart.chg >= 0 ? "text-emerald-400" : "text-red-400"}>
          {chart.chg >= 0 ? "↑" : "↓"} {Math.abs(chart.chgPct) > 0.01 ? `${chart.chgPct > 0 ? "+" : ""}${chart.chgPct.toFixed(1)}%` : "0%"}
        </span>
        <span className="text-slate-500">{agg === "week" ? "周均" : "日均"} {fmtT(Math.round(chart.avg))}</span>
        <span className="text-slate-500">{agg === "week" ? "周增速" : "日增速"} {chart.dailyRate > 0.001 ? `+${chart.dailyRate.toFixed(2)}%` : `${chart.dailyRate.toFixed(2)}%`}</span>
      </div>
      <svg
        ref={svgRef}
        width={chart.W}
        height={chart.H - 36}
        className="block flex-1"
        style={{ overflow: "visible" }}
        onMouseLeave={() => { setHover(null); setHoverLayer(null); }}
        onMouseMove={(e) => {
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          const mx = e.clientX - rect.left;
          const n = chart.stacked.length;
          const i = Math.round(((mx - chart.PL) / (chart.W - chart.PL - chart.PR)) * (n - 1));
          setHover(i >= 0 && i < n ? i : null);
        }}
      >
        {chart.yTicks.map((t, i) => (
          <line key={i} x1={chart.PL} y1={t.y} x2={chart.W - chart.PR} y2={t.y} stroke="#1e293b" strokeWidth={0.5} />
        ))}
        {hover != null && (
          <line x1={chart.X(hover)} y1={8} x2={chart.X(hover)} y2={chart.H - 36 - 4} stroke="rgba(148,163,184,0.6)" strokeWidth={0.8} strokeDasharray="3 3" />
        )}
        {chart.areas.map((a) => (
          <path
            key={a.name}
            d={a.d}
            fill={vendorColor(a.name)}
            opacity={hoverLayer == null || hoverLayer === a.name ? 1 : 0.25}
            onMouseEnter={() => setHoverLayer(a.name)}
            onMouseLeave={() => setHoverLayer(null)}
          />
        ))}
        {chart.xLabels.map((xl, i) => (
          <Fragment key={i}>
            <line x1={xl.x} y1={8} x2={xl.x} y2={chart.H - 36 - 4} stroke="rgba(148,163,184,0.15)" strokeWidth={0.5} />
            <text x={xl.x} y={chart.H - 52} textAnchor="middle" fill="#94a3b8" fontSize={9} fontFamily="monospace">{xl.label}</text>
          </Fragment>
        ))}
        {chart.yTicks.map((t, i) => (
          <text key={`y${i}`} x={chart.PL - 4} y={t.y + 3} textAnchor="end" fill="#64748b" fontSize={8} fontFamily="monospace">{fmtT(Math.round(t.v))}</text>
        ))}
        {hover != null && (
          <circle cx={chart.X(hover)} cy={chart.Y(chart.stacked[hover].total)} r={2.5} fill="#a78bfa" />
        )}
      </svg>
      {hover != null && chart.stacked[hover] && (
        <div
          className="pointer-events-none absolute z-10 min-w-[150px] rounded border border-border bg-card/95 p-1.5"
          style={{ left: Math.min(Math.max(chart.X(hover) - 75, 4), chart.W - 160), top: 4 }}
        >
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[10px]">
            <span className="font-semibold text-slate-200">{chart.stacked[hover].date}</span>
            <span className="font-mono text-slate-400">{fmtT(chart.stacked[hover].total)}</span>
          </div>
          <div className="max-h-[130px] space-y-px overflow-y-auto">
            {chart.ord.map((v) => {
              const s = chart.stacked[hover];
              const val = v === "其他" ? s.other : s.m[v] || 0;
              if (val <= 0) return null;
              const pct = s.total > 0 ? (val / s.total) * 100 : 0;
              return (
                <div key={v} className="flex items-center gap-1.5 text-[9px] leading-3">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: vendorColor(v) }} />
                  <span className="w-14 shrink-0 truncate text-slate-400">{v}</span>
                  <span className="ml-auto font-mono text-slate-200">{fmtT(val)}</span>
                  <span className="w-9 text-right font-mono text-slate-500">{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

function aggregateWeekly(days: OrUsageDay[]): OrUsageDay[] {
  const out: OrUsageDay[] = [];
  let bucket: OrUsageDay | null = null;
  let weekStart = 0;
  for (const d of days) {
    const t = Date.parse(`${d.date}T00:00:00Z`);
    if (!bucket || t - weekStart >= 7 * 86400000) {
      if (bucket) out.push(bucket);
      weekStart = t;
      bucket = { date: d.date, total: 0, providers: [], countries: [] };
    }
    bucket.date = d.date;
    bucket.total += d.total;
    for (const key of ["providers", "countries"] as const) {
      const target = bucket[key];
      for (const p of d[key]) {
        const ex = target.find((x) => x.name === p.name);
        if (ex) {
          ex.tokens += p.tokens;
          ex.pct = p.pct;
        } else {
          target.push({ ...p });
        }
      }
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

export function OpenRouterPanel({ className, panelId, isZoomed, onToggleZoom }: PanelZoomProps & { className?: string }) {
  const [range, setRange] = useState<"7d" | "14d" | "30d" | "60d" | "180d" | "1y">("30d");
  const [mode, setMode] = useState<"vendor" | "country">("vendor");
  const [agg, setAgg] = useState<"day" | "week">("day");
  const { data, loading, error } = useAsyncPoll(() => api.openRouterUsage());

  const sliced = useMemo(() => {
    if (!data || data.length === 0) return [];
    const days = data.slice(-RANGE_DAYS[range]);
    return agg === "week" ? aggregateWeekly(days) : days;
  }, [data, range, agg]);

  return (
    <Panel title="公有云 Token 消耗" icon={<Cpu size={14} />} className={className} panelId={panelId} isZoomed={isZoomed} onToggleZoom={onToggleZoom}
      right={
        <div className="flex gap-1">
          <div className="mr-1 flex gap-0.5 rounded border border-slate-700/60 p-0.5 text-[10px]">
            <button type="button" onClick={() => setAgg("day")} className={`rounded px-1.5 py-0.5 ${agg === "day" ? "bg-violet-500/20 text-violet-300" : "text-slate-500"}`}>日</button>
            <button type="button" onClick={() => { setAgg("week"); if (range === "7d" || range === "14d") setRange("30d"); }} className={`rounded px-1.5 py-0.5 ${agg === "week" ? "bg-violet-500/20 text-violet-300" : "text-slate-500"}`}>周</button>
          </div>
          <div className="mr-1 flex gap-0.5 rounded border border-slate-700/60 p-0.5 text-[10px]">
            <button type="button" onClick={() => setMode("vendor")} className={`rounded px-1.5 py-0.5 ${mode === "vendor" ? "bg-violet-500/20 text-violet-300" : "text-slate-500"}`}>厂商</button>
            <button type="button" onClick={() => setMode("country")} className={`rounded px-1.5 py-0.5 ${mode === "country" ? "bg-violet-500/20 text-violet-300" : "text-slate-500"}`}>中美</button>
          </div>
          {(["7d", "14d", "30d", "60d", "180d", "1y"] as const).map((r) => {
            const off = agg === "week" && (r === "7d" || r === "14d");
            return (
              <button key={r} type="button" disabled={off} onClick={() => setRange(r)} className={`rounded px-1.5 py-0.5 text-[10px] ${range === r ? "bg-violet-500/20 text-violet-300" : off ? "text-slate-700" : "text-slate-500"}`}>{r}</button>
            );
          })}
        </div>
      }
    >
      <div className="flex h-full flex-col p-2 pt-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[11px] text-slate-600">加载中…</div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-[11px] text-red-400">数据异常: {error}</div>
        ) : (
          <div className="min-h-0 flex-1">
            <Chart allDays={data || []} days={sliced} mode={mode} agg={agg} />
          </div>
        )}
        <div className="flex items-center justify-between pt-1 text-[9px] text-slate-600">
          <span>数据: OpenRouter Rankings API{!data?.length ? " · 需 OPENROUTER_API_KEY" : ""}</span>
          <span>日更新</span>
        </div>
      </div>
    </Panel>
  );
}
