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

test("连续成交: 2秒额, 下限=默认 5万", () => {
  const t = { ...DEFAULT, on: { ...DEFAULT.on } };
  const a = (over) => ({ rule_id: "r003_repeated_aggressive_burst", ...over });
  assert.equal(passesThresh(a({ window_premium: 50_000 }), t), true);
  assert.equal(passesThresh(a({ window_premium: 49_999 }), t), false);
  t.on.r003 = false;
  assert.equal(passesThresh(a({ window_premium: 1e9 }), t), false);
  assert.equal(clampThresh({ ...DEFAULT, burstPrem: 1 }).burstPrem, 50_000);
});
