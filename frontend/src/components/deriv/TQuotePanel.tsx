import { useEffect, useMemo, useState } from "react";
import { api, type OvlabTQuoteExpiry, type OvlabTQuoteSide } from "@/lib/api";
import type { DerivData } from "@/hooks/useDerivData";
import { usePolling } from "@/hooks/usePolling";
import { num } from "@/components/ovlab/shared";
import { cn } from "@/lib/utils";
import { CellEmpty } from "./derivShared";

const WINDOW = 6; // ATM 上下各 6 档

function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
}

function fmtOi(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(Math.round(v));
}

/** 行权价: 整数不带小数, 非整数最多 2 位. */
function fmtStrike(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** 市场 IV 取买卖中值, 缺失回落理论 IV. */
function ivOf(s: OvlabTQuoteSide): number | null {
  const b = num(s.ivBid);
  const a = num(s.ivAsk);
  if (b !== null && a !== null) return (b + a) / 2;
  return num(s.theoIv);
}

/** 单侧 4 格: call 侧右对齐 (价 IV Δ 持仓), put 侧左对齐反向 (持仓 Δ IV 价). */
function SideCells({ s, itm, side }: { s: OvlabTQuoteSide; itm: boolean; side: "call" | "put" }) {
  const iv = ivOf(s);
  const delta = num(s.delta);
  const oi = num(s.oi);
  const oiChg = num(s.oiChg);
  const bg = itm ? "bg-slate-800/40" : undefined;
  const alignCls = side === "call" ? "num" : "text-left tabular-nums";
  const priceTd = (
    <td key="price" className={cn(alignCls, "text-slate-200", bg)}>{fmtPrice(s.price)}</td>
  );
  const ivTd = (
    <td
      key="iv"
      className={cn(alignCls, "text-violet-300/90", bg)}
      title={`买IV ${num(s.ivBid)?.toFixed(1) ?? "-"} / 卖IV ${num(s.ivAsk)?.toFixed(1) ?? "-"}`}
    >
      {iv !== null ? iv.toFixed(1) : <span className="nil">-</span>}
    </td>
  );
  const deltaTd = (
    <td key="delta" className={cn(alignCls, "text-slate-400", bg)}>
      {delta !== null ? delta.toFixed(2) : "-"}
    </td>
  );
  const oiTd = (
    <td
      key="oi"
      className={cn(alignCls, "text-slate-400", bg)}
      title={oiChg !== null ? `持仓变化 ${oiChg > 0 ? "+" : ""}${Math.round(oiChg)}` : undefined}
    >
      {fmtOi(oi)}
      {oiChg !== null && oiChg !== 0 && (
        <span className={cn("ml-0.5 text-[9px]", oiChg > 0 ? "text-red-400/80" : "text-emerald-400/80")}>
          {oiChg > 0 ? "+" : ""}{Math.round(oiChg)}
        </span>
      )}
    </td>
  );
  return side === "call"
    ? <>{priceTd}{ivTd}{deltaTd}{oiTd}</>
    : <>{oiTd}{deltaTd}{ivTd}{priceTd}</>;
}

/** T 型报价: 行权价链 (理论价/IV/Delta/持仓) x 到期月. 数据 OpenVlab volatility-surface + Black-76. */
export function TQuotePanel({ d }: { d: DerivData }) {
  const products = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ code: string; alias: string }> = [];
    for (const r of d.rows ?? []) {
      const code = String(r.prodUnd ?? "").trim();
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push({ code, alias: String(r.product_alias ?? code) });
    }
    return out;
  }, [d.rows]);

  const [prod, setProd] = useState<string>("");
  useEffect(() => {
    if (prod || products.length === 0) return;
    const preferred = d.rows?.find((r) => num(r.atmv_current) !== null);
    setProd(String(preferred?.prodUnd ?? products[0].code));
  }, [prod, products, d.rows]);

  const [exp, setExp] = useState<string>("");
  useEffect(() => { setExp(""); }, [prod]); // 换品种回到最近月

  const tq = usePolling(
    () => (prod ? api.ovlabTQuote(prod) : Promise.resolve(null)),
    60_000,
    [prod],
    Boolean(prod),
  );
  const loading = tq.data === null && !tq.error;
  const expiries = tq.data?.expiries ?? [];
  const cur: OvlabTQuoteExpiry | undefined = expiries.find((e) => e.exp === exp) ?? expiries[0];

  const rows = useMemo(() => {
    if (!cur) return [];
    const strikes = cur.strikes ?? [];
    const atmIdx = strikes.findIndex((s) => s.strike === cur.atm);
    const center = atmIdx >= 0 ? atmIdx : strikes.length >> 1;
    return strikes.slice(Math.max(0, center - WINDOW), center + WINDOW + 1);
  }, [cur]);

  const fwd = num(cur?.forward);
  const atmIvChg = cur?.atmIv != null && cur?.atmIvYd != null ? cur.atmIv - cur.atmIvYd : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 品种 + 到期月选择 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-1.5 pt-1">
        <select
          value={prod}
          onChange={(e) => setProd(e.target.value)}
          className="h-5 max-w-[7.5rem] rounded border border-slate-700/60 bg-slate-900 px-1 text-[10px] text-slate-300 outline-none"
          title="品种"
        >
          {products.map((p) => (
            <option key={p.code} value={p.code}>{p.alias} {p.code}</option>
          ))}
        </select>
        {expiries.map((e) => (
          <button
            key={e.exp}
            type="button"
            onClick={() => setExp(e.exp)}
            className={cn(
              "h-5 rounded px-1.5 text-[10px] tabular-nums transition-colors",
              cur?.exp === e.exp
                ? "bg-cyan-500/20 text-cyan-300"
                : "text-slate-500 hover:bg-slate-800/60 hover:text-slate-300",
            )}
            title={`到期日 ${e.expiryDate ?? "-"}`}
          >
            {e.exp.slice(2)} · {e.dte ?? "-"}天
          </button>
        ))}
        {cur?.lastTime && (
          <span className="ml-auto text-[9px] tabular-nums text-slate-600">{cur.lastTime.slice(5, 16)}</span>
        )}
      </div>

      {/* 概览行: 远期 / ATM隐波 / PCR / 预期波动 */}
      {cur && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 px-1.5 py-1 text-[10px] tabular-nums text-slate-500">
          <span>远期 <span className="text-slate-300">{fwd !== null ? fmtPrice(fwd) : "-"}</span></span>
          <span>
            ATM隐波 <span className="text-violet-300">{cur.atmIv?.toFixed(1) ?? "-"}</span>
            {atmIvChg !== null && (
              <span className={cn("ml-0.5", atmIvChg > 0 ? "text-red-400" : atmIvChg < 0 ? "text-emerald-400" : "")}>
                {atmIvChg > 0 ? "+" : ""}{atmIvChg.toFixed(1)}
              </span>
            )}
          </span>
          <span>PCR <span className="text-slate-300">{cur.pcr?.toFixed(2) ?? "-"}</span></span>
          {cur.moveUp != null && (
            <span>预期波动 <span className="text-slate-300">±{(cur.moveUp * 100).toFixed(1)}%</span></span>
          )}
        </div>
      )}

      {/* T 型表 */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="flex h-full items-center justify-center text-[11px] text-slate-500">更新中…</div>
        )}
        {!loading && !cur && <CellEmpty text={tq.error ? "未取到" : "暂无数据"} />}
        {cur && (
          <table className="data-table text-[10px]">
            <thead>
              <tr>
                <th className="num font-normal">价</th>
                <th className="num font-normal">IV</th>
                <th className="num font-normal">Δ</th>
                <th className="num font-normal">持仓</th>
                <th className="text-center font-normal text-slate-400">行权价</th>
                <th className="font-normal">持仓</th>
                <th className="font-normal">Δ</th>
                <th className="font-normal">IV</th>
                <th className="font-normal">价</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const isAtm = s.strike === cur.atm;
                const callItm = fwd !== null && s.strike < fwd;
                const putItm = fwd !== null && s.strike > fwd;
                return (
                  <tr key={s.strike} className={cn(isAtm && "bg-cyan-500/10")}>
                    <SideCells s={s.call} itm={callItm} side="call" />
                    <td className={cn(
                      "text-center font-medium tabular-nums",
                      isAtm ? "text-cyan-300" : "text-slate-400",
                    )}>
                      {fmtStrike(s.strike)}
                      {isAtm && <span className="ml-0.5 text-[8px] text-cyan-500/80">ATM</span>}
                    </td>
                    <SideCells s={s.put} itm={putItm} side="put" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
