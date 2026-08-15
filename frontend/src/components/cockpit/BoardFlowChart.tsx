import { useMemo, useState } from "react";
import { useElementSize } from "@/hooks/useElementSize";
import type { BoardFlowIntraday } from "@/lib/api";

const REDS = ["#fb7185", "#f43f5e", "#fca5a5", "#fb923c", "#fdba74", "#e11d48", "#fecdd3", "#fda4af"];
const GREENS = ["#34d399", "#10b981", "#6ee7b7", "#059669", "#a7f3d0", "#4ade80", "#22c55e", "#86efac"];
const GRID = "#1e293b";
const ZERO = "#475569";
const AXIS = "#64748b";
const CROSSHAIR = "#94a3b8";
const FLAT = "#94a3b8";
const TNUM = { fontVariantNumeric: "tabular-nums" as const };
const X_TICKS: [number, string, "start" | "middle" | "end"][] = [
  [0, "09:30", "middle"],
  [59, "10:30", "middle"],
  [119, "11:30", "end"],
  [120, "13:00", "start"],
  [179, "14:00", "middle"],
  [239, "15:00", "end"],
];
const END_LABEL_W = 86;
const PLOT_LEFT = 34;
const PLOT_INSET = 6;

/** Minute cumulative main-net butterfly (Eastmoney). Click a line to filter moneyflow. */
export function BoardFlowChart({
  flows,
  progress = 1,
  selected,
  onSelect,
}: {
  flows: BoardFlowIntraday[];
  progress?: number;
  selected?: string | null;
  onSelect?: (sel: { code: string; name: string } | null) => void;
}) {
  const { ref: boxRef, size } = useElementSize();
  const [internalSel, setInternalSel] = useState<string | null>(null);
  const sel = selected !== undefined ? selected : internalSel;
  const toggle = (code: string, name: string) => {
    const next = sel === code ? null : code;
    if (selected !== undefined) onSelect?.(next === null ? null : { code, name });
    else setInternalSel(next);
  };

  const chart = useMemo(() => {
    const series = flows.filter((f) => f.points.length > 2);
    if (!series.length || size.w < 40 || size.h < 40) return null;
    const W = size.w;
    const chartH = Math.max(size.h, 80);
    const n = Math.max(...series.map((s) => s.points.length));
    const idx = Math.max(1, Math.min(n - 1, Math.floor(progress * (n - 1))));
    const visibleV = series.flatMap((s) => (progress < 1 ? s.points.slice(0, idx + 1) : s.points)).map((p) => p.v);
    let min = Math.min(...visibleV, 0);
    let max = Math.max(...visibleV, 0);
    const pad = (max - min) * 0.04 || 1;
    min -= pad;
    max += pad;
    const X = (i: number) => PLOT_LEFT + (i / Math.max(n - 1, 1)) * (W - 40 - END_LABEL_W);
    const Y = (v: number) => 8 + (1 - (v - min) / (max - min)) * (chartH - 26);
    let ri = 0;
    let gi = 0;
    const lines = series.map((s) => {
      const color = s.net_in >= 0 ? REDS[ri++ % REDS.length] : GREENS[gi++ % GREENS.length];
      const seg = s.points.slice(0, idx + 1);
      const pts = seg.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
      const last = seg[seg.length - 1];
      return { s, color, pts, lastY: Y(last.v), lastV: last.v };
    });
    const ticks = [0.2, 0.4, 0.6, 0.8].map((f) => {
      const v = max - f * (max - min);
      return { v, y: Y(v) };
    });
    const labels = [...lines].sort((a, b) => a.lastY - b.lastY).map((l) => ({ line: l, labelY: l.lastY }));
    const TOP = 10;
    const BOTTOM = chartH - 18;
    const gap = labels.length > 1 ? Math.min(11, (BOTTOM - TOP) / (labels.length - 1)) : 11;
    let sy = Math.max(labels[0]?.labelY ?? TOP, TOP);
    sy = Math.min(sy, BOTTOM - gap * (labels.length - 1));
    sy = Math.max(sy, TOP);
    for (const l of labels) {
      l.labelY = sy;
      sy += gap;
    }
    return {
      W, chartH, X, Y, lines, labels, ticks, idx,
      cursorT: series.find((s) => s.points.length > idx)?.points[idx]?.t ?? "",
    };
  }, [flows, size, progress]);

  return (
    <div ref={boxRef} className="flex h-full min-h-0 w-full flex-col">
      {chart ? (
        <svg width="100%" className="block min-h-0 w-full flex-1" viewBox={`0 0 ${chart.W} ${chart.chartH}`} preserveAspectRatio="none">
          {chart.ticks.map((t, i) => (
            <g key={i}>
              <line x1={PLOT_LEFT} y1={t.y} x2={chart.W - END_LABEL_W - PLOT_INSET} y2={t.y} stroke={GRID} strokeWidth={1} />
              <text x={4} y={t.y + 3} fontSize={9} fill={CROSSHAIR} style={TNUM}>{(t.v / 1e8).toFixed(0)}亿</text>
            </g>
          ))}
          <line x1={PLOT_LEFT} y1={chart.Y(0)} x2={chart.W - END_LABEL_W - PLOT_INSET} y2={chart.Y(0)} stroke={ZERO} strokeWidth={1} />
          {X_TICKS.map(([i, t, anchor]) => (
            <text key={t} x={chart.X(i)} y={chart.chartH - 8} fontSize={8} fill={AXIS} textAnchor={anchor}>{t}</text>
          ))}
          {chart.lines.map((l) => {
            const active = sel == null || sel === l.s.code;
            return (
              <g key={l.s.code}>
                <polyline points={l.pts} fill="none" stroke={l.color} strokeWidth={active ? 1.4 : 0.7} strokeOpacity={active ? 1 : 0.18} strokeLinejoin="round" />
                <polyline
                  points={l.pts}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  strokeLinejoin="round"
                  style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); toggle(l.s.code, l.s.name); }}
                />
              </g>
            );
          })}
          {chart.labels.map((l) => {
            const active = sel == null || sel === l.line.s.code;
            return (
              <g key={l.line.s.code} opacity={active ? 1 : 0.2} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); toggle(l.line.s.code, l.line.s.name); }}>
                <line x1={chart.W - END_LABEL_W - PLOT_INSET} y1={l.line.lastY} x2={chart.W - END_LABEL_W} y2={l.labelY} stroke={l.line.color} strokeWidth={0.6} strokeOpacity={0.5} />
                <text x={chart.W - END_LABEL_W + 2} y={l.labelY + 3} fontSize={8.5} fill={l.line.color} style={TNUM}>
                  {l.line.s.name} {l.line.lastV >= 0 ? "+" : ""}{(l.line.lastV / 1e8).toFixed(0)}
                </text>
              </g>
            );
          })}
          {progress < 1 && (
            <g>
              <line x1={chart.X(chart.idx)} y1={8} x2={chart.X(chart.idx)} y2={chart.chartH - 18} stroke={FLAT} strokeWidth={1} strokeDasharray="3 3" />
              <text x={chart.X(chart.idx)} y={8} fontSize={8} fill="#e2e8f0" textAnchor="middle" style={TNUM}>{chart.cursorT}</text>
            </g>
          )}
        </svg>
      ) : flows.length ? (
        <BoardFlowRankFallback flows={flows} selected={sel} onToggle={toggle} />
      ) : (
        <div className="flex h-full items-center justify-center text-[11px] text-slate-600">板块资金流加载中…</div>
      )}
    </div>
  );
}

function BoardFlowRankFallback({
  flows,
  selected,
  onToggle,
}: {
  flows: BoardFlowIntraday[];
  selected: string | null;
  onToggle: (code: string, name: string) => void;
}) {
  const maxAbs = Math.max(...flows.map((f) => Math.abs(f.net_in || 0)), 1);
  const rows = [...flows].sort((a, b) => (b.net_in || 0) - (a.net_in || 0));
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto px-2 py-1">
      <p className="mb-1 text-center text-[10px] text-slate-600">流入/流出榜已到, 分钟曲线补拉中</p>
      <div className="space-y-1">
        {rows.map((f) => {
          const pct = Math.min(100, (Math.abs(f.net_in || 0) / maxAbs) * 100);
          const up = (f.net_in || 0) >= 0;
          const active = selected == null || selected === f.code;
          return (
            <button
              key={f.code || f.name}
              type="button"
              onClick={() => onToggle(f.code, f.name)}
              className="flex w-full items-center gap-2 text-left"
              style={{ opacity: active ? 1 : 0.35 }}
            >
              <span className="w-16 shrink-0 truncate text-[10px] text-slate-300">{f.name}</span>
              <span className="relative h-1.5 min-w-0 flex-1 rounded bg-slate-800">
                <span
                  className="absolute inset-y-0 left-0 rounded"
                  style={{
                    width: `${pct}%`,
                    background: up ? "#fb7185" : "#34d399",
                  }}
                />
              </span>
              <span
                className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums"
                style={{ color: up ? "#fb7185" : "#34d399" }}
              >
                {up ? "+" : ""}{((f.net_in || 0) / 1e8).toFixed(1)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
