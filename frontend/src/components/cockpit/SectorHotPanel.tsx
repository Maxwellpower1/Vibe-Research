import { useMemo, useState } from "react";
import { QuoteLine, klineHref } from "@/components/cockpit/QuoteLine";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { pctColor } from "@/components/review/format";
import { usePolling } from "@/hooks/usePolling";
import { api, type SectorBoard } from "@/lib/api";
import { cn } from "@/lib/utils";

const POLL_MS = 20_000;

function BoardRow({
  b, maxAbs, active, onClick,
}: { b: SectorBoard; maxAbs: number; active: boolean; onClick: () => void }) {
  const w = maxAbs > 0 ? Math.min(100, (Math.abs(b.pct) / maxAbs) * 100) : 0;
  return (
    <button
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
        {b.pct > 0 ? "+" : ""}{b.pct.toFixed(2)}%
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

/** Industry / concept realtime hot boards + constituent sidebar. */
export function SectorHotPanel() {
  const [kind, setKind] = useState<"01" | "02">("01");
  const [dir, setDir] = useState<"0" | "1">("0");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<SectorBoard | null>(null);

  const { data, error } = usePolling(
    () => api.sectorBoards(kind, dir, kind === "01" ? 80 : 120),
    POLL_MS,
    [kind, dir],
  );
  const { data: stocks } = usePolling(
    () => (selected ? api.boardStocks(selected.code, 20) : Promise.resolve([])),
    POLL_MS,
    [selected?.code],
  );

  const filtered = useMemo(
    () => (data ?? []).filter((b) => !q || b.name.includes(q)),
    [data, q],
  );
  const maxAbs = Math.max(...filtered.map((b) => Math.abs(b.pct)), 0.01);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-700/40 px-1.5 py-1">
        <ChipGroup>
          <Chip active={kind === "01"} onClick={() => { setKind("01"); setSelected(null); }}>行业</Chip>
          <Chip active={kind === "02"} onClick={() => { setKind("02"); setSelected(null); }}>概念</Chip>
        </ChipGroup>
        <ChipGroup>
          <Chip active={dir === "0"} onClick={() => setDir("0")}>领涨</Chip>
          <Chip active={dir === "1"} onClick={() => setDir("1")}>领跌</Chip>
        </ChipGroup>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索"
          className="ml-auto h-6 w-20 rounded border border-slate-700/60 bg-slate-900/50 px-1.5 text-[10px] text-slate-300 outline-none focus:border-cyan-500/50"
        />
      </div>
      <div className={cn("min-h-0 flex-1", selected ? "grid grid-cols-2" : "")}>
        <div className="min-h-0 overflow-y-auto p-1">
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
              active={selected?.code === b.code}
              onClick={() => setSelected(selected?.code === b.code ? null : b)}
            />
          ))}
        </div>
        {selected && (
          <div className="min-h-0 overflow-y-auto border-l border-slate-700/40 p-1">
            <p className="px-1.5 py-1 text-[10px] text-slate-500">{selected.name} 成分</p>
            {(stocks ?? []).map((s) => (
              <QuoteLine
                key={s.code}
                name={s.name}
                price={s.price}
                pct={s.pct}
                amount={s.amount}
                href={klineHref(s.code)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
