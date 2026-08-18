import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("ivSkew 沽虚值更贵为正", () => {
  const strikes = [mk(90, 0, 0, 18, 22), mk(100, 0, 0, 20, 20), mk(110, 0, 0, 19, 18)];
  const skew = ivSkew(strikes, 100);
  // below 90 put IV 22, above 110 call IV 19 -> 22-19=3
  assert.equal(skew, 3);
});

test("TQuotePanel 默认全部档位 / 自动 ATM 购", async () => {
  const src = await readFile(new URL("../src/components/deriv/TQuotePanel.tsx", import.meta.url), "utf8");
  assert.ok(!src.includes("sliceChain"), "不再切 ATM 附近窗");
  assert.ok(!src.includes("ATM附近"), "不再切换 ATM 附近");
  assert.ok(!src.includes("setShowAll"), "无全部/附近切换");
  assert.ok(src.includes("atm.callCode"), "换月后应自动点 ATM 购");
  assert.ok(src.includes("(cur.strikes ?? []).slice().reverse()"), "行权价展示降序且全链");
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
