import { useEffect, useMemo, useRef, useState } from "react";
import { api, type OvlabTQuoteExpiry, type OvlabTQuoteSide, type OvlabTQuoteStrike } from "@/lib/api";
import type { DerivData } from "@/hooks/useDerivData";
import { usePolling } from "@/hooks/usePolling";
import { num } from "@/components/ovlab/shared";
import { cn } from "@/lib/utils";
import { CellEmpty } from "./derivShared";

const WINDOW = 8;
const OI_PAD = 12;

/** 点选的期权合约 (联动日K/分时卡片). */
export interface OptionPick {
  code: string; // 期权合约代码, 如 AU2609C952
  und: string;  // 标的码 (日K IV 叠加用)
  name: string; // 展示名, 如 AU2609购952
}

/** 代码转展示名: AU2609C952 -> AU2609购952. 锚定末尾 C/P+行权价, 防品种码本身含 C/P (玉米 C / PP / ZC). */
export function optionName(code: string): string {
  return code.replace(/C(\d+(?:\.\d+)?)$/, "购$1").replace(/P(\d+(?:\.\d+)?)$/, "沽$1");
}

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

function fmtPct(v: number, digits = 1): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

/** 市场 IV 取买卖中值, 缺失回落理论 IV. */
export function ivOf(s: OvlabTQuoteSide): number | null {
  const b = num(s.ivBid);
  const a = num(s.ivAsk);
  if (b !== null && a !== null) return (b + a) / 2;
  return num(s.theoIv);
}

/** ATM 附近切片; 最大购/沽持仓若在 ATM±OI_PAD 内则扩窗带上. */
export function sliceChain(strikes: OvlabTQuoteStrike[], atm: number | null | undefined, all = false): OvlabTQuoteStrike[] {
  if (all || strikes.length === 0) return strikes;
  const atmIdx = atm != null ? strikes.findIndex((s) => s.strike === atm) : -1;
  const center = atmIdx >= 0 ? atmIdx : strikes.length >> 1;
  let lo = Math.max(0, center - WINDOW);
  let hi = Math.min(strikes.length, center + WINDOW + 1);
  let maxC = -1;
  let maxP = -1;
  let iC = -1;
  let iP = -1;
  for (let i = 0; i < strikes.length; i++) {
    const c = num(strikes[i].call.oi) ?? -1;
    const p = num(strikes[i].put.oi) ?? -1;
    if (c > maxC) { maxC = c; iC = i; }
    if (p > maxP) { maxP = p; iP = i; }
  }
  for (const i of [iC, iP]) {
    if (i < 0 || Math.abs(i - center) > OI_PAD) continue;
    lo = Math.min(lo, i);
    hi = Math.max(hi, i + 1);
  }
  return strikes.slice(lo, hi);
}

/** 沽虚值 IV - 购虚值 IV; 正=沽更贵 (下行保护需求). */
export function ivSkew(strikes: OvlabTQuoteStrike[], fwd: number | null): number | null {
  if (fwd === null || strikes.length === 0) return null;
  const below = [...strikes].reverse().find((s) => s.strike < fwd);
  const above = strikes.find((s) => s.strike > fwd);
  const putIv = below ? ivOf(below.put) : null;
  const callIv = above ? ivOf(above.call) : null;
  if (putIv === null || callIv === null) return null;
  return putIv - callIv;
}

export function maxOiIdx(strikes: OvlabTQuoteStrike[], side: "call" | "put"): number {
  let best = -1;
  let idx = -1;
  for (let i = 0; i < strikes.length; i++) {
    const v = num(side === "call" ? strikes[i].call.oi : strikes[i].put.oi);
    if (v !== null && v > best) { best = v; idx = i; }
  }
  return idx;
}

/** 可见档购+沽持仓最大值, 给横条定标尺. */
export function maxOiVal(strikes: OvlabTQuoteStrike[]): number {
  let m = 0;
  for (const s of strikes) {
    const c = num(s.call.oi);
    const p = num(s.put.oi);
    if (c !== null && c > m) m = c;
    if (p !== null && p > m) m = p;
  }
  return m;
}

/** 持仓横条: Call 向右长(朝行权价), Put 向左长; 数字叠在条上. */
function OiBar({
  value, max, side, highlight, chg,
}: {
  value: number | null;
  max: number;
  side: "call" | "put";
  highlight?: boolean;
  chg?: number | null;
}) {
  const pct = value !== null && max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const call = side === "call";
  return (
    <span className={cn("relative flex h-[1.05rem] w-[5.2rem] items-center overflow-hidden", call ? "justify-end" : "justify-start")}>
      <span
        className={cn(
          "absolute inset-y-0",
          call ? "right-0 rounded-l-[2px]" : "left-0 rounded-r-[2px]",
          highlight ? "bg-amber-300/25" : call ? "bg-red-400/15" : "bg-emerald-400/15",
        )}
        style={{ width: `${pct}%` }}
      />
      <span className={cn("relative z-[1] px-0.5 tabular-nums text-[10px]", highlight ? "text-amber-200" : "text-slate-200")}>
        {fmtOi(value)}
        {highlight && <span className="ml-0.5 text-[9px] text-amber-400/80">仓</span>}
        {chg != null && chg !== 0 && (
          <span className={cn("ml-0.5 text-[9px]", chg > 0 ? "text-red-400/70" : "text-emerald-400/70")}>
            {chg > 0 ? "+" : ""}{Math.round(chg)}
          </span>
        )}
      </span>
    </span>
  );
}

function fmtMove(up: number | null | undefined, dn: number | null | undefined): string | null {
  if (up == null && dn == null) return null;
  const u = up != null ? up * 100 : null;
  const d = dn != null ? dn * 100 : null;
  if (u != null && d != null && Math.abs(u + d) < 0.15) return `±${Math.abs(u).toFixed(1)}%`;
  const us = u != null ? fmtPct(u) : "-";
  const ds = d != null ? `${d.toFixed(1)}%` : "-";
  return `${us} / ${ds}`;
}

/** 单侧 4 格: 最新价贴行权价. call 右对齐 (IV Delta 持仓 最新价), put 左对齐反向. 整侧可点选. */
function SideCells({ s, itm, side, selected, maxOi, oiMax, atmIv, onPick }: {
  s: OvlabTQuoteSide;
  itm: boolean;
  side: "call" | "put";
  selected?: boolean;
  maxOi?: boolean;
  oiMax?: number;
  atmIv?: number | null;
  onPick?: () => void;
}) {
  const iv = ivOf(s);
  const delta = num(s.delta);
  const oi = num(s.oi);
  const oiChg = num(s.oiChg);
  const ivDiff = iv !== null && atmIv != null ? iv - atmIv : null;
  const bg = selected ? "bg-violet-500/15" : itm ? "bg-slate-800/40" : undefined;
  const alignCls = side === "call" ? "num" : "text-left tabular-nums";
  const pickCls = onPick ? "cursor-pointer hover:bg-violet-500/10" : undefined;
  const priceTd = (
    <td key="price" onClick={onPick} className={cn(alignCls, "text-[12px] font-medium text-slate-100", bg, pickCls)}>{fmtPrice(s.price)}</td>
  );
  const ivTd = (
    <td
      key="iv"
      onClick={onPick}
      className={cn(
        alignCls, bg, pickCls,
        ivDiff !== null && ivDiff >= 1.5 ? "text-red-400" : ivDiff !== null && ivDiff <= -1.5 ? "text-emerald-400" : "text-violet-300/90",
      )}
      title={`买IV ${num(s.ivBid)?.toFixed(1) ?? "-"} / 卖IV ${num(s.ivAsk)?.toFixed(1) ?? "-"}${ivDiff != null ? ` · vs ATM ${ivDiff > 0 ? "+" : ""}${ivDiff.toFixed(1)}` : ""}`}
    >
      {iv !== null ? iv.toFixed(1) : <span className="nil">-</span>}
    </td>
  );
  const deltaTd = (
    <td key="delta" onClick={onPick} className={cn(alignCls, "text-slate-200", bg, pickCls)}>
      {delta !== null ? delta.toFixed(2) : "-"}
    </td>
  );
  const oiTd = (
    <td
      key="oi"
      onClick={onPick}
      className={cn("w-[5.4rem] min-w-[5.4rem] p-0.5", alignCls, bg, pickCls)}
      title={oiChg !== null ? `持仓 ${fmtOi(oi)}  变化 ${oiChg > 0 ? "+" : ""}${Math.round(oiChg)}` : `持仓 ${fmtOi(oi)}`}
    >
      <OiBar value={oi} max={oiMax ?? 0} side={side} highlight={maxOi} chg={oiChg} />
    </td>
  );
  return side === "call"
    ? <>{ivTd}{deltaTd}{oiTd}{priceTd}</>
    : <>{priceTd}{oiTd}{deltaTd}{ivTd}</>;
}

/** T 型报价: 行权价链 (理论价/IV/Delta/持仓横条) x 到期月. 数据 OpenVlab volatility-surface + Black-76.
 *  品种受控于驾驶舱 (点品种行联动); 点单侧格子发出 onPickContract 联动日K/分时卡.
 *  换品种/到期月且当前选中不在链上时, 自动点 ATM 购. */
export function TQuotePanel({ d, product, onProduct, pick, onPickContract }: {
  d: DerivData;
  product?: string;
  onProduct?: (prod: string) => void;
  pick?: OptionPick | null;
  onPickContract?: (p: OptionPick) => void;
}) {
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

  const prod = product ?? "";
  useEffect(() => {
    if (prod || products.length === 0 || !onProduct) return;
    const preferred = d.rows?.find((r) => num(r.atmv_current) !== null);
    onProduct(String(preferred?.prodUnd ?? products[0].code));
  }, [prod, products, d.rows, onProduct]);

  const [exp, setExp] = useState<string>("");
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setExp(""); setShowAll(false); }, [prod]);

  const tq = usePolling(
    () => (prod ? api.ovlabTQuote(prod) : Promise.resolve(null)),
    60_000,
    [prod],
    Boolean(prod),
  );
  const loading = tq.data === null && !tq.error;
  const expiries = tq.data?.expiries ?? [];
  const cur: OvlabTQuoteExpiry | undefined = expiries.find((e) => e.exp === exp) ?? expiries[0];

  const maxCall = useMemo(() => (cur ? maxOiIdx(cur.strikes ?? [], "call") : -1), [cur]);
  const maxPut = useMemo(() => (cur ? maxOiIdx(cur.strikes ?? [], "put") : -1), [cur]);

  const rows = useMemo(() => {
    if (!cur) return [];
    return sliceChain(cur.strikes ?? [], cur.atm, showAll);
  }, [cur, showAll]);
  const oiMax = useMemo(() => maxOiVal(rows), [rows]);

  const fwd = num(cur?.forward);
  const fwdYd = num(cur?.forwardYd);
  const fwdChg = fwd !== null && fwdYd !== null && fwdYd !== 0 ? ((fwd - fwdYd) / fwdYd) * 100 : null;
  const atmIvChg = cur?.atmIv != null && cur?.atmIvYd != null ? cur.atmIv - cur.atmIvYd : null;
  const skew = useMemo(() => (cur ? ivSkew(cur.strikes ?? [], fwd) : null), [cur, fwd]);
  const move = fmtMove(cur?.moveUp, cur?.moveDn);
  const hidden = cur ? Math.max(0, (cur.strikes?.length ?? 0) - rows.length) : 0;

  const emitPick = (code: string | undefined) => {
    if (!code || !onPickContract) return;
    onPickContract({ code, und: cur?.und ?? "", name: optionName(code) });
  };

  useEffect(() => {
    if (!cur?.strikes?.length || !onPickContract) return;
    const inChain = cur.strikes.some((s) => s.callCode === pick?.code || s.putCode === pick?.code);
    if (inChain) return;
    const atm = cur.strikes.find((s) => s.strike === cur.atm) ?? cur.strikes[cur.strikes.length >> 1];
    if (!atm?.callCode) return;
    onPickContract({ code: atm.callCode, und: cur.und ?? "", name: optionName(atm.callCode) });
  }, [prod, cur?.exp, cur?.und, pick?.code, onPickContract]);

  const atmRowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    atmRowRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [prod, cur?.exp, showAll]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-1.5 pt-1">
        <select
          value={prod}
          onChange={(e) => onProduct?.(e.target.value)}
          className="h-6 max-w-[8.5rem] shrink-0 rounded border border-slate-700/60 bg-slate-900 px-1.5 text-[11px] text-slate-200 outline-none"
          title="品种"
        >
          {products.map((p) => (
            <option key={p.code} value={p.code}>{p.alias} {p.code}</option>
          ))}
        </select>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {expiries.map((e) => (
            <button
              key={e.exp}
              type="button"
              onClick={() => setExp(e.exp)}
              className={cn(
                "h-6 shrink-0 rounded px-1.5 text-[11px] tabular-nums transition-colors",
                cur?.exp === e.exp
                  ? "bg-cyan-500/20 text-cyan-300"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
              )}
              title={`到期日 ${e.expiryDate ?? "-"}`}
            >
              {e.exp.slice(2)} · {e.dte ?? "-"}天
            </button>
          ))}
        </div>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="h-6 shrink-0 rounded px-1.5 text-[11px] text-slate-500 hover:text-slate-300"
            title="显示全部行权价"
          >
            全部+{hidden}
          </button>
        )}
        {showAll && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="h-6 shrink-0 rounded px-1.5 text-[11px] text-cyan-400/80 hover:text-cyan-300"
          >
            ATM附近
          </button>
        )}
        {cur?.lastTime && (
          <span className="shrink-0 text-[10px] tabular-nums text-slate-600">{cur.lastTime.slice(5, 16)}</span>
        )}
      </div>

      {cur && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 px-1.5 py-1 text-[11px] tabular-nums text-slate-400">
          <span>
            远期 <span className="text-slate-300">{fwd !== null ? fmtPrice(fwd) : "-"}</span>
            {fwdChg !== null && (
              <span className={cn("ml-0.5", fwdChg > 0 ? "text-red-400" : fwdChg < 0 ? "text-emerald-400" : "")}>
                {fmtPct(fwdChg, 2)}
              </span>
            )}
          </span>
          <span>
            ATM隐波 <span className="text-violet-300">{cur.atmIv?.toFixed(1) ?? "-"}</span>
            {atmIvChg !== null && (
              <span className={cn("ml-0.5", atmIvChg > 0 ? "text-red-400" : atmIvChg < 0 ? "text-emerald-400" : "")}>
                {atmIvChg > 0 ? "+" : ""}{atmIvChg.toFixed(1)}
              </span>
            )}
          </span>
          <span title="Put/Call 持仓比">
            PCR <span className="text-slate-300">{cur.pcr?.toFixed(2) ?? "-"}</span>
          </span>
          <span title="购/沽总持仓">
            持仓 <span className="text-slate-300">{fmtOi(cur.sumOiCall)}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-300">{fmtOi(cur.sumOiPut)}</span>
          </span>
          {skew !== null && (
            <span title="虚值沽IV - 虚值购IV, 正=沽更贵">
              偏度 <span className={cn(skew > 0.5 ? "text-amber-300" : skew < -0.5 ? "text-sky-300" : "text-slate-300")}>
                {skew > 0 ? "沽+" : skew < 0 ? "购+" : ""}{Math.abs(skew).toFixed(1)}
              </span>
            </span>
          )}
          {move && <span>预期 <span className="text-slate-300">{move}</span></span>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="flex h-full items-center justify-center text-[11px] text-slate-500">更新中…</div>
        )}
        {!loading && !cur && <CellEmpty text={tq.error ? "未取到" : "暂无数据"} />}
        {cur && (
          <table className="data-table dense text-[11px]">
            <thead>
              <tr>
                <th colSpan={4} className="text-center text-[12px] font-semibold text-red-300">购 Call</th>
                <th rowSpan={2} className="text-center align-middle font-semibold text-slate-200">行权价</th>
                <th colSpan={4} className="text-center text-[12px] font-semibold text-emerald-300">沽 Put</th>
              </tr>
              <tr>
                <th className="num !top-5 font-semibold text-slate-200">IV</th>
                <th className="num !top-5 font-semibold text-slate-200">Delta</th>
                <th className="num !top-5 font-semibold text-slate-200">持仓</th>
                <th className="num !top-5 font-semibold text-slate-200">最新价</th>
                <th className="!top-5 font-semibold text-slate-200">最新价</th>
                <th className="!top-5 font-semibold text-slate-200">持仓</th>
                <th className="!top-5 font-semibold text-slate-200">Delta</th>
                <th className="!top-5 font-semibold text-slate-200">IV</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const isAtm = s.strike === cur.atm;
                const callItm = fwd !== null && s.strike < fwd;
                const putItm = fwd !== null && s.strike > fwd;
                const fullIdx = (cur.strikes ?? []).findIndex((x) => x.strike === s.strike);
                const mny = fwd !== null && fwd !== 0 ? ((s.strike / fwd) - 1) * 100 : null;
                return (
                  <tr key={s.strike} ref={isAtm ? atmRowRef : undefined} className={cn(isAtm && "bg-cyan-500/10")}>
                    <SideCells
                      s={s.call}
                      itm={callItm}
                      side="call"
                      selected={pick?.code != null && pick.code === s.callCode}
                      maxOi={fullIdx === maxCall && maxCall >= 0}
                      oiMax={oiMax}
                      atmIv={cur.atmIv}
                      onPick={s.callCode && onPickContract ? () => emitPick(s.callCode) : undefined}
                    />
                    <td
                      className={cn(
                        "text-center text-[12px] font-medium tabular-nums",
                        isAtm ? "text-cyan-300" : "text-slate-200",
                      )}
                      title={mny !== null ? `相对远期 ${fmtPct(mny, 2)}` : undefined}
                    >
                      {fmtStrike(s.strike)}
                      {isAtm && <span className="ml-0.5 text-[9px] text-cyan-500/80">ATM</span>}
                    </td>
                    <SideCells
                      s={s.put}
                      itm={putItm}
                      side="put"
                      selected={pick?.code != null && pick.code === s.putCode}
                      maxOi={fullIdx === maxPut && maxPut >= 0}
                      oiMax={oiMax}
                      atmIv={cur.atmIv}
                      onPick={s.putCode && onPickContract ? () => emitPick(s.putCode) : undefined}
                    />
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
