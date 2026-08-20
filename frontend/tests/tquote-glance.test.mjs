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

function hideItmSide(side, strike, fwd, keep, hide) {
  if (!hide || fwd === null) return false;
  const kept = keep == null ? [] : typeof keep === "number" ? [keep] : keep;
  if (kept.includes(strike)) return false;
  return side === "call" ? strike < fwd : strike > fwd;
}

function undBracket(strikes, px) {
  if (px == null || !Number.isFinite(px) || strikes.length < 2) return null;
  const ks = [...new Set(strikes)].sort((a, b) => a - b);
  let lo = null;
  let hi = null;
  for (const k of ks) {
    if (k <= px) lo = k;
    if (k >= px && hi == null) hi = k;
  }
  if (lo == null || hi == null) return null;
  if (lo !== hi) return { lo, hi };
  const i = ks.indexOf(lo);
  if (i >= 0 && i + 1 < ks.length) return { lo: ks[i], hi: ks[i + 1] };
  if (i > 0) return { lo: ks[i - 1], hi: ks[i] };
  return null;
}

test("ivSkew 沽虚值更贵为正", () => {
  const strikes = [mk(90, 0, 0, 18, 22), mk(100, 0, 0, 20, 20), mk(110, 0, 0, 19, 18)];
  const skew = ivSkew(strikes, 100);
  // below 90 put IV 22, above 110 call IV 19 -> 22-19=3
  assert.equal(skew, 3);
});

function smilePoints(strikes, fwd, keep, hide) {
  const call = [];
  const put = [];
  for (const s of strikes) {
    if (!hideItmSide("call", s.strike, fwd, keep, hide)) {
      const v = ivOf(s.call);
      if (v != null) call.push({ time: s.strike, value: v });
    }
    if (!hideItmSide("put", s.strike, fwd, keep, hide)) {
      const v = ivOf(s.put);
      if (v != null) put.push({ time: s.strike, value: v });
    }
  }
  call.sort((a, b) => a.time - b.time);
  put.sort((a, b) => a.time - b.time);
  return { call, put };
}

test("smilePoints 跟隐藏实值同一套档, 横轴是行权价", () => {
  const strikes = [mk(90, 0, 0, 22, 24), mk(100, 0, 0, 20, 20), mk(110, 0, 0, 21, 18)];
  const all = smilePoints(strikes, 100, 100, false);
  assert.deepEqual(all.call.map((p) => p.time), [90, 100, 110]);
  assert.equal(all.call[0].value, 22);
  const otm = smilePoints(strikes, 100, 100, true);
  assert.deepEqual(otm.call.map((p) => p.time), [100, 110]);
  assert.deepEqual(otm.put.map((p) => p.time), [90, 100]);
});

test("TQuotePanel 默认全部档位 / 自动 ATM 购", async () => {
  const src = await readFile(new URL("../src/components/deriv/TQuotePanel.tsx", import.meta.url), "utf8");
  assert.ok(!src.includes("sliceChain"), "不再切 ATM 附近窗");
  assert.ok(!src.includes("ATM附近"), "不再切换 ATM 附近");
  assert.ok(!src.includes("setShowAll"), "无全部/附近切换");
  assert.ok(src.includes("atm.callCode"), "换月后当前期权不在链上才 ATM 购");
  assert.ok(src.includes('pick?.kind === "und"'), "主力期货图不被 ATM 购覆盖");
  assert.ok(src.includes("undOfRow(r)"), "空 prodUnd 仍能进品种下拉");
  assert.ok(src.includes("findRowByUnd"), "ETF 回落对应当前品种, 不新开轮询");
  assert.ok(src.includes('kind: "option"'), "T 表点合约 kind=option");
  assert.ok(src.includes('useState<"asc" | "desc">("desc")'), "行权价默认降序");
  assert.ok(src.includes('label="行权价"'), "点行权价列头排序");
  assert.ok(src.includes("b.strike - a.strike"), "降序高档在上");
  assert.ok(src.includes("看涨期权Call"), "表头看涨期权Call");
  assert.ok(src.includes('colSpan={4} className="text-center text-[12px] font-semibold text-red-400">看涨期权Call'), "看涨期权Call 红字居中");
  assert.ok(src.includes('colSpan={4} className="text-center text-[12px] font-semibold text-emerald-400">看跌期权Put'), "看跌期权Put 绿字居中");
  assert.ok(src.includes(">Delta</th>"), "表头 Delta 不用 Δ");
  assert.ok(src.includes("相对昨理论价"), "价旁标涨幅");
  assert.ok(src.includes("s.pct"), "涨幅用 tquote pct, 不另轮询");
  const hd = src.slice(src.indexOf("num !top-5"), src.lastIndexOf(">IV</th>") + 8);
  assert.ok(/IV[\s\S]+Delta[\s\S]+持仓[\s\S]+最新价[\s\S]+最新价[\s\S]+持仓[\s\S]+Delta[\s\S]+IV/.test(hd), "最新价贴行权价两侧");
  assert.ok(src.includes("function OiBar"), "持仓用横向柱");
  assert.ok(src.includes("export function maxOiVal"), "横条标尺按可见档最大仓");
  assert.ok(src.includes("undPx"), "顶栏标的最新价");
  assert.ok(src.includes("tickLast ?? mktPx ?? futLast"), "新鲜 tick, 再主力 ctamap, 再当月 futPx");
  assert.ok(src.includes("tickFresh"), "陈旧 dataview 不盖顶栏");
  assert.ok(src.includes("<CtnText value={undCtn}"), "涨跌跟当月期货, ETF 回落行情观察");
  assert.ok(src.includes("mainCode === undCode"), "只有当月=主力才叠行情观察价");
  assert.ok(src.includes("d.ticks[undCode]"), "dataview 叠当月期货 last");
  assert.ok(src.includes('kind: "und"') && src.includes("cur.und"), "点顶栏期货价出标的图");
  assert.ok(src.includes("ProdSearchSelect"), "品种下拉可搜索");
  assert.ok(!/<select[\s\S]*品种/.test(src), "不再用原生 select 选品种");
  assert.ok(src.includes("更新 {cur.lastTime.slice(11, 19)"), "更新时间带标签且到秒");
  assert.ok(src.includes("隐藏实值"), "顶栏有隐藏实值开关");
  assert.ok(src.includes("deriv.tquote.hideItm"), "开关记本机");
  assert.ok(src.includes('storageGet("deriv.tquote.hideItm") !== "0"'), "未记过本机则默认隐藏实值");
  assert.ok(src.includes("hideItmSide"), "实值侧用 hideItmSide");
  assert.ok(src.includes("undBracket"), "现价卡在相邻两档");
  assert.ok(src.includes("SpotUndRow"), "两档之间插蓝线行");
  assert.ok(src.includes("bg-blue-500"), "蓝线横穿");
  assert.ok(src.includes("spot-und"), "现价行可识别");
  assert.ok(!src.includes("isAtm"), "不再把某一档标成 ATM");
  assert.ok(!src.includes(">ATM</span>"), "行权价旁不写 ATM 字母");
  assert.ok(!src.includes("lastTime.slice(5, 16)"), "不再截成月日暗字");
  assert.ok(src.includes("IvSmileChart"), "T 表上挂 IV 微笑");
  assert.ok(src.includes("expiry: cur?.expiryDate") || src.includes("expiry: cur.expiryDate"), "点合约带到期日给 markers");
});

test("undBracket 现价夹在相邻两档, 贴档用本档与更高档", () => {
  assert.deepEqual(undBracket([90, 100, 110], 105), { lo: 100, hi: 110 });
  assert.deepEqual(undBracket([90, 100, 110], 100), { lo: 100, hi: 110 });
  assert.deepEqual(undBracket([90, 100, 110], 90), { lo: 90, hi: 100 });
  assert.equal(undBracket([90, 100, 110], 80), null);
  assert.equal(undBracket([90, 100, 110], 120), null);
  assert.equal(undBracket([100], 100), null);
  assert.equal(undBracket([90, 100], null), null);
});

test("hideItmSide 藏实值侧, 夹档两边都留", () => {
  assert.equal(hideItmSide("call", 90, 100, 100, true), true);
  assert.equal(hideItmSide("put", 90, 100, 100, true), false);
  assert.equal(hideItmSide("put", 110, 100, 100, true), true);
  assert.equal(hideItmSide("call", 110, 100, 100, true), false);
  assert.equal(hideItmSide("call", 100, 100, 100, true), false);
  assert.equal(hideItmSide("put", 100, 100, 100, true), false);
  assert.equal(hideItmSide("call", 90, 100, 100, false), false);
  assert.equal(hideItmSide("call", 90, null, 100, true), false);
  assert.equal(hideItmSide("call", 90, 105, [100, 110], true), true);
  assert.equal(hideItmSide("put", 110, 105, [100, 110], true), false);
  assert.equal(hideItmSide("call", 100, 105, [100, 110], true), false);
});

test("maxOiVal 取购沽两侧最大值", () => {
  const strikes = [mk(90, 100, 50), mk(100, 20, 800), mk(110, 40, 10)];
  assert.equal(maxOiVal(strikes), 800);
});
