import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function pad2(n) {
  return String(n).padStart(2, "0");
}
function ymdOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function toClockMin(t) {
  const colon = (t || "").match(/(\d{1,2}):(\d{2})/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  return NaN;
}
function hmOf(t) {
  const m = toClockMin(t);
  if (!Number.isFinite(m)) return "";
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}
function minuteKey(t) {
  const s = (t || "").replace("T", " ").trim();
  if (s.length >= 16 && /^\d{4}-\d{2}-\d{2} /.test(s)) return s.slice(0, 16);
  return hmOf(t);
}
function isNightTime(t) {
  const h = Math.floor(toClockMin(t) / 60);
  return Number.isFinite(h) && (h >= 20 || h < 6);
}
function nightDateOf(td) {
  const dt = new Date(`${td}T12:00:00`);
  dt.setDate(dt.getDate() - 1);
  while (dt.getDay() === 0 || dt.getDay() === 6) dt.setDate(dt.getDate() - 1);
  return ymdOf(dt);
}
function expandIncl(date, start, endIncl) {
  const out = [];
  for (let t = start; t <= endIncl; t++) {
    out.push(`${date} ${pad2(Math.floor(t / 60) % 24)}:${pad2(t % 60)}:00`);
  }
  return out;
}
function derivMinuteSlots(td, kind) {
  if (kind === "etf") {
    return [...expandIncl(td, 9 * 60 + 30, 11 * 60 + 30), ...expandIncl(td, 13 * 60, 15 * 60)];
  }
  if (kind === "cmdDay") {
    return [
      ...expandIncl(td, 9 * 60, 10 * 60 + 15),
      ...expandIncl(td, 10 * 60 + 30, 11 * 60 + 30),
      ...expandIncl(td, 13 * 60 + 30, 15 * 60),
    ];
  }
  const night = nightDateOf(td);
  if (kind === "index") {
    return [
      ...expandIncl(night, 21 * 60, 23 * 60),
      ...expandIncl(td, 9 * 60 + 30, 11 * 60 + 30),
      ...expandIncl(td, 13 * 60, 15 * 60),
    ];
  }
  return [
    ...expandIncl(night, 21 * 60, 23 * 60 + 59),
    ...expandIncl(td, 0, 2 * 60 + 30),
    ...expandIncl(td, 9 * 60, 10 * 60 + 15),
    ...expandIncl(td, 10 * 60 + 30, 11 * 60 + 30),
    ...expandIncl(td, 13 * 60 + 30, 15 * 60),
  ];
}
function padToSlots(items, slots, timeOf) {
  const byKey = new Map();
  const byHm = new Map();
  for (const it of items) {
    const t = timeOf(it);
    byKey.set(minuteKey(t), it);
    const hm = hmOf(t);
    if (hm) byHm.set(hm, it);
  }
  return slots.map((s) => byKey.get(minuteKey(s)) ?? byHm.get(hmOf(s)) ?? null);
}
function kindOfUnd(und, times) {
  const u = String(und || "").trim().toUpperCase();
  const root = /^\d{6}/.test(u) ? u.slice(0, 6) : (u.match(/^([A-Z]+)/) || ["", ""])[1];
  if (/^\d{6}$/.test(root)) return "etf";
  if (["IF", "IH", "IM", "IO", "HO", "MO"].includes(root)) return times.some(isNightTime) ? "index" : "etf";
  return times.some(isNightTime) ? "cmd" : "cmdDay";
}
function derivSessionIdx(t, kind) {
  const m = toClockMin(t);
  if (kind === "etf") {
    let e = m - (9 * 60 + 30);
    if (m >= 13 * 60) e -= 90;
    return Math.max(0, Math.min(e, 240));
  }
  if (kind === "cmdDay") {
    if (m < 9 * 60) return 0;
    if (m <= 10 * 60 + 15) return m - 9 * 60;
    if (m < 10 * 60 + 30) return 75;
    if (m <= 11 * 60 + 30) return 75 + (m - 10 * 60 - 30);
    if (m < 13 * 60 + 30) return 135;
    return Math.min(135 + (m - 13 * 60 - 30), 225);
  }
  return NaN;
}

test("ETF 开盘几分钟停在轴左侧, 不铺满", () => {
  const slots = derivMinuteSlots("2026-08-18", "etf");
  const padded = padToSlots(
    [{ t: "2026-08-18 09:31:00", close: 1 }, { t: "2026-08-18 09:32:00", close: 2 }],
    slots,
    (b) => b.t,
  );
  let last = -1;
  padded.forEach((b, i) => { if (b) last = i; });
  assert.ok(slots.length >= 240);
  assert.ok(last >= 0 && last / slots.length < 0.03);
  assert.equal(padded.filter(Boolean).length, 2);
});

test("商品日盘 09:01 停在左侧", () => {
  const slots = derivMinuteSlots("2026-08-18", "cmdDay");
  const padded = padToSlots([{ t: "2026-08-18 09:01:00", close: 1 }], slots, (b) => b.t);
  const i = padded.findIndex((b) => b);
  assert.ok(i >= 0 && i / slots.length < 0.02);
});

test("夜盘 21:01 停在左侧, 周五夜归周一槽", () => {
  assert.equal(nightDateOf("2026-08-17"), "2026-08-14");
  const slots = derivMinuteSlots("2026-08-17", "cmd");
  const padded = padToSlots([{ t: "2026-08-14 21:01:00", close: 1 }], slots, (b) => b.t);
  const i = padded.findIndex((b) => b);
  assert.ok(i >= 0 && i / slots.length < 0.02);
});

test("kindOfUnd: ETF / 股指日盘 / 商品夜盘", () => {
  assert.equal(kindOfUnd("510050", ["09:31"]), "etf");
  assert.equal(kindOfUnd("IF", ["09:31"]), "etf");
  assert.equal(kindOfUnd("IF", ["21:05", "09:31"]), "index");
  assert.equal(kindOfUnd("AU", ["09:01"]), "cmdDay");
  assert.equal(kindOfUnd("AU2609C952", ["21:05"]), "cmd");
});

test("spark idx: 早盘远小于收盘", () => {
  assert.ok(derivSessionIdx("09:31", "etf") < 15);
  assert.equal(derivSessionIdx("15:00", "etf"), 240);
  assert.ok(derivSessionIdx("09:01", "cmdDay") < 10);
  assert.equal(derivSessionIdx("15:00", "cmdDay"), 225);
});

test("悬停空槽不回落最后一笔", () => {
  function lastFiniteIdx(vals, hover) {
    if (hover != null && hover >= 0 && hover < vals.length) {
      const v = vals[hover];
      return v != null && Number.isFinite(v) ? hover : null;
    }
    for (let i = vals.length - 1; i >= 0; i--) {
      const v = vals[i];
      if (v != null && Number.isFinite(v)) return i;
    }
    return null;
  }
  const vals = [1, 2, null, null];
  assert.equal(lastFiniteIdx(vals, null), 1);
  assert.equal(lastFiniteIdx(vals, 1), 1);
  assert.equal(lastFiniteIdx(vals, 3), null);
});

test("分时图走交易时段轴, 不按点序均分", async () => {
  const card = await readFile(new URL("../src/components/deriv/OptionChartCard.tsx", import.meta.url), "utf8");
  const kline = await readFile(new URL("../src/components/deriv/DerivLightChart.tsx", import.meta.url), "utf8");
  const spark = await readFile(new URL("../src/components/ovlab/shared.tsx", import.meta.url), "utf8");
  const axis = await readFile(new URL("../src/lib/derivMinuteAxis.ts", import.meta.url), "utf8");
  assert.match(card, /derivMinuteSlots/);
  assert.match(card, /padToSlots/);
  assert.match(kline, /derivMinuteSlots/);
  assert.match(spark, /derivSessionIdx/);
  assert.match(axis, /export function derivMinuteSlots/);
  assert.match(axis, /empty hover stays null/);
  assert.match(card, /hover != null && i == null/);
  assert.match(kline, /emptyHover/);
  assert.doesNotMatch(spark, /i \/ \(n - 1\)\) \* innerW/);
});
