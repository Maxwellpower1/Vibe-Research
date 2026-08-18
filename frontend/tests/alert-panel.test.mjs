import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("异动卡对齐 OpenVlab option-flow: 三类规则 + 剩余天数 + 区间涨幅 + 本机阈值", async () => {
  const src = await readFile(new URL("../src/components/deriv/AlertPanel.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("r001_single_trade: \"成交异动\""), "成交异动");
  assert.ok(src.includes("r002_1m_pct_move: \"走势异动\""), "走势异动");
  assert.ok(src.includes("r003_repeated_aggressive_burst: \"连续成交\""), "连续成交");
  assert.ok(src.includes("剩余"), "剩余天数列");
  assert.ok(src.includes("区间"), "区间涨幅列");
  assert.ok(src.includes("daysToExpiry"), "剩余天数从 exp_date 算");
  assert.ok(src.includes("deriv.alertThresh"), "阈值本机存储");
  assert.ok(src.includes("window_volume"), "成交异动筛手数");
  assert.ok(src.includes("window_premium"), "连续成交筛金额");
  assert.ok(src.includes("clampThresh"), "阈值只能收紧");
  assert.ok(src.includes("Math.max(DEFAULT_THRESH"), "本地阈值有下限");
  assert.doesNotMatch(src, /r002_volume_surge|r003_oi_surge|单笔异动/);
});
