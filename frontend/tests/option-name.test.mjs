import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 与 TQuotePanel.optionName 同口径: 锚定末尾 C/P+行权价
function optionName(code) {
  return code.replace(/C(\d+(?:\.\d+)?)$/, "购$1").replace(/P(\d+(?:\.\d+)?)$/, "沽$1");
}

test("optionName 常规合约转展示名", () => {
  assert.equal(optionName("AU2609C952"), "AU2609购952");
  assert.equal(optionName("M2609P3000"), "M2609沽3000");
  assert.equal(optionName("5103002608C4.7"), "5103002608购4.7");
});

test("optionName 品种码含 C/P 时只换末尾 (玉米C/聚丙烯PP/动力煤ZC)", () => {
  assert.equal(optionName("C2609C3000"), "C2609购3000");
  assert.equal(optionName("PP2609C7000"), "PP2609购7000");
  assert.equal(optionName("ZC2609C800"), "ZC2609购800");
  assert.equal(optionName("CF2611C16800"), "CF2611购16800");
});

test("TQuotePanel 的 optionName 用末尾锚定正则 (防退回首匹配)", async () => {
  const src = await readFile(new URL("../src/components/deriv/TQuotePanel.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("/C(\\d+(?:\\.\\d+)?)$/"), "call 侧需末尾锚定");
  assert.ok(src.includes("/P(\\d+(?:\\.\\d+)?)$/"), "put 侧需末尾锚定");
});
