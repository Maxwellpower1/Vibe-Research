import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CHAINS } from "@/config/chains";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { pctColor } from "@/components/review/format";
import { useQuotes } from "@/lib/quoteHub";
import { cn } from "@/lib/utils";
import { storageGet, storageSet } from "@/lib/storage";

const CHAIN_KEY = "ashare.review.chain";

/** Upstream / mid / downstream chain with live quotes. */
export function ChainPanel() {
  const [id, setId] = useState(() => {
    const s = storageGet(CHAIN_KEY);
    return s && CHAINS.some((c) => c.id === s) ? s : CHAINS[0].id;
  });
  const chain = CHAINS.find((c) => c.id === id) ?? CHAINS[0];
  const codes = useMemo(
    () => chain.segments.flatMap((s) => s.stocks.map((x) => x.code)),
    [chain],
  );
  const quotes = useQuotes(codes);

  useEffect(() => {
    storageSet(CHAIN_KEY, id);
  }, [id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-1 py-1">
        <ChipGroup>
          {CHAINS.map((c) => (
            <Chip key={c.id} active={id === c.id} onClick={() => setId(c.id)}>{c.name}</Chip>
          ))}
        </ChipGroup>
        <span className="ml-auto text-[10px] text-slate-500">客观名单 · 非推荐</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-2 p-1 md:grid-cols-3">
          {chain.segments.map((seg) => (
            <div key={seg.name} className="rounded-md border border-slate-700/40 bg-[#0c1320]/80 p-2">
              <p className="text-[11px] font-semibold text-slate-200">{seg.name}</p>
              <p className="mb-1.5 text-[10px] text-slate-500">{seg.desc}</p>
              <div className="space-y-0.5">
                {seg.stocks.map((st) => {
                  const q = quotes[st.code];
                  const pct = q?.pct;
                  return (
                    <Link
                      key={st.code}
                      to={`/a-share?tab=kline&code=${st.code}`}
                      className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-800/50"
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">{st.name}</span>
                      {st.tag && <span className="shrink-0 text-[10px] text-slate-500">{st.tag}</span>}
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-300">
                        {q ? q.price.toFixed(2) : "—"}
                      </span>
                      <span className={cn("w-12 shrink-0 text-right font-mono text-[10px] tabular-nums", pctColor(pct ?? 0))}>
                        {pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
