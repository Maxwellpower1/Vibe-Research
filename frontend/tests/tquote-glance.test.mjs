import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WINDOW = 8;
const OI_PAD = 12;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ivOf(s) {
  const b = num(s.ivBid);
  const a = num(s.ivAsk);
  if (b !== null && a !== null) return (b + a) / 2;
  return num(s.theoIv);
}

function sliceChain(strikes, atm, all = false) {
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

function maxOiVal(strikes) {
  let m = 0;
  for (const s of strikes) {
    const c = num(s.call.oi);
    const p = num(s.put.oi);
    if (c !== null && c > m) m = c;
    if (p !== null && p > m) m = p;
  }
  return m;
}

function ivSkew(strikes, fwd) {
  if (fwd === null || strikes.length === 0) return null;
  const below = [...strikes].reverse().find((s) => s.strike < fwd);
  const above = strikes.find((s) => s.strike > fwd);
  const putIv = below ? ivOf(below.put) : null;
  const callIv = above ? ivOf(above.call) : null;
  if (putIv === null || callIv === null) return null;
  return putIv - callIv;
}

function mk(strike, callOi = 0, putOi = 0, callIv = 20, putIv = 20) {
  return {
    strike,
    call: { oi: callOi, theoIv: callIv },
    put: { oi: putOi, theoIv: putIv },
  };
}

test("sliceChain ATM 附近 8 档, 近处最大持仓扩窗", () => {
  const strikes = [];
  for (let k = 100; k <= 200; k += 5) strikes.push(mk(k, k === 160 ? 9000 : 10, k === 145 ? 8000 : 10));
  const atm = 150;
  const rows = sliceChain(strikes, atm, false);
  assert.ok(rows[0].strike <= 145, "沽最大仓 145 应带上");
  assert.ok(rows[rows.length - 1].strike >= 160, "购最大仓 160 应带上");
  assert.ok(rows.length < strikes.length, "仍不是全链");
});

test("sliceChain 全部=true 原样返回", () => {
  const strikes = [mk(1), mk(2), mk(3)];
  assert.equal(sliceChain(strikes, 2, true).length, 3);
});

test("ivSkew 沽虚值更贵为正", () => {
  const strikes = [mk(90, 0, 0, 18, 22), mk(100, 0, 0, 20, 20), mk(110, 0, 0, 19, 18)];
  const skew = ivSkew(strikes, 100);
  // below 90 put IV 22, above 110 call IV 19 -> 22-19=3
  assert.equal(skew, 3);
});

test("TQuotePanel 仍导出 sliceChain / 自动 ATM 购", async () => {
  const src = await readFile(new URL("../src/components/deriv/TQuotePanel.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("export function sliceChain"), "sliceChain 需导出供对照");
  assert.ok(src.includes("atm.callCode"), "换月后应自动点 ATM 购");
  assert.ok(src.includes("购 Call"), "表头分组购/沽");
  assert.ok(src.includes('colSpan={4} className="text-center text-[12px] font-semibold text-red-300">购 Call'), "购 Call 居中");
  assert.ok(src.includes('colSpan={4} className="text-center text-[12px] font-semibold text-emerald-300">沽 Put'), "沽 Put 居中");
  assert.ok(src.includes(">Delta</th>"), "表头 Delta 不用 Δ");
  assert.ok(src.includes("最新价"), "价列改称最新价");
  const hd = src.slice(src.indexOf("num !top-5"), src.lastIndexOf(">IV</th>") + 8);
  assert.ok(/IV[\s\S]+Delta[\s\S]+持仓[\s\S]+最新价[\s\S]+最新价[\s\S]+持仓[\s\S]+Delta[\s\S]+IV/.test(hd), "最新价贴行权价两侧");
  assert.ok(src.includes("function OiBar"), "持仓用横向柱");
  assert.ok(src.includes("export function maxOiVal"), "横条标尺按可见档最大仓");
});

test("maxOiVal 取购沽两侧最大值", () => {
  const strikes = [mk(90, 100, 50), mk(100, 20, 800), mk(110, 40, 10)];
  assert.equal(maxOiVal(strikes), 800);
});
