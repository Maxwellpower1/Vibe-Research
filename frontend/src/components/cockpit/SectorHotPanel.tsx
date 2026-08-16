import { useEffect, useMemo, useRef, useState } from "react";
import { QuoteStockRow } from "@/components/cockpit/QuoteStockRow";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { pctColor } from "@/components/review/format";
import { usePolling } from "@/hooks/usePolling";
import { api, type SectorBoard } from "@/lib/api";
import { sparkFromKline } from "@/lib/lightKline";
import { useMinutes } from "@/lib/minuteHub";
import { cn } from "@/lib/utils";

const POLL_MS = 20_000;
const MAX_STOCK_ROWS = 40;
const ROTATE_MS = 10_000;

export type SectorKind = "01" | "02";
export type SectorDir = "0" | "1";

export function SectorHotBar({
  kind,
  dir,
  q,
  auto,
  onKind,
  onDir,
  onQuery,
  onAuto,
}: {
  kind: SectorKind;
  dir: SectorDir;
  q: string;
  auto: boolean;
  onKind: (k: SectorKind) => void;
  onDir: (d: SectorDir) => void;
  onQuery: (q: string) => void;
  onAuto: (a: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-[11px]">
      <input
        value={q}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="搜索板块"
        className="h-6 w-20 rounded border border-slate-700/50 bg-slate-800/40 px-1.5 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500/50"
      />
      <button
        type="button"
        onClick={() => onAuto(!auto)}
        title={auto ? `轮播中(${ROTATE_MS / 1000}s),点击暂停` : "已暂停,点击恢复轮播"}
        className={cn(
          "rounded px-2 py-0.5 text-[10px]",
          auto ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200",
        )}
      >
        轮播
      </button>
      <ChipGroup className="border-0 bg-transparent p-0">
        <Chip active={kind === "01"} onClick={() => onKind("01")}>行业</Chip>
        <Chip active={kind === "02"} onClick={() => onKind("02")}>概念</Chip>
      </ChipGroup>
      <span className="mx-0.5 h-3 w-px bg-slate-700" />
      <ChipGroup className="border-0 bg-transparent p-0">
        <Chip active={dir === "0"} onClick={() => onDir("0")}>领涨</Chip>
        <Chip active={dir === "1"} onClick={() => onDir("1")}>领跌</Chip>
      </ChipGroup>
    </div>
  );
}

function fmtPct(v?: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function boardId(b: { code?: string; raw_code?: string; name?: string } | null): string {
  if (!b) return "";
  return (b.raw_code || b.code || b.name || "").trim();
}

function BoardRow({
  b, maxAbs, active, scroll, onClick,
}: { b: SectorBoard; maxAbs: number; active: boolean; scroll?: boolean; onClick: () => void }) {
  const w = maxAbs > 0 ? Math.min(100, (Math.abs(b.pct) / maxAbs) * 100) : 0;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active && scroll) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active, scroll]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[24px_1fr_52px_72px] items-center gap-1.5 rounded px-1.5 py-1 text-left",
        active ? "bg-cyan-500/10 ring-1 ring-cyan-500/40" : "hover:bg-slate-800/40",
      )}
    >
      <span className="text-[10px] tabular-nums text-slate-600">
        {(b.code || "").slice(-4) || "—"}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] text-slate-200">{b.name}</span>
        <span className="mt-0.5 block h-1 rounded-full bg-slate-800">
          <span
            className={cn("block h-1 rounded-full", b.pct >= 0 ? "bg-red-400/80" : "bg-emerald-400/70")}
            style={{ width: `${w}%` }}
          />
        </span>
      </span>
      <span className={cn("text-right font-mono text-[12px] font-semibold tabular-nums", pctColor(b.pct))}>
        {fmtPct(b.pct)}
      </span>
      <span className="truncate text-right text-[10px] text-slate-500">
        {b.lead_name || "—"}
        {b.lead_pct ? (
          <span className={cn("ml-0.5", pctColor(b.lead_pct))}>
            {b.lead_pct > 0 ? "+" : ""}{b.lead_pct.toFixed(1)}%
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** Industry / concept realtime hot boards + constituent sidebar (default first board). */
export function SectorHotPanel({
  kind,
  dir,
  q,
  auto,
  onAuto,
}: {
  kind: SectorKind;
  dir: SectorDir;
  q: string;
  auto: boolean;
  onAuto: (a: boolean) => void;
}) {
  const [selected, setSelected] = useState<SectorBoard | null>(null);
  const [idx, setIdx] = useState(0);

  const { data, error } = usePolling(
    () => api.sectorBoards(kind, dir, kind === "01" ? 80 : 120),
    POLL_MS,
    [kind, dir],
  );

  const filtered = useMemo(
    () => (data ?? []).filter((b) => !q || b.name.includes(q)),
    [data, q],
  );

  const filterKey = `${kind}|${dir}|${q}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setIdx(0);
  }

  useEffect(() => {
    if (!auto || !filtered.length) return;
    const t = window.setInterval(() => setIdx((i) => i + 1), ROTATE_MS);
    return () => window.clearInterval(t);
  }, [auto, filtered.length]);

  const activeBoard = useMemo(() => {
    if (!filtered.length) return null;
    if (auto) return filtered[idx % filtered.length];
    if (selected) {
      const cur = filtered.find((b) => boardId(b) === boardId(selected));
      if (cur) return cur;
    }
    return filtered[0];
  }, [auto, filtered, idx, selected]);

  const stockCode = activeBoard?.raw_code || activeBoard?.code || "";
  const { data: stocks } = usePolling(
    () => (stockCode ? api.boardStocks(stockCode, MAX_STOCK_ROWS) : Promise.resolve([])),
    POLL_MS,
    [stockCode],
    !!stockCode,
  );
  const stockCodes = (stocks ?? []).map((s) => s.code);
  const minutes = useMinutes(stockCodes);
  const maxAbs = Math.max(...filtered.map((b) => Math.abs(b.pct)), 0.01);

  const pickBoard = (b: SectorBoard) => {
    onAuto(false);
    setSelected(boardId(selected) === boardId(b) && !auto ? null : b);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("min-h-0 flex-1", activeBoard ? "flex flex-col sm:flex-row" : "")}>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-1">
          <div className="grid grid-cols-[24px_1fr_52px_72px] items-center gap-1.5 px-1.5 py-1 text-[10px] text-slate-500">
            <span>代码</span>
            <span>板块 / 强度{data ? ` (${filtered.length})` : ""}</span>
            <span className="text-right">涨跌幅</span>
            <span className="text-right">领涨股</span>
          </div>
          {!data && (
            <p className="py-6 text-center text-[11px] text-slate-600">
              {error ? "板块源未接通, 自动重试中" : "加载中…"}
            </p>
          )}
          {filtered.slice(0, 80).map((b) => (
            <BoardRow
              key={boardId(b) || b.name}
              b={b}
              maxAbs={maxAbs}
              active={boardId(activeBoard) === boardId(b)}
              scroll={auto}
              onClick={() => pickBoard(b)}
            />
          ))}
        </div>
        {activeBoard && (
          <div className="min-h-0 w-full shrink-0 overflow-y-auto border-t border-slate-700/40 p-1 sm:w-[min(440px,50%)] sm:border-l sm:border-t-0">
            <div className="mb-1 flex items-baseline justify-between px-1.5 pt-1">
              <span className="truncate text-[12px] font-semibold text-cyan-300">{activeBoard.name}</span>
              <span className={cn("font-mono text-[12px] font-semibold tabular-nums", pctColor(activeBoard.pct))}>
                {fmtPct(activeBoard.pct)}
              </span>
            </div>
            <div className="mb-1 grid grid-cols-2 gap-1 px-1.5 text-[10px] text-slate-500">
              <span>5日 <span className={pctColor(activeBoard.pct5 ?? 0)}>{fmtPct(activeBoard.pct5)}</span></span>
              <span>20日 <span className={pctColor(activeBoard.pct20 ?? 0)}>{fmtPct(activeBoard.pct20)}</span></span>
            </div>
            {!stocks && (
              <p className="py-4 text-center text-[11px] text-slate-600">成分股加载中…</p>
            )}
            {(stocks ?? []).map((s) => {
              const sp = sparkFromKline(minutes[s.code] || minutes[s.symbol || ""]);
              return (
                <QuoteStockRow
                  key={s.code}
                  code={s.code}
                  symbol={s.symbol || s.code}
                  name={s.name}
                  price={s.price}
                  pct={s.pct}
                  amount={s.amount}
                  turnover={s.turnover}
                  link={false}
                  boards={false}
                  mainNet={s.main_net}
                  mainPct={s.main_pct}
                  spark={sp ?? { closes: [] }}
                />
              );
            })}
            {!!stocks?.length && (
              <p className="px-1.5 pt-1 text-right text-[9px] text-slate-600">
                领涨前 {stocks.length} 只成分股
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
