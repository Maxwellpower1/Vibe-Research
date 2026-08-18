import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function tradingDayOf(t) {
  const d = t.slice(0, 10);
  const hh = Number(t.slice(11, 13));
  if (hh >= 6 && hh < 20) return d;
  const dt = new Date(`${d}T00:00:00`);
  if (hh < 6) dt.setDate(dt.getDate() - 1);
  do {
    dt.setDate(dt.getDate() + 1);
  } while (dt.getDay() === 0 || dt.getDay() === 6);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hoverIdxOf(raw, cats) {
  const p = raw;
  if (p?.currTrigger === "leave") return null;
  const xAxis = (p.axesInfo ?? []).find((a) => a.axisDim === "x") ?? p.axesInfo?.[0];
  const fromSeries = xAxis?.seriesDataIndices?.find((s) => Number.isInteger(s?.dataIndex));
  if (fromSeries && Number.isInteger(fromSeries.dataIndex)) return fromSeries.dataIndex;
  const val = xAxis?.value;
  if (typeof val === "number" && val >= 0 && val < cats.length) return Math.round(val);
  if (val != null) {
    const s = String(val);
    const i = cats.findIndex((c) => c === s || c.slice(11, 16) === s || c.slice(5) === s);
    if (i >= 0) return i;
  }
  return null;
}

test("tradingDayOf 夜盘归次交易日, 周末顺延", () => {
  assert.equal(tradingDayOf("2026-08-18 10:30:00"), "2026-08-18");
  assert.equal(tradingDayOf("2026-08-17 21:05:00"), "2026-08-18");
  assert.equal(tradingDayOf("2026-08-18 01:30:00"), "2026-08-18");
  assert.equal(tradingDayOf("2026-08-14 21:05:00"), "2026-08-17");
  assert.equal(tradingDayOf("2026-08-15 01:30:00"), "2026-08-17");
});

test("hoverIdxOf 类目轴用 dataIndex / 时间字符串, leave 清空", () => {
  const cats = ["2026-08-18 09:30:00", "2026-08-18 09:31:00", "2026-08-18 09:32:00"];
  assert.equal(hoverIdxOf({ currTrigger: "leave" }, cats), null);
  assert.equal(hoverIdxOf({
    axesInfo: [{ axisDim: "x", seriesDataIndices: [{ dataIndex: 2 }] }],
  }, cats), 2);
  assert.equal(hoverIdxOf({
    axesInfo: [{ axisDim: "x", value: "2026-08-18 09:31:00" }],
  }, cats), 1);
  assert.equal(hoverIdxOf({
    axesInfo: [{ axisDim: "x", value: "09:32" }],
  }, cats), 2);
  assert.equal(hoverIdxOf({
    axesInfo: [{ axisDim: "x", value: "not-a-bar" }],
  }, cats), null);
});

test("OptionChartCard 用 hoverIdxOf, 下跌面积不再反转渐变", async () => {
  const src = await readFile(new URL("../src/components/deriv/OptionChartCard.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("export function hoverIdxOf"), "十字光标走 hoverIdxOf");
  assert.ok(src.includes("seriesDataIndices"), "类目轴读 dataIndex");
  assert.ok(src.includes("rgba(${fade},0.35)"), "涨跌面积都是顶浓底淡");
  assert.ok(!src.includes("rgba(34,197,94,0.02)\" }, { offset: 1"), "不再用反转绿渐变");
});

test("驾驶舱日K分时叠在同一张卡", async () => {
  const src = await readFile(new URL("../src/pages/DerivCockpit.tsx", import.meta.url), "utf8");
  assert.ok(src.includes('id: "opt-charts"'), "一张图卡");
  assert.ok(!src.includes('id: "opt-daily"') && !src.includes('id: "opt-minute"'), "不再并排两卡");
  assert.ok(src.includes('mode="daily"') && src.includes('mode="minute"'), "上日K下分时");
  assert.ok(src.includes("defaultW: 0.36") && src.includes("defaultW: 0.20"), "行情观察/日历宽度");
  assert.ok(src.includes("defaultW: 0.78") && src.includes("defaultW: 0.22"), "T 表主宽, 图卡一小条");
  assert.ok(src.includes("defaultH: 0.29") && src.includes("defaultH: 0.71"), "首行回原高, T 区加高");
});
