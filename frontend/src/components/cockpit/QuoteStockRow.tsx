import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MinuteSpark } from "@/components/review/MinuteSpark";
import { bgChg, fmtAmt, fmtPrice, pctColor } from "@/components/review/format";
import { usePolling } from "@/hooks/usePolling";
import { loadLightKline } from "@/lib/lightKline";
import { cn } from "@/lib/utils";
import { klineHref } from "@/components/cockpit/QuoteLine";

const COMPACT_W = 400;
const KLINE_MS = 60_000;

function Stat({
  label,
  value,
  valueCls = "text-slate-300",
}: {
  label?: string;
  value: ReactNode;
  valueCls?: string;
}) {
  return (
    <span className="flex min-w-0 items-center justify-end gap-1 leading-none">
      {label && <span className="shrink-0 text-[9px] text-slate-600">{label}</span>}
      <span className={cn("truncate text-[11px] tabular-nums", valueCls)}>{value}</span>
    </span>
  );
}

function useRowBox() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [on, setOn] = useState(false);
  const [rowW, setRowW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const io = new IntersectionObserver(
      (ents) => setOn(ents.some((e) => e.isIntersecting)),
      { rootMargin: "80px" },
    );
    const ro = new ResizeObserver((ents) => setRowW(ents[0]?.contentRect.width ?? 0));
    io.observe(el);
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, [el]);
  return { setEl, on, rowW };
}

/** Two-row stock line: name/code, spark, amount/price, main-net/ratio bar, turnover, pct. */
export function QuoteStockRow({
  code,
  name,
  price,
  pct,
  amount,
  turnover,
  mainNet,
  mainPct,
  rank,
  symbol,
  link = true,
}: {
  code: string;
  name: string;
  price: number | null | undefined;
  pct: number | null | undefined;
  amount?: number | null;
  turnover?: number | null;
  mainNet?: number | null;
  mainPct?: number | null;
  rank?: number;
  symbol?: string;
  link?: boolean;
}) {
  const { setEl, on: visible, rowW } = useRowBox();
  const compact = rowW > 0 && rowW < COMPACT_W;

  const { data: kl } = usePolling(
    () => loadLightKline(code, "1", 240),
    KLINE_MS,
    [code],
    visible,
  );
  const closes = (kl?.bars || []).map((b) => b.close).filter((n) => Number.isFinite(n));
  const href = link ? klineHref(code) : undefined;
  const hasAmt = amount != null && amount > 0;
  const hasTurn = turnover != null && turnover > 0;
  const ratioBar = mainPct != null ? Math.min(100, Math.abs(mainPct) * 2) : 0;
  const rankCls = rank != null && rank <= 3 ? "text-amber-400" : "text-slate-600";

  const inner = (
    <div
      className="grid items-center gap-x-1"
      style={{
        gridTemplateColumns: `${rank != null ? "auto " : ""}72px minmax(0,1fr) minmax(0,1fr) ${hasAmt ? "64px" : "0px"} 60px`,
        gridTemplateRows: "20px 16px",
      }}
    >
      {rank != null && (
        <div className={cn("row-span-2 self-center text-[11px] font-bold leading-none tabular-nums", rankCls)}>
          {rank}
        </div>
      )}
      <div className="row-span-2 flex min-w-0 flex-col justify-center gap-1 leading-none">
        <span className="truncate text-[11px] text-slate-200">{name}</span>
        <span className="truncate text-[10px] text-slate-500">{symbol || code}</span>
      </div>
      <div className="col-span-2 flex h-5 min-w-0 items-center self-center">
        {closes.length > 1 ? (
          <MinuteSpark closes={closes} prevClose={kl?.prev_close} pct={pct ?? 0} className="h-5" />
        ) : (
          <span className="text-[10px] text-slate-600">——</span>
        )}
      </div>
      {hasAmt ? <Stat label="额" value={fmtAmt(amount)} /> : <div />}
      <Stat label="价" value={fmtPrice(price)} />
      <Stat
        label={compact ? "净" : "主力净额"}
        value={fmtAmt(mainNet)}
        valueCls={cn("font-semibold", mainNet != null ? pctColor(mainNet) : "text-slate-600")}
      />
      <div className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap leading-none">
        <span className="shrink-0 text-[9px] text-slate-600">{compact ? "占" : "净占比"}</span>
        <span className="h-1 min-w-0 flex-1 self-center rounded-full bg-slate-800">
          <span
            className={cn("block h-1 rounded-full", (mainPct ?? 0) < 0 ? "bg-emerald-400/80" : "bg-rose-400/80")}
            style={{ width: `${ratioBar}%` }}
          />
        </span>
        <span className={cn("truncate text-[11px] tabular-nums", mainPct != null ? pctColor(mainPct) : "text-slate-600")}>
          {mainPct != null && Number.isFinite(mainPct) ? `${mainPct.toFixed(1)}%` : "—"}
        </span>
      </div>
      {hasTurn ? <Stat label="换" value={`${turnover!.toFixed(1)}%`} /> : <div />}
      <Stat
        label="幅"
        value={
          pct != null && Number.isFinite(pct) ? (
            <span className={cn("rounded px-0.5 font-semibold", bgChg(pct))}>
              {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
            </span>
          ) : "—"
        }
      />
    </div>
  );

  const cls = "group block w-full rounded px-2 py-[4px] text-left transition-colors hover:bg-slate-800/40 hover:shadow-[inset_0_0_0_1px_rgba(34,211,238,0.22)]";
  return (
    <div ref={setEl}>
      {href ? (
        <Link to={href} className={cls}>{inner}</Link>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </div>
  );
}
