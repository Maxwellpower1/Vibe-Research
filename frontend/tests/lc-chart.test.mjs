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
    assert.doesNotMatch(body, /echarts\.init/, rel);
    assert.doesNotMatch(body, /from "echarts"/, rel);
    assert.doesNotMatch(body, /sizeVolPane/, rel);
  }
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

test("lcTime 逻辑时间可反推下标, 真时间轴不会把午休拉开", () => {
  assert.equal(lcTime(0), LC_ORIGIN);
  assert.equal(lcTime(240) - lcTime(0), 240);
  assert.equal(hoverIdxFromParam({ logical: 12, point: { x: 1, y: 1 } }, 100), 12);
  assert.equal(hoverIdxFromParam({ time: LC_ORIGIN + 5, point: { x: 1, y: 1 } }, 10), 5);
  assert.equal(hoverIdxFromParam({ point: null, logical: 3 }, 10), null);
});
