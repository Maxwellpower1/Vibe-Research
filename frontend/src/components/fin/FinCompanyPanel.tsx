import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useFin } from "@/components/fin/FinContext";
import { fmtYiYuan, quarterLabel } from "@/components/fin/utils";
import { pctColor } from "@/components/review/format";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

function Card({ label, value, yoy }: { label: string; value: string; yoy?: number | null }) {
  return (
    <div className="rounded bg-slate-800/40 px-1.5 py-1">
      <p className="text-[9px] text-slate-500">{label}</p>
      <p className="font-mono text-[12px] font-semibold tabular-nums text-slate-100">{value}</p>
      {yoy != null && Number.isFinite(yoy) && (
        <p className={cn("font-mono text-[9px]", pctColor(yoy))}>{yoy > 0 ? "+" : ""}{yoy.toFixed(1)}%</p>
      )}
    </div>
  );
}

export function FinCompanyPanel() {
  const { company, recent, select, companyBundle: data, companyError: error } = useFin();
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
    if (!v.trim()) {
      setHits([]);
      return;
    }
    timer.current = window.setTimeout(() => {
      void api.finSuggest(v.trim(), 8).then((rows) => {
        setHits(rows);
        setOpen(true);
      }).catch(() => setHits([]));
    }, 280);
  };

  const main = data?.main;
  const r0 = main?.reports?.[0];
  const val = data?.valuation;
  const snap = data?.snapshot;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 p-1.5">
      <div ref={boxRef} className="relative shrink-0">
        <input
          value={q}
          onChange={(e) => onType(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          placeholder="输入代码/名称"
          className="h-6 w-full rounded bg-slate-800/60 px-2 text-[11px] text-slate-200 placeholder:text-[9px] placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
        />
        {open && hits.length > 0 && (
          <div className="absolute left-0 right-0 top-7 z-20 overflow-hidden rounded border border-slate-700/60 bg-[#0c1320] shadow-lg">
            {hits.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() => { select(s.code, s.name); setQ(""); setOpen(false); }}
                className="flex h-6 w-full items-center gap-2 px-2 text-left hover:bg-slate-800/50"
              >
                <span className="w-14 font-mono text-[10px] text-slate-500">{s.code}</span>
                <span className="truncate text-[11px] text-slate-200">{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {recent.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1">
          {recent.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => select(c.code, c.name)}
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10px]",
                c.code === company.code
                  ? "border-cyan-500/50 text-cyan-300"
                  : "border-slate-700/60 text-slate-400",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {!company.code && (
        <p className="py-6 text-center text-[11px] text-slate-600">搜索或点日历 / 榜单选公司</p>
      )}
      {company.code && !data && (
        <p className="py-6 text-center text-[11px] text-slate-600">{error ? "公司财报未接通" : "加载中…"}</p>
      )}
      {r0 && (
        <div className="grid shrink-0 grid-cols-2 gap-1">
          <Card label="营收" value={fmtYiYuan(r0.revenue)} yoy={r0.revenue_yoy} />
          <Card label="净利" value={fmtYiYuan(r0.net_profit)} yoy={r0.profit_yoy} />
          <Card label="ROE" value={`${r0.roe.toFixed(1)}%`} />
          <Card label="EPS" value={r0.eps != null ? r0.eps.toFixed(2) : "—"} />
          <Card label="毛利率" value={`${r0.gross_margin.toFixed(1)}%`} />
          <Card label="报告期" value={quarterLabel(r0.date || r0.label)} />
        </div>
      )}
      {snap && !r0 && (
        <p className="text-[11px] text-slate-400">摘要 {snap.period} 营收 {snap.revenue} 净利 {snap.net_profit}</p>
      )}
      {val && (
        <div className="flex shrink-0 flex-wrap gap-1 text-[10px] text-slate-400">
          <span>PE {val.pe_ttm || "—"}</span>
          {val.pe_26e != null && <span>前向PE {val.pe_26e}</span>}
          {val.peg != null && <span>PEG {val.peg}</span>}
          {val.analyst_count > 0 && <span>{val.analyst_count} 家覆盖</span>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(data?.announcements ?? []).slice(0, 4).map((a) => (
          <a
            key={a.url || a.title}
            href={a.url || undefined}
            target="_blank"
            rel="noreferrer"
            className="block truncate px-0.5 py-0.5 text-[10px] text-slate-400 hover:text-cyan-300"
          >
            <span className="mr-1 font-mono text-slate-600">{a.date.slice(5)}</span>
            {a.title}
          </a>
        ))}
        {(data?.reports ?? []).slice(0, 2).map((r) => (
          <a
            key={r.pdfUrl || r.title}
            href={r.pdfUrl || undefined}
            target="_blank"
            rel="noreferrer"
            className="block truncate px-0.5 py-0.5 text-[10px] text-slate-500 hover:text-cyan-300"
          >
            {(r.publishDate || "").slice(5, 10)} {r.orgSName} {r.title}
          </a>
        ))}
        {company.code ? (
          <Link
            to={`/a-share?tab=detail&code=${company.code}`}
            className="mt-1 inline-block text-[10px] text-cyan-400/80 hover:text-cyan-300"
          >
            打开个股详情 →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
