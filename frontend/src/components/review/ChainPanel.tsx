import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { CHAINS, matchRelatedBoards, type ChainStock } from "@/config/chains";
import { WatchStar } from "@/components/cockpit/WatchStar";
import { Chip, ChipGroup } from "@/components/ui/SectionHeader";
import { pctColor } from "@/components/review/format";
import { usePolling } from "@/hooks/usePolling";
import { api, type SectorBoard } from "@/lib/api";
import { useQuotes } from "@/lib/quoteHub";
import { cn } from "@/lib/utils";
import { storageGet, storageSet } from "@/lib/storage";

const CHAIN_KEY = "ashare.review.chain";
const OVERRIDE_KEY = "ashare.review.chain.override";

type OverrideMap = Record<string, { segments: Array<{ stocks: ChainStock[] }> }>;

function loadOverrides(): OverrideMap {
  const raw = storageGet(OVERRIDE_KEY);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as OverrideMap;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Upstream / mid / downstream chain with live quotes, related boards, iwencai refresh. */
export function ChainPanel() {
  const [id, setId] = useState(() => {
    const s = storageGet(CHAIN_KEY);
    return s && CHAINS.some((c) => c.id === s) ? s : CHAINS[0].id;
  });
  const [overrides, setOverrides] = useState<OverrideMap>(loadOverrides);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [iwencaiReady, setIwencaiReady] = useState(false);
  const base = CHAINS.find((c) => c.id === id) ?? CHAINS[0];
  const ov = overrides[id];
  const chain = useMemo(() => {
    if (!ov?.segments?.length) return base;
    return {
      ...base,
      segments: base.segments.map((seg, i) => ({
        ...seg,
        stocks: ov.segments[i]?.stocks?.length ? ov.segments[i].stocks : seg.stocks,
      })),
    };
  }, [base, ov]);
  const codes = useMemo(
    () => chain.segments.flatMap((s) => s.stocks.map((x) => x.code)),
    [chain],
  );
  const quotes = useQuotes(codes);
  const { data: boards } = usePolling(async () => {
    const [ind, con] = await Promise.all([
      api.sectorBoards("01", "0", 40),
      api.sectorBoards("02", "0", 40),
    ]);
    const seen = new Set<string>();
    const out: SectorBoard[] = [];
    for (const b of [...(ind || []), ...(con || [])]) {
      const k = b.name || b.code;
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(b);
    }
    return out;
  }, 60_000, [id]);
  const related = useMemo(
    () => matchRelatedBoards(boards || [], chain.keywords, 8),
    [boards, chain],
  );

  useEffect(() => {
    storageSet(CHAIN_KEY, id);
  }, [id]);

  useEffect(() => {
    void api.iwencaiStatus().then((s) => setIwencaiReady(!!s.configured)).catch(() => setIwencaiReady(false));
  }, []);

  const refresh = async () => {
    if (busy) return;
    if (!iwencaiReady) {
      setErr("未配置问财 key");
      return;
    }
    if (!base.segments.some((s) => s.query)) {
      setErr("该产业链未配置问财查询语");
      return;
    }
    setBusy(true);
    setErr("");
    const segs: Array<{ stocks: ChainStock[] }> = [];
    let first = "";
    let got = 0;
    for (const seg of base.segments) {
      if (!seg.query) {
        segs.push({ stocks: seg.stocks });
        continue;
      }
      try {
        const r = await api.iwencaiSelect(seg.query, 8);
        const stocks = (r.rows || [])
          .map((row) => ({ code: row.code, name: row.name, tag: seg.desc.split("·")[0]?.trim() }))
          .filter((s) => /^\d{6}$/.test(s.code))
          .slice(0, 8);
        if (stocks.length) {
          segs.push({ stocks });
          got += stocks.length;
        } else {
          segs.push({ stocks: seg.stocks });
        }
      } catch (e) {
        if (!first) first = e instanceof Error ? e.message : String(e);
        segs.push({ stocks: seg.stocks });
      }
    }
    if (got === 0) {
      setErr(first || "问财未返回名单");
      setBusy(false);
      return;
    }
    const next = { ...overrides, [id]: { segments: segs } };
    setOverrides(next);
    storageSet(OVERRIDE_KEY, JSON.stringify(next));
    setBusy(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-1 py-1">
        <ChipGroup>
          {CHAINS.map((c) => (
            <Chip key={c.id} active={id === c.id} onClick={() => setId(c.id)}>{c.name}</Chip>
          ))}
        </ChipGroup>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 disabled:opacity-50"
          title={iwencaiReady ? "用问财按环节查询语刷新名单" : "需配置 IWENCAI_API_KEY"}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          问财刷新
        </button>
      </div>
      {err && <p className="px-1.5 text-[10px] text-rose-400">{err}</p>}
      {related.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1.5 pb-1">
          <span className="self-center text-[9px] text-slate-600">相关板块</span>
          {related.map((b) => (
            <span key={b.code || b.name} className="rounded bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-300">
              {b.name}
              <span className={cn("ml-1 font-mono tabular-nums", pctColor(b.pct))}>
                {b.pct > 0 ? "+" : ""}{b.pct.toFixed(2)}%
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-2 p-1 md:grid-cols-3">
          {chain.segments.map((seg, si) => (
            <div key={seg.name} className="rounded-md border border-border/60 bg-card/80 p-2">
              <p className="text-[11px] font-semibold text-slate-200">
                {seg.name}
                {ov?.segments[si]?.stocks?.length ? (
                  <span className="ml-1 text-[9px] font-normal text-emerald-400/80">问财</span>
                ) : null}
              </p>
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
                      <WatchStar code={st.code} />
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
