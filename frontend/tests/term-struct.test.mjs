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
});
