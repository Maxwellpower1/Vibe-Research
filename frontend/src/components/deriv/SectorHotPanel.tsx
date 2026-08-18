import { useMemo, useState } from "react";
import type { DerivData } from "@/hooks/useDerivData";
import type { OvlabMarketRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { num } from "@/components/ovlab/shared";
import { pctColor } from "@/components/review/format";
import { commodityRowsOf } from "./CommodityCell";
import { CellEmpty, CtnText, klineSym, NightMoon } from "./derivShared";

interface SectorAgg {
  sector: string;
  count: number;
  avgCtn: number;
  /** ctn 最高 / 最低的成员, 对应 A股板块行的领涨股/领跌股 */
  lead: OvlabMarketRow | null;
  lag: OvlabMarketRow | null;
}

type Side = "up" | "down";

function fmtPct(frac: number | null): string {
  if (frac == null || !Number.isFinite(frac)) return "—";
  const pct = frac * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function SectorRow({ s, side, maxAbs, active, onClick }: {
  s: SectorAgg;
  side: Side;
  maxAbs: number;
  active: boolean;
  onClick: () => void;
}) {
  const w = maxAbs > 0 ? Math.min(100, (Math.abs(s.avgCtn) / maxAbs) * 100) : 0;
  const member = side === "up" ? s.lead : s.lag;
  const memberCtn = num(member?.ctn);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[1fr_56px_64px] items-center gap-1.5 rounded px-1.5 py-1 text-left",
        active ? "bg-cyan-500/10 ring-1 ring-cyan-500/40" : "hover:bg-slate-800/40",
      )}
    >
      <span className="min-w-0">
        <span className="flex items-baseline gap-1">
          <span className="truncate text-[12px] text-slate-200">{s.sector}</span>
          <span className="shrink-0 text-[9px] tabular-nums text-slate-600">{s.count}</span>
        </span>
        <span className="mt-0.5 block h-1 rounded-full bg-slate-800">
          <span
            className={cn("block h-1 rounded-full", s.avgCtn >= 0 ? "bg-red-400/80" : "bg-emerald-400/70")}
            style={{ width: `${w}%` }}
          />
        </span>
      </span>
      <span className={cn("text-right font-mono text-[12px] font-semibold tabular-nums", pctColor(s.avgCtn * 100))}>
        {fmtPct(s.avgCtn)}
      </span>
      <span className="truncate text-right text-[10px] text-slate-500" title={member ? String(member.product_alias ?? member.product) : undefined}>
        {member ? String(member.product_alias ?? member.product) : "—"}
        {memberCtn != null && (
          <span className={cn("ml-0.5 tabular-nums", pctColor(memberCtn * 100))}>
            {memberCtn > 0 ? "+" : ""}{(memberCtn * 100).toFixed(1)}%
          </span>
        )}
      </span>
    </button>
  );
}

function SectorList({ title, tone, sectors, maxAbs, picked, onPick }: {
  title: string;
  tone: Side;
  sectors: SectorAgg[];
  maxAbs: number;
  picked: string | null;
  onPick: (sector: string) => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 px-1 pt-0.5">
        <div className="mb-0.5 flex items-center justify-between px-1.5 pt-0.5">
          <span className={cn("text-[11px] font-semibold", tone === "up" ? "text-red-400" : "text-emerald-400")}>
            {title}
          </span>
          <span className="text-[10px] text-slate-600">{sectors.length || ""}</span>
        </div>
        <div className="grid grid-cols-[1fr_56px_64px] items-center gap-1.5 px-1.5 py-1 text-[10px] text-slate-500">
          <span>板块 / 强度</span>
          <span className="text-right">均涨幅</span>
          <span className="text-right">{tone === "up" ? "领涨品种" : "领跌品种"}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {sectors.length === 0 && <p className="py-4 text-center text-[11px] text-slate-600">—</p>}
        {sectors.map((s) => (
          <SectorRow
            key={s.sector}
            s={s}
            side={tone}
            maxAbs={maxAbs}
            active={picked === s.sector}
            onClick={() => onPick(s.sector)}
          />
        ))}
      </div>
    </div>
  );
}

function MemberPane({ sector, avgCtn, members, onClose, onPickSymbol }: {
  sector: string;
  avgCtn: number;
  members: OvlabMarketRow[];
  onClose: () => void;
  onPickSymbol?: (sym: string) => void;
}) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-1">
      <div className="mb-1 flex items-baseline justify-between gap-2 px-1.5 pt-1">
        <span className="truncate text-[12px] font-semibold text-cyan-300">{sector}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn("font-mono text-[12px] font-semibold tabular-nums", pctColor(avgCtn * 100))}>
            {fmtPct(avgCtn)}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800/60 hover:text-slate-200"
          >
            关闭
          </button>
        </div>
      </div>
      {[...members].sort((a, b) => (num(b.ctn) ?? 0) - (num(a.ctn) ?? 0)).map((r) => {
        const sym = klineSym(r);
        return (
          <button
            key={`${r.product}-${r.exp ?? ""}`}
            type="button"
            onClick={sym && onPickSymbol ? () => onPickSymbol(sym) : undefined}
            className="flex w-full items-center gap-2 rounded px-1.5 py-[2.5px] text-left hover:bg-slate-800/40"
          >
            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{String(r.product_alias ?? r.product)}</span>
            <NightMoon show={Number(r.has_night_trading) === 1} />
            <CtnText value={r.ctn} boldOver={3} />
          </button>
        );
      })}
    </div>
  );
}

/** 商品板块: 同帧按板块聚合, 领涨/领跌双栏 (对齐 A股 SectorHotPanel), 点击板块该半栏展开成员. */
export function SectorHotPanel({ d, onPickSymbol }: {
  d: DerivData;
  onPickSymbol?: (sym: string) => void;
}) {
  const [picked, setPicked] = useState<{ side: Side; sector: string } | null>(null);

          const commodityRows = useMemo(() => commodityRowsOf(d.rows), [d.rows]);

  const sectors = useMemo<SectorAgg[]>(() => {
    const m = new Map<string, { sum: number; count: number; lead: OvlabMarketRow | null; lag: OvlabMarketRow | null }>();
    for (const r of commodityRows) {
      const s = String(r.sector_alias);
      const ctn = num(r.ctn);
      const cur = m.get(s) ?? { sum: 0, count: 0, lead: null, lag: null };
      cur.count += 1;
      if (ctn !== null) {
        cur.sum += ctn;
        if (num(cur.lead?.ctn) === null || ctn > (num(cur.lead?.ctn) ?? -Infinity)) cur.lead = r;
        if (num(cur.lag?.ctn) === null || ctn < (num(cur.lag?.ctn) ?? Infinity)) cur.lag = r;
      }
      m.set(s, cur);
    }
    return [...m.entries()].map(([sector, v]) => ({
      sector,
      count: v.count,
      avgCtn: v.count ? v.sum / v.count : 0,
      lead: v.lead,
      lag: v.lag,
    }));
  }, [commodityRows]);

  const leaders = useMemo(
    () => sectors.filter((s) => s.avgCtn > 0).sort((a, b) => b.avgCtn - a.avgCtn),
    [sectors],
  );
  const laggards = useMemo(
    () => sectors.filter((s) => s.avgCtn < 0).sort((a, b) => a.avgCtn - b.avgCtn),
    [sectors],
  );
  const upMax = Math.max(...leaders.map((s) => Math.abs(s.avgCtn)), 0.0001);
  const downMax = Math.max(...laggards.map((s) => Math.abs(s.avgCtn)), 0.0001);

  const activeAgg = useMemo(() => {
    if (!picked) return null;
    const list = picked.side === "up" ? leaders : laggards;
    return list.find((s) => s.sector === picked.sector) ?? null;
  }, [picked, leaders, laggards]);

  const members = useMemo(
    () => (activeAgg ? commodityRows.filter((r) => String(r.sector_alias) === activeAgg.sector) : []),
    [activeAgg, commodityRows],
  );

  if (!d.rows) return <CellEmpty text={d.marketError ? "未取到" : "更新中…"} />;
  if (sectors.length === 0) return <CellEmpty />;

  const pick = (side: Side, sector: string) => {
    setPicked((p) => (p && p.side === side && p.sector === sector ? null : { side, sector }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {activeAgg && picked?.side === "up" ? (
          <MemberPane
            sector={activeAgg.sector}
            avgCtn={activeAgg.avgCtn}
            members={members}
            onClose={() => setPicked(null)}
            onPickSymbol={onPickSymbol}
          />
        ) : (
          <SectorList
            title="领涨"
            tone="up"
            sectors={leaders}
            maxAbs={upMax}
            picked={picked?.side === "up" ? picked.sector : null}
            onPick={(s) => pick("up", s)}
          />
        )}
        <div className="hidden w-px shrink-0 bg-slate-700/40 sm:block" />
        <div className="h-px shrink-0 bg-slate-700/40 sm:hidden" />
        {activeAgg && picked?.side === "down" ? (
          <MemberPane
            sector={activeAgg.sector}
            avgCtn={activeAgg.avgCtn}
            members={members}
            onClose={() => setPicked(null)}
            onPickSymbol={onPickSymbol}
          />
        ) : (
          <SectorList
            title="领跌"
            tone="down"
            sectors={laggards}
            maxAbs={downMax}
            picked={picked?.side === "down" ? picked.sector : null}
            onPick={(s) => pick("down", s)}
          />
        )}
      </div>
    </div>
  );
}
