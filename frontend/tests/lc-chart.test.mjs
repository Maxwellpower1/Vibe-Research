import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/lib/lcChart.ts"), "utf8");

test("lcChart 是 K/分时共用封装, 不画 TradingView logo", () => {
  assert.match(src, /from "lightweight-charts"/);
  assert.match(src, /createChart/);
  assert.match(src, /attributionLogo: false/);
  assert.match(src, /LC_ORIGIN/);
  assert.match(src, /BaselineSeries/);
  assert.match(src, /CandlestickSeries/);
  assert.match(src, /export function useLcChart/);
  assert.match(src, /export function wipeLc/);
  assert.match(src, /styleVolOverlay/);
  assert.match(src, /MagnetOHLC/);
  assert.match(src, /"desk" \| "glance"/);
  assert.match(src, /rightPriceScale:/);
  assert.match(src, /visible: true/);
  assert.match(src, /ticksVisible: true/);
  assert.match(src, /lastValueVisible: true/);
  assert.match(src, /styleLastTag/);
  assert.doesNotMatch(src, /visible: !glance/);
  assert.match(src, /export function showSession/);
  assert.match(src, /fixRightEdge: mode === "mdhm"/);
  assert.match(src, /shiftVisibleRangeOnNewBar: false/);
  assert.match(src, /doNotSnapToHiddenSeriesIndices: true/);
  assert.match(src, /rightOffsetPixels/);
  assert.match(src, /export function pxPrec/);
  assert.match(src, /export function setRefPriceLine/);
  assert.match(src, /createPriceLine/);
  assert.match(src, /export function setSeriesMarks/);
  assert.match(src, /export function canUpdateLast/);
  assert.match(src, /export function paintCandles/);
  assert.match(src, /series\.update/);
  assert.match(src, /LC update rejects/);
  assert.match(src, /createOptionsChart/);
  assert.match(src, /export function createLcPriceChart/);
  assert.match(src, /export function resizeLcHost/);
  assert.match(src, /export function useLcPriceChart/);
  assert.match(src, /ResizeObserver/);
  assert.match(src, /localization: \{ locale: "zh-CN", precision: 0 \}/);
  assert.match(src, /createTextWatermark/);
  assert.match(src, /export function setPaneWatermark/);
  assert.match(src, /createUpDownMarkers/);
  assert.match(src, /export function ensureUpDown/);
  assert.match(src, /export function paintUpDown/);
  assert.match(src, /PriceScaleMode/);
  assert.match(src, /export function setLogScale/);
});

test("四张 K/分时卡走 LC, 不直接 echarts.init", () => {
  for (const rel of [
    "src/pages/AShareLightChart.tsx",
    "src/pages/UsMarket.tsx",
    "src/components/arb/SpreadChart.tsx",
    "src/components/deriv/OptionChartCard.tsx",
  ]) {
    const body = readFileSync(join(root, rel), "utf8");
    assert.match(body, /useLcChart/, rel);
    assert.match(body, /LcWell/, rel);
    assert.match(body, /setRefPriceLine/, rel);
    assert.match(body, /setPaneWatermark/, rel);
    assert.doesNotMatch(body, /echarts\.init/, rel);
    assert.doesNotMatch(body, /from "echarts"/, rel);
    assert.doesNotMatch(body, /sizeVolPane/, rel);
  }
  const ashare = readFileSync(join(root, "src/pages/AShareLightChart.tsx"), "utf8");
  const us = readFileSync(join(root, "src/pages/UsMarket.tsx"), "utf8");
  const arb = readFileSync(join(root, "src/components/arb/SpreadChart.tsx"), "utf8");
  assert.match(ashare, /setLogScale/);
  assert.match(us, /setLogScale/);
  assert.match(ashare, /ensureUpDown/);
  assert.match(arb, /ensureUpDown/);
});

const LC_ORIGIN = 1_700_000_000;
function lcTime(i) { return LC_ORIGIN + i; }
function hoverIdxFromParam(raw, n) {
  const p = raw;
  if (!p) return null;
  if (p.currTrigger === "leave") return null;
  if ("point" in p && p.point == null) return null;
  if (typeof p.logical === "number" && Number.isFinite(p.logical)) {
    const i = Math.round(p.logical);
    return i >= 0 && i < n ? i : null;
  }
  if (typeof p.time === "number") {
    const i = Math.round(p.time - LC_ORIGIN);
    return i >= 0 && i < n ? i : null;
  }
  return null;
}

function pxPrec(codeOrUnd, sample) {
  const s = (codeOrUnd ?? "").toUpperCase();
  if (s === "AG" || s.startsWith("AG_") || /^AG\d/.test(s)) return { precision: 1, minMove: 0.1 };
  if (s === "AU" || s.startsWith("AU_") || /^AU\d/.test(s)) return { precision: 2, minMove: 0.01 };
  if (sample != null && Number.isFinite(sample)) {
    const a = Math.abs(sample);
    if (a >= 10_000) return { precision: 1, minMove: 0.1 };
    if (a > 0 && a < 1) return { precision: 4, minMove: 0.0001 };
  }
  return { precision: 2, minMove: 0.01 };
}

function samePoint(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
  if (a.time !== b.time) return false;
  if ("value" in a || "value" in b) return a.value === b.value && a.color === b.color;
  return a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;
}

function canUpdateLast(prev, next) {
  if (!prev || prev.length === 0 || prev.length !== next.length) return false;
  for (let i = 0; i < next.length - 1; i++) {
    if (!samePoint(prev[i], next[i])) return false;
  }
  return true;
}

test("pxPrec 银一位金两位, 小价四位", () => {
  assert.equal(pxPrec("AG2609").precision, 1);
  assert.equal(pxPrec("ag2609C16000").precision, 1);
  assert.equal(pxPrec("AU2609").precision, 2);
  assert.equal(pxPrec("IF2608").precision, 2);
  assert.equal(pxPrec("TAG", 12).precision, 2);
  assert.equal(pxPrec("510300", 0.12).precision, 4);
  assert.equal(pxPrec("RB", 11_200).precision, 1);
});

test("canUpdateLast 只认最后一根变", () => {
  const a = [{ time: 1, value: 1 }, { time: 2, value: 2 }];
  const b = [{ time: 1, value: 1 }, { time: 2, value: 3 }];
  const c = [{ time: 1, value: 9 }, { time: 2, value: 2 }];
  assert.equal(canUpdateLast(a, b), true);
  assert.equal(canUpdateLast(a, c), false);
  assert.equal(canUpdateLast(a, [...a, { time: 3, value: 4 }]), false);
  assert.equal(canUpdateLast(null, a), false);
});

test("lcTime 逻辑时间可反推下标, 真时间轴不会把午休拉开", () => {
  assert.equal(lcTime(0), LC_ORIGIN);
  assert.equal(lcTime(240) - lcTime(0), 240);
  assert.equal(hoverIdxFromParam({ logical: 12, point: { x: 1, y: 1 } }, 100), 12);
  assert.equal(hoverIdxFromParam({ time: LC_ORIGIN + 5, point: { x: 1, y: 1 } }, 10), 5);
  assert.equal(hoverIdxFromParam({ point: null, logical: 3 }, 10), null);
});
