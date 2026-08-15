import { useEffect, useMemo, useRef, useState } from "react";
import { QuoteLine } from "@/components/cockpit/QuoteLine";
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

function fmtPct(v?: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function BoardRow({
  b, maxAbs, active, onClick,
}: { b: SectorBoard; maxAbs: number; active: boolean; onClick: () => void }) {
  const w = maxAbs > 0 ? Math.min(100, (Math.abs(b.pct) / maxAbs) * 100) : 0;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[1fr_52px_72px] items-center gap-1.5 rounded px-1.5 py-1 text-left",
        active ? "bg-cyan-500/10 ring-1 ring-cyan-500/40" : "hover:bg-slate-800/40",
      )}
    >
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
type HotView = "em01" | "em02" | "ths-c" | "ths-i";

export function SectorHotPanel() {
  const [view, setView] = useState<HotView>("em01");
  const [dir, setDir] = useState<"0" | "1">("0");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<SectorBoard | null>(null);
  const [thsPick, setThsPick] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [idx, setIdx] = useState(0);
  const kind = view === "em02" ? "02" : "01";
  const ths = view.startsWith("ths");

  const { data, error } = usePolling(
    () => api.sectorBoards(kind, dir, kind === "01" ? 80 : 120),
    POLL_MS,
    [kind, dir],
    !ths,
  );

  const filtered = useMemo(
    () => (data ?? []).filter((b) => !q || b.name.includes(q)),
    [data, q],
  );

  const filterKey = `${view}|${dir}|${q}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setIdx(0);
  }

  useEffect(() => {
    if (!auto || ths || !filtered.length) return;
    const t = window.setInterval(() => setIdx((i) => i + 1), ROTATE_MS);
    return () => window.clearInterval(t);
  }, [auto, ths, filtered.length]);

  // Same as marketingdashboard: rotate or keep the clicked board; default first.
  const activeBoard = useMemo(() => {
    if (!filtered.length) return null;
    if (auto) return filtered[idx % filtered.length];
    if (selected) {
      const cur = filtered.find((b) => b.code === selected.code);
      if (cur) return cur;
    }
    return filtered[0];
  }, [auto, filtered, idx, selected]);

  const stockCode = activeBoard?.raw_code || activeBoard?.code || "";
  const { data: stocks } = usePolling(
    () => (stockCode ? api.boardStocks(stockCode, MAX_STOCK_ROWS) : Promise.resolve([])),
    POLL_MS,
    [stockCode],
    !ths && !!stockCode,
  );
  const stockCodes = (stocks ?? []).map((s) => s.code);
  const minutes = useMinutes(!ths ? stockCodes : []);

  const { data: thsData, error: thsErr } = usePolling(
    () => api.thsRotation(view === "ths-i" ? "industry" : "concept", 30),
    180_000,
    [view],
    ths,
  );
  const thsRows = useMemo(() => {
    const rows = [...(thsData?.rows ?? [])];
    if (dir === "1") rows.reverse();
    return rows.filter((r) => !q || r.name.includes(q));
  }, [thsData, dir, q]);
  const maxAbs = Math.max(...filtered.map((b) => Math.abs(b.pct)), 0.01);
  const thsMax = Math.max(...thsRows.map((r) => Math.abs(r.avg_pct)), 0.01);
  const thsSel = thsRows.find((r) => r.name === thsPick) ?? thsRows[0] ?? null;

  const switchView = (next: HotView) => {
    setView(next);
    setSelected(null);
    setThsPick(null);
    setAuto(!next.startsWith("ths"));
    setIdx(0);
  };

  const pickBoard = (b: SectorBoard) => {
    setAuto(false);
    setSelected(selected?.code === b.code && !auto ? null : b);
  };

  const showRight = ths ? Boolean(thsSel) : Boolean(activeBoard);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-700/40 px-1.5 py-1">
        <ChipGroup>
          <Chip active={view === "em01"} onClick={() => switchView("em01")}>行业</Chip>
          <Chip active={view === "em02"} onClick={() => switchView("em02")}>概念</Chip>
          <Chip active={view === "ths-c"} onClick={() => switchView("ths-c")}>THS概念</Chip>
          <Chip active={view === "ths-i"} onClick={() => switchView("ths-i")}>THS行业</Chip>
        </ChipGroup>
        <ChipGroup>
          <Chip active={dir === "0"} onClick={() => setDir("0")}>领涨</Chip>
          <Chip active={dir === "1"} onClick={() => setDir("1")}>领跌</Chip>
        </ChipGroup>
        {!ths && (
          <button
            type="button"
            onClick={() => setAuto((a) => !a)}
            title={auto ? `轮播中(${ROTATE_MS / 1000}s),点击暂停` : "已暂停,点击恢复轮播"}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px]",
              auto ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-slate-300",
            )}
          >
            轮播
          </button>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索"
          className="ml-auto h-6 w-20 rounded border border-slate-700/60 bg-slate-900/50 px-1.5 text-[10px] text-slate-300 outline-none focus:border-cyan-500/50"
        />
      </div>
      <div className={cn("min-h-0 flex-1", showRight ? "flex" : "")}>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-1">
          {ths ? (
            <>
              {!thsData && (
                <p className="py-6 text-center text-[11px] text-slate-600">
                  {thsErr ? "shy313/截面未接通, 自动重试中" : "加载中…"}
                </p>
              )}
              {thsData && (
                <p className="px-1.5 pb-1 text-[9px] text-slate-600">
                  shy313 同花顺成份 × 东财涨跌 · {thsData.n ?? 0} 只截面
                </p>
              )}
              {thsRows.map((r) => (
                <BoardRow
                  key={r.name}
                  b={{
                    code: r.name,
                    name: r.name,
                    pct: r.avg_pct,
                    lead_name: `${r.count}只`,
                    lead_pct: r.avg_pct,
                    price: 0,
                    change: 0,
                  }}
                  maxAbs={thsMax}
                  active={thsSel?.name === r.name}
                  onClick={() => setThsPick(thsPick === r.name ? null : r.name)}
                />
              ))}
            </>
          ) : (
            <>
              {!data && (
                <p className="py-6 text-center text-[11px] text-slate-600">
                  {error ? "板块源未接通, 自动重试中" : "加载中…"}
                </p>
              )}
              {filtered.slice(0, 80).map((b) => (
                <BoardRow
                  key={b.code + b.name}
                  b={b}
                  maxAbs={maxAbs}
                  active={activeBoard?.code === b.code}
                  onClick={() => pickBoard(b)}
                />
              ))}
            </>
          )}
        </div>
        {ths && thsSel && (
          <div className="min-h-0 w-[min(440px,50%)] shrink-0 overflow-y-auto border-l border-slate-700/40 p-1">
            <div className="mb-1 flex items-baseline justify-between px-1.5 pt-1">
              <span className="truncate text-[12px] font-semibold text-cyan-300">{thsSel.name}</span>
              <span className={cn("font-mono text-[12px] font-semibold tabular-nums", pctColor(thsSel.avg_pct))}>
                {fmtPct(thsSel.avg_pct)}
              </span>
            </div>
            <p className="px-1.5 pb-1 text-[10px] text-slate-500">
              涨{thsSel.up}/跌{thsSel.down}
            </p>
            {(thsSel.leads ?? []).map((s) => (
              <QuoteLine
                key={s.code}
                name={s.name}
                price={null}
                pct={s.pct}
              />
            ))}
          </div>
        )}
        {!ths && activeBoard && (
          <div className="min-h-0 w-[min(440px,50%)] shrink-0 overflow-y-auto border-l border-slate-700/40 p-1">
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
