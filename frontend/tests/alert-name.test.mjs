import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 与 derivShared.alertOptionName 同口径: OPT_{EXCH}_{UND}:{YYYYMM}:{C|P}:{strike}
const DERIV_LABELS = {
  IO: "沪深300", HO: "上证50", MO: "中证1000",
  510050: "50ETF", 510300: "300ETF", 510500: "500ETF", 159915: "创业板ETF", 588000: "科创50ETF",
  588080: "科创板50", 159901: "深100ETF", 159919: "300ETF", 159922: "500ETF",
  AU: "沪金", RB: "螺纹钢",
};

function alertOptionName(a) {
  const raw = String(a.instrument ?? "").trim();
  const m = raw.match(/^OPT_[A-Z]+_([A-Z0-9]+):(\d{6}):([CP]):(.+)$/i);
  if (!m) return String(a.contract_code ?? "") || raw || "-";
  const [, und, ym, side, strike] = m;
  const name = DERIV_LABELS[und.toUpperCase()] ?? und;
  return `${name}${side.toUpperCase() === "C" ? "购" : "沽"}${Number(ym.slice(4))}月${strike}`;
}

test("alertOptionName 股票期权 instrument 转中文名", () => {
  assert.equal(alertOptionName({ instrument: "OPT_SHSE_588000:202608:P:1.8", contract_code: "10012124" }), "科创50ETF沽8月1.8");
  assert.equal(alertOptionName({ instrument: "OPT_SZSE_159915:202608:P:3.4", contract_code: "90007784" }), "创业板ETF沽8月3.4");
  assert.equal(alertOptionName({ instrument: "OPT_CFFEX_MO:202608:C:8200", contract_code: "" }), "中证1000购8月8200");
  assert.equal(alertOptionName({ instrument: "OPT_CFFEX_IO:202612:P:4750" }), "沪深300沽12月4750");
});

test("alertOptionName 目录外 ETF 用补充表, 商品走目录 und", () => {
  assert.equal(alertOptionName({ instrument: "OPT_SHSE_588080:202609:C:1.2" }), "科创板50购9月1.2");
  assert.equal(alertOptionName({ instrument: "OPT_SHFE_AU:202610:C:952" }), "沪金购10月952");
});

test("alertOptionName 解析失败回落 contract_code", () => {
  assert.equal(alertOptionName({ instrument: "weird", contract_code: "10012065" }), "10012065");
  assert.equal(alertOptionName({ contract_code: "90007675" }), "90007675");
  assert.equal(alertOptionName({}), "-");
});

test("derivShared 的 alertOptionName 用 OPT_ 前缀锚定且异动面板使用之", async () => {
  const shared = await readFile(new URL("../src/components/deriv/derivShared.tsx", import.meta.url), "utf8");
  assert.ok(shared.includes("OPT_[A-Z]+_([A-Z0-9]+)"), "需锚定 OPT_ 前缀 instrument");
  const panel = await readFile(new URL("../src/components/deriv/AlertPanel.tsx", import.meta.url), "utf8");
  assert.ok(panel.includes("alertOptionName(a)"), "异动面板合约列需用中文名");
});
