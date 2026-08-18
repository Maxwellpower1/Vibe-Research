import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("期限结构卡叠仓单条, 复用 warehouse-receipt", async () => {
  const src = await readFile(new URL("../src/components/deriv/TermStructPanel.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("ovlabWarehouseReceipt"), "仓单走瘦身接口");
  assert.ok(src.includes("function ReceiptStrip"), "同卡仓单条");
  assert.ok(src.includes("function ReceiptSpark"), "近90日折线");
  assert.ok(src.includes("仓单"), "展示仓单");
  assert.ok(src.includes("pickDefaultUnd"), "默认选有仓单的商品");
  assert.ok(src.includes("股指/ETF 无"), "无仓单仍占一行");
  assert.ok(src.includes("wr.last == null"), "空仓单停转圈");
  assert.ok(src.includes("yAxisIndex: 1"), "持仓柱走右轴");
  assert.ok(!src.includes("gridIndex: 1"), "不再上下分格");
  assert.ok(src.includes("ProdSearchSelect"), "品种下拉可搜索");
  assert.ok(!src.includes("<select"), "不再用原生 select");
  assert.ok(!src.includes("function MonthTable"), "不再用月份表");
  assert.ok(src.includes("function ptLabel"), "现值涨幅标在今曲线点上");
});

function filterProdOptions(opts, q) {
  const s = q.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return opts;
  return opts.filter((o) => `${o.value}${o.label}`.toLowerCase().replace(/\s+/g, "").includes(s));
}

test("filterProdOptions 按码和中文名过滤", () => {
  const opts = [
    { value: "AU", label: "沪金 AU" },
    { value: "AG", label: "沪银 AG" },
    { value: "510300", label: "沪深300ETF 510300" },
  ];
  assert.deepEqual(filterProdOptions(opts, "au").map((o) => o.value), ["AU"]);
  assert.deepEqual(filterProdOptions(opts, "沪金").map((o) => o.value), ["AU"]);
  assert.deepEqual(filterProdOptions(opts, "300").map((o) => o.value), ["510300"]);
  assert.equal(filterProdOptions(opts, "").length, 3);
});

function fmtPx(v) {
  if (Math.abs(v) >= 1000) return String(Math.round(v));
  if (Math.abs(v) >= 100) return v.toFixed(1).replace(/\.0$/, "");
  return v.toFixed(2);
}
function fmtChg(pct) {
  if (Math.abs(pct) < 0.005) return "0%";
  const s = pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${pct > 0 ? "+" : ""}${s}%`;
}
function chgPct(p) {
  if (p.fwdYd == null || p.fwdYd === 0) return null;
  return ((p.fwd - p.fwdYd) / p.fwdYd) * 100;
}
function chgTone(chg) {
  if (chg == null || Math.abs(chg) < 0.005) return "flat";
  return chg > 0 ? "up" : "dn";
}
function ptLabel(p) {
  const chg = chgPct(p);
  return `{px|${fmtPx(p.fwd)}}\n{${chgTone(chg)}|${chg == null ? "-" : fmtChg(chg)}}`;
}

test("ptLabel 现值加红绿涨幅", () => {
  assert.equal(ptLabel({ fwd: 5014.4, fwdYd: 5046.2 }), "{px|5014}\n{dn|-0.63%}");
  assert.equal(ptLabel({ fwd: 100, fwdYd: 99 }), "{px|100}\n{up|+1.01%}");
  assert.equal(ptLabel({ fwd: 10, fwdYd: null }), "{px|10.00}\n{flat|-}");
});
