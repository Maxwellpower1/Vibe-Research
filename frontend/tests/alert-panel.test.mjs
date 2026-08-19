import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FLOOR = { lots: 50, tradePrem: 10_000, pct: 0, movePrem: 1_000, burstPrem: 50_000 };
const DEFAULT = {
  on: { r001: true, r002: true, r003: true },
  lots: 100, tradePrem: 100_000, pct: 20, movePrem: 10_000, burstPrem: 50_000,
};

function clampThresh(t) {
  const n = (v, floor) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.max(floor, x) : floor;
  };
  return {
    on: { r001: t.on?.r001 !== false, r002: t.on?.r002 !== false, r003: t.on?.r003 !== false },
    lots: n(t.lots, FLOOR.lots),
    tradePrem: n(t.tradePrem, FLOOR.tradePrem),
    pct: n(t.pct, FLOOR.pct),
    movePrem: n(t.movePrem, FLOOR.movePrem),
    burstPrem: n(t.burstPrem, FLOOR.burstPrem),
  };
}

function intervalPct(a) {
  const p = Number(String(a.pct_change ?? "").replace("%", ""));
  return Number.isFinite(p) ? p : null;
}

function passesThresh(a, t) {
  const rid = String(a.rule_id ?? "");
  const f = clampThresh(t);
  const vol = Number(a.window_volume) || 0;
  const prem = Number(a.window_premium) || 0;
  if (rid === "r001_single_trade") {
    if (!f.on.r001) return false;
    return prem >= f.tradePrem || vol >= f.lots;
  }
  if (rid === "r002_1m_pct_move") {
    if (!f.on.r002) return false;
    return Math.abs(intervalPct(a) ?? 0) >= f.pct && prem >= f.movePrem;
  }
  if (rid === "r003_repeated_aggressive_burst") {
    if (!f.on.r003) return false;
    return prem >= f.burstPrem;
  }
  return false;
}

test("异动卡对齐 OpenVlab option-flow: 三类可关 + 额/量阈值", async () => {
  const src = await readFile(new URL("../src/components/deriv/AlertPanel.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("r001_single_trade: \"成交异动\""), "成交异动");
  assert.ok(src.includes("成交异动⬆"), "成交异动上");
  assert.ok(src.includes("成交异动⬇"), "成交异动下");
  assert.ok(src.includes("text-red-400"), "上红");
  assert.ok(src.includes("text-emerald-400"), "下绿");
  assert.ok(src.includes("r002_1m_pct_move: \"走势异动\""), "走势异动");
  assert.ok(src.includes("r003_repeated_aggressive_burst: \"连续成交\""), "连续成交");
  assert.ok(src.includes('title="区间成交量"'), "区间成交量列");
  assert.ok(src.includes("deriv.alertThresh"), "阈值本机存储");
  assert.ok(src.includes("THRESH_VER = 2"), "新阈值结构");
  assert.ok(src.includes("tradePrem"), "成交异动筛额");
  assert.ok(src.includes("movePrem"), "走势异动筛额");
  assert.ok(src.includes("burstPrem"), "连续成交筛额");
  assert.ok(src.includes("type=\"checkbox\""), "三类可勾选");
  assert.ok(src.includes('label="成交异动"'), "成交开关在阈值里");
  assert.ok(src.includes('label="走势异动"'), "走势开关在阈值里");
  assert.ok(src.includes('label="连续成交"'), "连续开关在阈值里");
  assert.ok(!src.includes(">成交</button>"), "顶栏不再单独切成交");
  assert.ok(!src.includes(">走势</button>"), "顶栏不再单独切走势");
  assert.ok(!src.includes(">连续</button>"), "顶栏不再单独切连续");
  assert.ok(src.includes("未勾选类型"), "全关空态");
  assert.doesNotMatch(src, /r002_volume_surge|r003_oi_surge|单笔异动/);
});

test("异动卡 MQTT 实时 overlay: REST seed + 本机 mqtt 状态, 不另开 market 轮询", async () => {
  const hook = await readFile(new URL("../src/hooks/useDerivData.ts", import.meta.url), "utf8");
  const panel = await readFile(new URL("../src/components/deriv/AlertPanel.tsx", import.meta.url), "utf8");
  const apiSrc = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  assert.ok(hook.includes("api.ovlabMqtt(pinKey ? pinKey.split(\",\") : undefined)"), "驾驶舱读 MQTT 状态");
  assert.ok(hook.includes("2_000"), "异动 MQTT 2s 读内存");
  assert.ok(hook.includes("mergeFlowAlerts"), "REST seed + MQTT 合并");
  assert.ok(hook.includes("mergeMarketRows"), "ctamap 叠行情观察");
  assert.ok(hook.includes("ticksByInstr"), "dataview 按合约");
  assert.equal(hook.split("api.ovlabMarket()").length - 1, 1, "仍只有一条 market 轮询");
  assert.ok(panel.includes("已连接"), "异动卡 MQTT 已连接");
  assert.ok(panel.includes("text-emerald-400"), "已连接绿色");
  assert.ok(panel.includes("MQTT未连"), "异动卡 MQTT 未连");
  assert.ok(panel.includes("MQTT关"), "异动卡 MQTT 关");
  assert.ok(apiSrc.includes("ovlabMqtt:"), "api 挂 /ovlab/mqtt");
  assert.ok(apiSrc.includes("?pin="), "mqtt pin 查询串");
});

function mergeFlowAlerts(rest, live) {
  if (!live?.length) return rest;
  if (!rest?.length) return live;
  const map = new Map();
  const key = (a) => `${a.contract_code ?? ""}|${a.time ?? ""}|${a.rule_id ?? ""}`;
  for (const a of rest) map.set(key(a), a);
  for (const a of live) map.set(key(a), a);
  return [...map.values()].sort((a, b) => String(b.time ?? "").localeCompare(String(a.time ?? "")));
}

test("异动合并: MQTT 同键覆盖, 按时间新到旧", () => {
  const rest = [
    { contract_code: "A", time: "2026-08-18 10:00:00", rule_id: "r001_single_trade", window_volume: 1 },
    { contract_code: "B", time: "2026-08-18 10:01:00", rule_id: "r001_single_trade", window_volume: 2 },
  ];
  const live = [
    { contract_code: "A", time: "2026-08-18 10:00:00", rule_id: "r001_single_trade", window_volume: 9 },
    { contract_code: "C", time: "2026-08-18 10:02:00", rule_id: "r002_1m_pct_move", window_volume: 3 },
  ];
  const out = mergeFlowAlerts(rest, live);
  assert.equal(out.length, 3);
  assert.equal(out[0].contract_code, "C");
  assert.equal(out.find((a) => a.contract_code === "A").window_volume, 9);
});

const MARKET_LIVE = [
  "price", "ctn", "atmv_current", "atmv_1dchg", "atmv_percentile",
  "carry", "skew_current", "skew_1dchg", "last_time", "exp",
];

function overlayMarket(rest, live) {
  const out = { ...rest };
  for (const k of MARKET_LIVE) {
    const v = live[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

function mergeMarketRows(rest, live) {
  if (!rest) return rest;
  if (!live?.length) return rest;
  const byProduct = new Map();
  const byUnd = new Map();
  for (const r of live) {
    const p = String(r.product ?? "").trim().toUpperCase();
    const u = String(r.prodUnd ?? r.product_und ?? "").trim().toUpperCase();
    if (p) byProduct.set(p, r);
    if (u) byUnd.set(u, r);
  }
  return rest.map((r) => {
    const p = String(r.product ?? "").trim().toUpperCase();
    const u = String(r.prodUnd ?? "").trim().toUpperCase();
    const tick = (p && byProduct.get(p)) || (u && byUnd.get(u));
    return tick ? overlayMarket(r, tick) : r;
  });
}

function ticksByInstr(list) {
  const m = {};
  for (const t of list ?? []) {
    const k = String(t.instr ?? "").trim().toUpperCase();
    if (k) m[k] = t;
  }
  return m;
}

test("行情观察: ctamap 叠价, 不增 MQTT 独有品种", () => {
  const rest = [
    { product: "AL", prodUnd: "AL", product_alias: "沪铝", price: 18000, ctn: 0.01 },
    { product: "CU", prodUnd: "CU", product_alias: "沪铜", price: 70000, ctn: 0 },
  ];
  const live = [
    { prodUnd: "al", price: 18510, ctn: 0.02 },
    { product: "ZN", price: 1 },
  ];
  const out = mergeMarketRows(rest, live);
  assert.equal(out.length, 2);
  assert.equal(out[0].price, 18510);
  assert.equal(out[0].product_alias, "沪铝");
  assert.equal(out[1].price, 70000);
  assert.equal(mergeMarketRows(null, live), null);
});

test("dataview ticks 按合约大写", () => {
  const m = ticksByInstr([{ instr: "al2609", last: 18510, oi: 12 }]);
  assert.equal(m.AL2609.last, 18510);
  assert.equal(m.al2609, undefined);
});

function tickFresh(tick, nowSec, live = true) {
  const last = Number(tick?.last);
  if (!Number.isFinite(last)) return false;
  if (!live) return true;
  const at = Number(tick?.at);
  if (!Number.isFinite(at)) return false;
  return nowSec - at <= 8;
}
function undOfRow(r) {
  const u = String(r.prodUnd ?? "").trim();
  if (u) return u;
  const p = String(r.product ?? "").trim();
  const catalog = { AG_O: "AG", AU_O: "AU" };
  return catalog[p] || (p.endsWith("_O") ? p.slice(0, -2) : p);
}
function contractCode(r) {
  const und = undOfRow(r);
  if (!und) return "";
  const tail = String(r.exp ?? "").trim().slice(-4);
  return /^\d+$/.test(und) ? und : (und && tail ? `${und}${tail}` : "");
}
function findRowByUnd(rows, prod) {
  const want = prod.trim().toUpperCase();
  if (!want) return undefined;
  return (rows ?? []).find((r) => {
    const u = undOfRow(r).toUpperCase();
    return u === want || String(r.product ?? "").trim().toUpperCase() === want;
  });
}
function undSpotLast(code, ticks, rows, nowSec, live = true) {
  const want = code.trim().toUpperCase();
  for (const r of rows ?? []) {
    if (contractCode(r).toUpperCase() === want) {
      const px = Number(r.price);
      if (Number.isFinite(px)) return px;
    }
  }
  const tick = ticks[want];
  if (tickFresh(tick, nowSec, live)) return Number(tick.last);
  return null;
}

test("主力图优先行情观察价, 不看停住的 dataview", () => {
  const now = 1_000_000;
  const rows = [{ prodUnd: "AG", exp: "202609", price: 10120 }];
  const stale = { AG2609: { instr: "ag2609", last: 9900, at: now - 30 } };
  assert.equal(undSpotLast("AG2609", stale, rows, now, true), 10120);
  const fresh = { AG2609: { instr: "ag2609", last: 10111, at: now - 1 } };
  assert.equal(undSpotLast("AG2609", fresh, rows, now, true), 10120);
  assert.equal(tickFresh({ last: 1 }, now, true), false);
});

test("AG_O / AU_O 空 prodUnd 仍拼出主力码叠价", () => {
  const now = 1_000_000;
  const ag = [{ product: "AG_O", prodUnd: "", exp: "202609", price: 16057 }];
  const au = [{ product: "AU_O", prodUnd: "", exp: "202609", price: 970.38 }];
  assert.equal(contractCode(ag[0]), "AG2609");
  assert.equal(undSpotLast("AG2609", {}, ag, now, true), 16057);
  assert.equal(contractCode(au[0]), "AU2609");
  assert.equal(undSpotLast("AU2609", {}, au, now, true), 970.38);
  assert.equal(findRowByUnd(ag, "AG")?.product, "AG_O");
  assert.equal(findRowByUnd(au, "AU_O")?.product, "AU_O");
});

test("成交异动: 额或量, 可关", () => {
  const t = { ...DEFAULT, on: { ...DEFAULT.on } };
  const a = (over) => ({ rule_id: "r001_single_trade", ...over });
  assert.equal(passesThresh(a({ window_volume: 100, window_premium: 0 }), t), true);
  assert.equal(passesThresh(a({ window_volume: 0, window_premium: 100_000 }), t), true);
  assert.equal(passesThresh(a({ window_volume: 99, window_premium: 99_999 }), t), false);
  t.on.r001 = false;
  assert.equal(passesThresh(a({ window_volume: 999, window_premium: 1e9 }), t), false);
  const floor = clampThresh({ ...DEFAULT, lots: 10, tradePrem: 1 });
  assert.equal(floor.lots, 50);
  assert.equal(floor.tradePrem, 10_000);
});

test("走势异动: 涨幅且成交额", () => {
  const t = { ...DEFAULT, on: { ...DEFAULT.on } };
  const a = (over) => ({ rule_id: "r002_1m_pct_move", ...over });
  assert.equal(passesThresh(a({ pct_change: "20", window_premium: 10_000 }), t), true);
  assert.equal(passesThresh(a({ pct_change: "-20", window_premium: 10_000 }), t), true);
  assert.equal(passesThresh(a({ pct_change: "20", window_premium: 9_999 }), t), false);
  assert.equal(passesThresh(a({ pct_change: "19", window_premium: 1e9 }), t), false);
  t.on.r002 = false;
  assert.equal(passesThresh(a({ pct_change: "50", window_premium: 1e9 }), t), false);
  assert.equal(clampThresh({ ...DEFAULT, movePrem: 1 }).movePrem, 1_000);
});

function tradeSide(a) {
  const s = String(a.side ?? "").toLowerCase();
  if (s === "ask" || s === "buy" || s === "b") return 1;
  if (s === "bid" || s === "sell" || s === "s") return -1;
  const ft = String(a.fill_type ?? "").toLowerCase();
  if (ft.includes("ascend")) return 1;
  if (ft.includes("descend")) return -1;
  const p = intervalPct(a);
  if (p != null && p > 0) return 1;
  if (p != null && p < 0) return -1;
  return 0;
}

function ruleLabelOf(a) {
  const rid = String(a.rule_id ?? "");
  const base = { r001_single_trade: "成交异动", r002_1m_pct_move: "走势异动", r003_repeated_aggressive_burst: "连续成交" }[rid] ?? rid;
  if (rid !== "r001_single_trade") return base;
  const d = tradeSide(a);
  if (d > 0) return "成交异动⬆";
  if (d < 0) return "成交异动⬇";
  return base;
}

test("成交异动: ask 红上 bid 绿下, 不看区间涨幅", () => {
  assert.equal(ruleLabelOf({ rule_id: "r001_single_trade", side: "ask", pct_change: "0.00%" }), "成交异动⬆");
  assert.equal(ruleLabelOf({ rule_id: "r001_single_trade", side: "bid", pct_change: "0.00%" }), "成交异动⬇");
  assert.equal(ruleLabelOf({ rule_id: "r001_single_trade", side: "mid" }), "成交异动");
  assert.equal(ruleLabelOf({ rule_id: "r001_single_trade", fill_type: "ascending_fill" }), "成交异动⬆");
  assert.equal(ruleLabelOf({ rule_id: "r002_1m_pct_move", side: "ask" }), "走势异动");
});

test("连续成交: 2秒额, 下限=默认 5万", () => {
  const t = { ...DEFAULT, on: { ...DEFAULT.on } };
  const a = (over) => ({ rule_id: "r003_repeated_aggressive_burst", ...over });
  assert.equal(passesThresh(a({ window_premium: 50_000 }), t), true);
  assert.equal(passesThresh(a({ window_premium: 49_999 }), t), false);
  t.on.r003 = false;
  assert.equal(passesThresh(a({ window_premium: 1e9 }), t), false);
  assert.equal(clampThresh({ ...DEFAULT, burstPrem: 1 }).burstPrem, 50_000);
});
