import { useMemo, useState } from "react";
import { useFin } from "@/components/fin/FinContext";
import { fmtYiYuan, TNUM } from "@/components/fin/utils";
import { useElementSize } from "@/hooks/useElementSize";
import { pctColor } from "@/components/review/format";

const NAME_W = 64;
const LABEL_W = 92;
const AXIS_H = 16;
const UP = "#fb7185";
const DOWN = "#34d399";

interface TMItem { name: string; v: number; yoy: number }
interface TMRect extends TMItem { x: number; y: number; w: number; h: number }

function layoutTreemap(items: TMItem[], X: number, Y: number, W: number, H: number): TMRect[] {
  const total = items.reduce((s, d) => s + d.v, 0);
  if (total <= 0 || W <= 0 || H <= 0) return [];
  const scale = (W * H) / total;
  const out: TMRect[] = [];
  let x = X;
  let y = Y;
  let w = W;
  let h = H;
  let row: TMItem[] = [];
  let i = 0;
  const worst = (r: TMItem[], side: number) => {
    const s = r.reduce((a, d) => a + d.v * scale, 0);
    let mx = 0;
    for (const d of r) {
      const a = d.v * scale;
      mx = Math.max(mx, Math.max((side * side * a) / (s * s), (s * s) / (side * side * a)));
    }
    return mx;
  };
  const layoutRow = (r: TMItem[]) => {
    const s = r.reduce((a, d) => a + d.v * scale, 0);
    if (w >= h) {
      const rw = s / h;
      let cy = y;
      for (const d of r) {
        const dh = (d.v * scale) / rw;
        out.push({ ...d, x, y: cy, w: rw, h: dh });
        cy += dh;
      }
      x += rw;
      w -= rw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const d of r) {
        const dw = (d.v * scale) / rh;
        out.push({ ...d, x: cx, y, w: dw, h: rh });
        cx += dw;
      }
      y += rh;
      h -= rh;
    }
  };
  while (i < items.length) {
    const side = Math.min(w, h);
    const next = items[i];
    if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) {
      row.push(next);
      i += 1;
    } else {
      layoutRow(row);
      row = [];
    }
  }
  if (row.length) layoutRow(row);
  return out;
}

export function FinIndustryPanel() {
  const { board: data, boardError: error, industryMode: mode } = useFin();
  const [hover, setHover] = useState(-1);
  const { ref: boxRef, size } = useElementSize();
  const list = useMemo(() => (data?.industries ?? []).filter((d) => d.net_profit > 0).slice(0, 15), [data]);

  const tree = useMemo(() => {
    if (!list.length || mode !== "tree" || size.w < 20 || size.h < 20) return null;
    const items = list.map((d) => ({ name: d.name, v: d.net_profit, yoy: d.yoy }));
    return { W: size.w, H: size.h, rects: layoutTreemap(items, 1, 1, size.w - 2, size.h - 2) };
  }, [list, mode, size]);

  const chart = useMemo(() => {
    if (!list.length || mode !== "bar" || size.w < 20 || size.h < 20) return null;
    const rowH = Math.min(16, (size.h - AXIS_H) / list.length);
    const barW = size.w - NAME_W - LABEL_W - 12;
    const maxLog = Math.log10(Math.max(...list.map((d) => d.net_profit), 1));
    const X = (v: number) => NAME_W + (Math.log10(Math.max(v, 1)) / maxLog) * barW;
    const maxV = Math.max(...list.map((d) => d.net_profit));
    const step = Math.max(Math.ceil(maxV / 3 / 1e10) * 1e10, 1e10);
    const ticks = [step, step * 2, step * 3].filter((v) => v <= maxV * 1.05);
    return { list, W: size.w, H: size.h, rowH, X, ticks };
  }, [list, mode, size]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={boxRef} className="min-h-0 flex-1">
        {!data && <p className="py-6 text-center text-[11px] text-slate-600">{error ? "行业榜未接通" : "加载中…"}</p>}
        {data && !list.length && <p className="py-8 text-center text-[11px] text-slate-600">当前非财报密集披露期</p>}
        {tree && (
          <svg width={tree.W} height={tree.H} className="block">
            {tree.rects.map((r, i) => {
              const color = r.yoy >= 0 ? UP : DOWN;
              const charW = 5.9;
              const trunc = (s: string, n: number) => (s.length <= n ? s : n >= 3 ? `${s.slice(0, n - 1)}…` : s.slice(0, n));
              const vertical = r.w < 26 && r.h >= 44 && r.w >= 12;
              const showName = vertical || (r.w >= 26 && r.h >= 15);
              const showVal = !vertical && r.w >= 56 && r.h >= 38;
              return (
                <g key={r.name} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}>
                  <rect
                    x={r.x}
                    y={r.y}
                    width={Math.max(r.w - 1, 0)}
                    height={Math.max(r.h - 1, 0)}
                    rx={2}
                    fill={color}
                    fillOpacity={0.12}
                    stroke={color}
                    strokeOpacity={0.4}
                  />
                  {hover === i && (
                    <rect x={r.x} y={r.y} width={Math.max(r.w - 1, 0)} height={Math.max(r.h - 1, 0)} rx={2} fill="#ffffff" opacity={0.08} />
                  )}
                  {showName && !vertical && (
                    <text x={r.x + 4} y={r.y + 12} fontSize={9.5} fill="#e2e8f0" fontWeight={600}>
                      {trunc(r.name, Math.max(1, Math.floor((r.w - 8) / charW)))}
                    </text>
                  )}
                  {vertical && (
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2}
                      transform={`rotate(90 ${r.x + r.w / 2} ${r.y + r.h / 2})`}
                      textAnchor="middle"
                      fontSize={8.5}
                      fill="#e2e8f0"
                      fontWeight={600}
                    >
                      {trunc(r.name, Math.max(1, Math.floor((r.h - 8) / charW)))}
                    </text>
                  )}
                  {showVal && (
                    <text x={r.x + 4} y={r.y + 23} fontSize={8.5} fill="#94a3b8" style={TNUM}>
                      {fmtYiYuan(r.v)}
                      <tspan fill={color} dx={3}>{r.yoy > 0 ? "+" : ""}{r.yoy.toFixed(1)}%</tspan>
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {chart && (
          <svg width={chart.W} height={chart.H} className="block">
            {chart.ticks.map((v) => (
              <g key={v}>
                <line x1={chart.X(v)} y1={4} x2={chart.X(v)} y2={chart.H - AXIS_H} stroke="#1e293b" strokeWidth={1} />
                <text x={chart.X(v)} y={chart.H - 5} fontSize={8} fill="#64748b" textAnchor="middle" style={TNUM}>
                  {(v / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}亿
                </text>
              </g>
            ))}
            {chart.list.map((d, i) => {
              const y = i * chart.rowH;
              const up = d.yoy >= 0;
              const color = up ? UP : DOWN;
              const bw = Math.max(chart.X(d.net_profit) - NAME_W, 2);
              const bh = Math.min(9, chart.rowH - 5);
              return (
                <g key={d.name}>
                  <text x={4} y={y + chart.rowH / 2 + 3} fontSize={9} fill="#e2e8f0">
                    {d.name.length > 6 ? d.name.slice(0, 6) : d.name}
                  </text>
                  <rect
                    x={NAME_W}
                    y={y + (chart.rowH - bh) / 2}
                    width={bw}
                    height={bh}
                    rx={1.5}
                    fill={color}
                    fillOpacity={0.25}
                    stroke={color}
                    strokeOpacity={0.6}
                    strokeDasharray={up ? undefined : "2 2"}
                    opacity={up ? 1 : 0.4}
                  />
                  <text x={NAME_W + bw + 4} y={y + chart.rowH / 2 + 3} fontSize={8.5} style={TNUM}>
                    <tspan fill="#cbd5e1">{fmtYiYuan(d.net_profit)} </tspan>
                    <tspan className={pctColor(d.yoy)} fill={color}>
                      {d.yoy > 0 ? "+" : ""}{d.yoy.toFixed(1)}%
                    </tspan>
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
