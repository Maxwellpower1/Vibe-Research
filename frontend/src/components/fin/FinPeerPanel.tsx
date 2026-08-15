import { useMemo } from "react";
import { useFin } from "@/components/fin/FinContext";
import { computePeerComparison, type PeerMetric } from "@/components/fin/peer-math";
import { fmtPct, fmtYiYuan, TNUM } from "@/components/fin/utils";
import { useElementSize } from "@/hooks/useElementSize";
import { pctColor } from "@/components/review/format";

function CmpBar({ val, avg }: { val: number; avg: number }) {
  const max = Math.max(val, avg, 1);
  const vw = Math.max((val / max) * 100, 2);
  const aw = Math.max((avg / max) * 100, 2);
  const vCls = val >= avg ? "bg-rose-400/70" : "bg-emerald-400/70";
  return (
    <div className="flex h-[3px] w-full gap-[1px]">
      <div className={vCls} style={{ width: `${vw}%`, transition: "width 0.3s" }} />
      <div className="h-full flex-1 rounded-r bg-slate-600/40" style={{ width: `${aw}%` }}>
        <div className="h-full w-full rounded-r bg-amber-400/20" />
      </div>
    </div>
  );
}

function formatMetric(m: PeerMetric, count: number) {
  const rankStr = m.rank != null ? `${m.rank}/${count}` : "—";
  switch (m.key) {
    case "np":
      return { companyStr: fmtYiYuan(m.companyVal), peerStr: m.peerAvg == null ? "—" : fmtYiYuan(m.peerAvg), rankStr };
    case "py":
    case "ry":
      return { companyStr: fmtPct(m.companyVal, 1), peerStr: m.peerAvg == null ? "—" : fmtPct(m.peerAvg, 1), rankStr, colorCls: pctColor(m.companyVal) };
    case "roe":
      return { companyStr: `${m.companyVal.toFixed(1)}%`, peerStr: m.peerAvg == null ? "—" : `${m.peerAvg.toFixed(1)}%`, rankStr };
    case "eps":
      return { companyStr: m.companyVal.toFixed(2), peerStr: m.peerAvg == null ? "—" : m.peerAvg.toFixed(2), rankStr };
  }
}

export function FinPeerPanel() {
  const { company, board, prevBoard, companyBundle, companyError, peerMode } = useFin();
  const finData = companyBundle?.main;
  const peerData = useMemo(
    () => computePeerComparison(board, prevBoard, finData, company.code, company.name),
    [board, prevBoard, finData, company.code, company.name],
  );
  const radarData = useMemo(() => {
    if (!peerData?.radar.length) return null;
    return peerData.radar.map((axis, i) => {
      const f = formatMetric(peerData.metrics[i], peerData.count);
      return { label: axis.label, company: axis.company, peer: axis.peer, companyStr: f.companyStr, peerStr: f.peerStr };
    });
  }, [peerData]);
  const hasPeer = peerData && peerData.industry;

  if (!company.code) {
    return <div className="flex h-full items-center justify-center text-[11px] text-slate-600">从榜单选入公司</div>;
  }
  if (!board || !finData) {
    return <p className="py-8 text-center text-[11px] text-slate-600">{companyError ? "同业未接通" : "加载中…"}</p>;
  }
  if (!hasPeer || !peerData) {
    return <p className="py-8 text-center text-[11px] text-slate-600">未找到该公司行业信息</p>;
  }

  if (peerMode === "table") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-800/60 px-2 py-1">
          <span className="text-[11px] font-semibold text-violet-300">{peerData.industry}</span>
          <span className="text-[9px] text-slate-500">
            共 {peerData.count} 家
            {peerData.inBoard && !peerData.usePrev && peerData.count > 0 ? " · 排名第" : ""}
          </span>
          {!peerData.inBoard && (
            <span className="text-[8px] text-amber-400/70">(未入榜,仅对比均值)</span>
          )}
          {peerData.usePrev && (
            <span className="text-[8px] text-amber-400/70">(当期样本不足,引用上期全市场数据)</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-800/60 px-2 py-0.5 text-[9px] text-slate-500">
          <span className="w-[48px] shrink-0">指标</span>
          <span className="min-w-0 flex-1 text-right">{finData.name.length > 6 ? finData.name.slice(0, 6) : finData.name}</span>
          <span className="w-[52px] shrink-0 text-right">行业均值</span>
          <span className="w-[36px] shrink-0 text-right">排名</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
          {peerData.metrics.map((m, i) => {
            const f = formatMetric(m, peerData.count);
            return (
              <div key={m.label} className="flex flex-col border-b border-slate-800/60 px-2 py-1 hover:bg-slate-800/40">
                <div className="flex items-center gap-2">
                  <span className="w-[48px] shrink-0 text-[10px] text-slate-400">{m.label}</span>
                  <span className={`min-w-0 flex-1 text-right text-[11px] font-semibold ${f.colorCls ?? "text-slate-200"}`} style={TNUM}>
                    {f.companyStr}
                  </span>
                  <span className="w-[52px] shrink-0 text-right text-[10px] text-slate-500" style={TNUM}>
                    {f.peerStr}
                  </span>
                  <span className="w-[36px] shrink-0 text-right text-[9px] text-slate-400" style={TNUM}>
                    {f.rankStr}
                  </span>
                </div>
                {i < peerData.metrics.length - 1 && (
                  <div className="mt-0.5">
                    <CmpBar val={Math.abs(m.barVal)} avg={Math.abs(m.barAvg)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return radarData
    ? <RadarChart axes={radarData} companyName={finData.name} />
    : <p className="py-8 text-center text-[11px] text-slate-600">需要至少 3 项指标</p>;
}

function RadarChart({
  axes,
  companyName,
}: {
  axes: { label: string; company: number; peer: number; companyStr: string; peerStr: string }[];
  companyName: string;
}) {
  const n = axes.length;
  const { ref: boxRef, size } = useElementSize();
  if (n < 3) return <div className="flex h-full items-center justify-center text-[11px] text-slate-600">需要至少 3 项指标</div>;

  const { w: W, h: H } = size;
  const padding = 28;
  const legendH = 20;
  const plotH = H - legendH;
  const CX = W / 2;
  const CY = (plotH - padding) / 2 + padding * 0.6;
  const R = Math.min(CX - padding, CY - padding, (plotH - padding * 2) / 2) * 0.85;
  const levels = 5;
  const fontSize = Math.max(9, Math.min(12, R / 8));
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, r: number) => ({
    x: CX + r * Math.cos(angle(i)),
    y: CY + r * Math.sin(angle(i)),
  });
  const grids = Array.from({ length: levels }, (_, li) => {
    const r = ((li + 1) / levels) * R;
    return axes.map((_, i) => pt(i, r));
  });
  const companyPts = axes.map((a, i) => pt(i, a.company * R));
  const peerPts = axes.map((a, i) => pt(i, a.peer * R));
  const labelR = R + Math.max(32, fontSize * 2.6);

  return (
    <div ref={boxRef} className="flex h-full min-h-0 flex-col items-center justify-center">
      <svg width={W} height={plotH} className="block">
        {grids.map((ring, li) => (
          <polygon
            key={li}
            points={ring.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
            fill="none"
            stroke="#1e293b"
            strokeWidth={1}
          />
        ))}
        {axes.map((_, i) => {
          const outer = pt(i, R);
          return <line key={i} x1={CX} y1={CY} x2={outer.x} y2={outer.y} stroke="#1e293b" strokeWidth={1} />;
        })}
        <polygon
          points={peerPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          fill="#fbbf24"
          fillOpacity={0.08}
          stroke="#fbbf24"
          strokeWidth={1}
          strokeDasharray="3 2"
        />
        <polygon
          points={companyPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          fill="#a78bfa"
          fillOpacity={0.15}
          stroke="#a78bfa"
          strokeWidth={1.5}
        />
        {axes.map((a, i) => {
          const outer = pt(i, labelR);
          const nameY = outer.y + fontSize * 0.35;
          return (
            <g key={i}>
              <text x={outer.x} y={nameY} fontSize={fontSize} fill="#94a3b8" textAnchor="middle" style={TNUM}>
                {a.label}
              </text>
              <text x={outer.x} y={nameY + fontSize * 1.05} fontSize={fontSize * 0.88} fill="#a78bfa" textAnchor="middle" style={TNUM}>
                {a.companyStr}
              </text>
              {a.peerStr !== "—" && (
                <text x={outer.x} y={nameY + fontSize * 2.1} fontSize={fontSize * 0.88} fill="#fbbf24" textAnchor="middle" style={TNUM}>
                  {a.peerStr}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex shrink-0 items-center gap-4 text-[10px]" style={{ height: legendH }}>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-violet-400/40" />
          <span className="text-slate-400">{companyName.length > 6 ? companyName.slice(0, 6) : companyName}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm border border-amber-400/50 bg-amber-400/10" />
          <span className="text-slate-500">行业均值</span>
        </span>
      </div>
    </div>
  );
}
