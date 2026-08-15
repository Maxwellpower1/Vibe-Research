import { useMemo } from "react";
import { useFin } from "@/components/fin/FinContext";
import { fmtYiYuan } from "@/components/fin/utils";
import { pctColor } from "@/components/review/format";
import { cn } from "@/lib/utils";

export function FinPeerPanel() {
  const { company, select, board, companyBundle: bundle } = useFin();

  const industry = bundle?.main?.industry || board?.stocks.find((s) => s.code === company.code)?.industry || "";
  const peers = useMemo(() => {
    const rows = (board?.stocks ?? []).filter((s) => industry && s.industry === industry);
    return rows.slice(0, 18);
  }, [board, industry]);

  const avg = (key: "net_profit" | "profit_yoy" | "roe") => {
    if (!peers.length) return 0;
    return peers.reduce((s, r) => s + r[key], 0) / peers.length;
  };
  const me = peers.find((s) => s.code === company.code) || board?.stocks.find((s) => s.code === company.code);
  const rank = me ? peers.findIndex((s) => s.code === me.code) + 1 : 0;

  return (
    <div className="flex h-full min-h-0 flex-col p-1.5">
      <p className="shrink-0 text-[10px] text-slate-500">
        {industry || "同业"} · {peers.length} 家
        {rank > 0 && <span className="ml-1 text-cyan-300">净利第 {rank}</span>}
      </p>
      {me && (
        <div className="mb-1 mt-1 grid shrink-0 grid-cols-3 gap-1 text-[10px]">
          {[
            ["净利", fmtYiYuan(me.net_profit), fmtYiYuan(avg("net_profit"))],
            ["同比", `${me.profit_yoy.toFixed(1)}%`, `${avg("profit_yoy").toFixed(1)}%`],
            ["ROE", `${me.roe.toFixed(1)}%`, `${avg("roe").toFixed(1)}%`],
          ].map(([k, a, b]) => (
            <div key={k} className="rounded bg-slate-800/40 px-1.5 py-1">
              <p className="text-slate-500">{k}</p>
              <p className="font-mono text-slate-200">{a}</p>
              <p className="font-mono text-[9px] text-slate-600">同行 {b}</p>
            </div>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {peers.map((s) => (
          <button
            key={s.code}
            type="button"
            onClick={() => select(s.code, s.name)}
            className={cn(
              "grid w-full grid-cols-[1fr_56px_48px_36px] items-center gap-1 rounded px-1 py-0.5 text-left",
              s.code === company.code ? "bg-cyan-500/10" : "hover:bg-slate-800/40",
            )}
          >
            <span className="truncate text-[11px] text-slate-200">{s.name}</span>
            <span className="text-right font-mono text-[10px] text-slate-300">{fmtYiYuan(s.net_profit)}</span>
            <span className={cn("text-right font-mono text-[10px]", pctColor(s.profit_yoy))}>
              {s.profit_yoy > 0 ? "+" : ""}{s.profit_yoy.toFixed(1)}%
            </span>
            <span className="text-right font-mono text-[10px] text-slate-500">{s.roe.toFixed(1)}</span>
          </button>
        ))}
        {!peers.length && <p className="py-6 text-center text-[11px] text-slate-600">选公司后对照同业</p>}
      </div>
    </div>
  );
}
