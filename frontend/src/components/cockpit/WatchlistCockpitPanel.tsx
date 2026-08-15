import { useEffect, useRef, useState } from "react";
import { QuoteStockRow } from "@/components/cockpit/QuoteStockRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { api } from "@/lib/api";
import { sparkFromKline } from "@/lib/lightKline";
import { useMinutes } from "@/lib/minuteHub";
import { useQuotes } from "@/lib/quoteHub";
import { addWatch, useWatchCodes } from "@/lib/watchlist";

const MAX_ROWS = 40;

/** Watchlist rows share QuoteStockRow + the 5s quote hub. Search adds by name/code. */
export function WatchlistCockpitPanel() {
  const codes = useWatchCodes();
  const visible = codes.slice(0, MAX_ROWS);
  const hub = useQuotes(visible);
  const minutes = useMinutes(visible);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ code: string; name: string }>>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const onType = (v: string) => {
    setQ(v);
    window.clearTimeout(timer.current);
    const t = v.trim();
    if (!t) {
      setHits([]);
      setOpen(false);
      return;
    }
    if (/^\d{6}$/.test(t) || /^(sh|sz|bj)\d{6}$/i.test(t)) {
      setHits([]);
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(() => {
      void api.finSuggest(t, 8).then((rows) => {
        setHits(rows);
        setOpen(rows.length > 0);
      }).catch(() => setHits([]));
    }, 280);
  };

  const pick = (code: string) => {
    addWatch(code);
    setQ("");
    setHits([]);
    setOpen(false);
  };

  const searchBox = (
    <div ref={boxRef} className="relative shrink-0 px-1.5 pt-1">
      <input
        value={q}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const t = q.trim();
          const digits = t.replace(/^(sh|sz|bj)/i, "");
          if (/^\d{6}$/.test(digits)) pick(digits);
          else if (hits[0]) pick(hits[0].code);
        }}
        placeholder="搜名称 / 代码 / 拼音, 回车加入"
        className="h-6 w-full rounded bg-slate-800/60 px-2 text-[11px] text-slate-200 placeholder:text-[9px] placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
      />
      {open && hits.length > 0 && (
        <div className="absolute left-1.5 right-1.5 top-8 z-20 overflow-hidden rounded border border-border bg-card shadow-lg">
          {hits.map((s) => (
            <button
              key={s.code}
              type="button"
              onClick={() => pick(s.code)}
              className="flex h-6 w-full items-center gap-2 px-2 text-left hover:bg-slate-800/50"
            >
              <span className="w-14 font-mono text-[10px] text-slate-500">{s.code}</span>
              <span className="truncate text-[11px] text-slate-200">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (!codes.length) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {searchBox}
        <EmptyState
          title="还没有自选股"
          description="上面搜名称或代码即可加入, 加完立刻出行情。"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {searchBox}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {visible.map((c) => {
          const hq = hub[c];
          const sp = sparkFromKline(minutes[c]);
          return (
            <QuoteStockRow
              key={c}
              code={c}
              name={hq?.name || c}
              price={hq?.price}
              pct={hq?.pct}
              amount={hq?.amount}
              turnover={hq?.turnover}
              spark={sp ?? { closes: [] }}
            />
          );
        })}
        {codes.length > MAX_ROWS && (
          <p className="px-1.5 pt-1 text-center text-[10px] text-slate-600">
            自选较多, 仅展示前 {MAX_ROWS} 只 · 共 {codes.length} 只
          </p>
        )}
      </div>
    </div>
  );
}
