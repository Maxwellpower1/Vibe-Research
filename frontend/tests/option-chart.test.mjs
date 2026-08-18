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

function overlayAxis(vals, occupy = 0.32) {
  const xs = [];
  for (const v of vals) {
    if (v != null && Number.isFinite(v) && v > 0) xs.push(v);
  }
  if (xs.length === 0) return null;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, Math.abs(mid) * 0.015, 0.4);
  const frac = Math.min(0.85, Math.max(0.1, occupy));
  const pad = half / frac - half;
  return { min: mid - half - pad, max: mid + half + pad };
}

test("overlayAxis 窄幅隐波只占约三成高度, 空值忽略", () => {
  const r = overlayAxis([18, 22, 19, 21]);
  assert.ok(r);
  const data = 22 - 18;
  const span = r.max - r.min;
  assert.ok(Math.abs(data / span - 0.32) < 0.02, "默认约占 32% 高度");
  assert.ok(r.min < 18 && r.max > 22);
  const quiet = overlayAxis([20.1, 20.2, 20.15, 20.18, null, 0]);
  assert.ok(quiet);
  assert.ok((20.2 - 20.1) / (quiet.max - quiet.min) < 0.2, "几乎走平也不拉满");
  assert.equal(overlayAxis([]), null);
  assert.equal(overlayAxis([null, 0, -1]), null);
});

test("OptionChartCard 用 hoverIdxOf, 下跌面积不再反转渐变", async () => {
  const src = await readFile(new URL("../src/components/deriv/OptionChartCard.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("export function hoverIdxOf"), "十字光标走 hoverIdxOf");
  assert.ok(src.includes("seriesDataIndices"), "类目轴读 dataIndex");
  assert.ok(src.includes("rgba(${fade},0.35)"), "涨跌面积都是顶浓底淡");
  assert.ok(src.includes("export function overlayAxis"), "隐波右轴走 overlayAxis");
  assert.ok(src.includes("overlayAxis(minData?.iv"), "分时隐波不拉满");
  assert.ok(src.includes("overlayAxis(dailyIv)"), "日K隐波同一比例");
});

function parseMinute(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const b of raw) {
    if (!Array.isArray(b) || b.length < 2) continue;
    const close = Number(b[1]);
    if (!Number.isFinite(close)) continue;
    const oi = Number(b[3]);
    const vol = Number(b[7]);
    out.push({
      t: String(b[0]),
      close,
      vol: Number.isFinite(vol) ? vol : 0,
      oi: Number.isFinite(oi) && oi > 0 ? oi : null,
    });
  }
  return out;
}

test("parseMinute 第4列是仓、第8列是量, 缺列当空", () => {
  const rows = parseMinute([
    ["2026-08-18 23:08:00", 950.98, "-0.57%", 199971, 951.92, 951.92, 950.76, 768],
    ["2026-08-18 09:32:00", 12.4, "1.3%", 80, 12.3, 12.5, 12.2],
    ["2026-08-18 09:33:00", 12.1, "-1.2%", 0, 12.4, 12.4, 12.0, 10],
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].oi, 199971);
  assert.equal(rows[0].vol, 768);
  assert.equal(rows[1].oi, 80);
  assert.equal(rows[1].vol, 0);
  assert.equal(rows[2].oi, null);
  assert.equal(rows[2].vol, 10);
});

test("分时量窗叠持仓黄线, 独立轴不压成交量", async () => {
  const src = await readFile(new URL("../src/components/deriv/OptionChartCard.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("[time, close, pct, oi, open, high, low, vol]"), "分钟 bar 第4列仓第8列量");
  assert.ok(src.includes('name: "持仓量"'), "分时画持仓线");
  assert.ok(src.includes("yAxisIndex: 3"), "仓走量窗独立轴");
  assert.ok(src.includes("overlayAxis(minData?.oi"), "仓不跟成交量抢同一标尺");
  assert.ok(src.includes("仓 ${fmtOi(oi)}"), "十字光标读仓");
});

test("K线页分时同一套列序: 第4列仓第8列量", async () => {
  const src = await readFile(new URL("../src/components/deriv/DerivLightChart.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("[datetime, price, pct, oi, open, high, low, vol]"));
  assert.ok(src.includes("const vol = Number(r[7])"));
  assert.ok(src.includes("const oi = Number(r[3])"));
});

test("驾驶舱日K分时叠在同一张卡", async () => {
  const src = await readFile(new URL("../src/pages/DerivCockpit.tsx", import.meta.url), "utf8");
  assert.ok(src.includes('id: "opt-charts"'), "一张图卡");
  assert.ok(!src.includes('id: "opt-daily"') && !src.includes('id: "opt-minute"'), "不再并排两卡");
  assert.ok(src.includes('mode="daily"') && src.includes('mode="minute"'), "上日K下分时");
  assert.ok(src.includes("defaultW: 0.36") && src.includes("defaultW: 0.20"), "行情观察/日历宽度");
  assert.ok(src.includes("defaultW: 0.78") && src.includes("defaultW: 0.22"), "T 表主宽, 图卡一小条");
  assert.ok(src.includes("defaultH: 0.29") && src.includes("defaultH: 0.71"), "首行回原高, T 区加高");
  assert.ok(src.includes('kind: "und"'), "点行情观察出标的日K/分时");
  assert.ok(src.includes("undChart"), "行情观察行带标的码给图卡");
});

test("IndexFutPanel 行点击带标的码, 合约码仍跳 K线页", async () => {
  const src = await readFile(new URL("../src/components/deriv/IndexFutPanel.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("undChart?: { code: string; name: string }"), "行点击第二参是标的图");
  assert.ok(src.includes("contractCode(row) || klineSym(row)"), "标的码用主力合约");
  assert.ok(src.includes("onPickSymbol(sym)"), "行上合约码仍跳 K线");
});
