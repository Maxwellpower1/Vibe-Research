import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function tencentMinuteUrl(code) {
  if (/^us/i.test(code)) {
    return `https://web.ifzq.gtimg.cn/appstock/app/usMinute/query?code=${code}`;
  }
  return `https://ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`;
}

test("US indices use usMinute, A/HK use minute", () => {
  assert.match(tencentMinuteUrl("usDJI"), /usMinute/);
  assert.match(tencentMinuteUrl("usIXIC"), /usMinute/);
  assert.match(tencentMinuteUrl("sh000001"), /\/minute\/query/);
  assert.doesNotMatch(tencentMinuteUrl("hkHSI"), /usMinute/);
});

test("US30Y minute does not hit Tencent direct", async () => {
  const src = await readFile(new URL("../src/lib/lightKline.ts", import.meta.url), "utf8");
  assert.match(src, /usUS30Y/);
  assert.match(src, /canDirectMinute/);
});
