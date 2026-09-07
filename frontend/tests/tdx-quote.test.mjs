import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const api = readFileSync(join(root, "src/lib/api.ts"), "utf8");
const stock = readFileSync(join(root, "src/pages/StockData.tsx"), "utf8");
const chart = readFileSync(join(root, "src/pages/AShareLightChart.tsx"), "utf8");
const depth = readFileSync(join(root, "src/components/ashare/DepthBook.tsx"), "utf8");
const pane = readFileSync(join(root, "src/components/ashare/AShareLcPane.tsx"), "utf8");

test("个股详情点开拉一次通达信五档, 不另开轮询", () => {
  assert.match(api, /tdxQuote:\s*\(code:/);
  assert.match(api, /\/astock\/tdx-quote\?code=/);
  assert.match(api, /export interface TdxQuote/);
  assert.equal([...stock.matchAll(/api\.tdxQuote\(c\)/g)].length, 2);
  assert.match(stock, /from "@\/components\/ashare\/DepthBook"/);
  assert.match(depth, /export function DepthBook/);
  assert.doesNotMatch(stock, /setInterval/);
});

test("金银油分时挂同一把 commodity-minutes, 通达信源不叠新浪现货", () => {
  const lk = readFileSync(join(root, "src/lib/lightKline.ts"), "utf8");
  assert.match(lk, /commodityMinutes\(COMMODITY_CODES\)/);
  assert.match(lk, /kl\.source = row\?\.source \|\| "sina"/);
  assert.match(lk, /volume: Number\(p\.v\) > 0 \? Number\(p\.v\) : 0/);
  assert.match(pane, /export function minuteFlowKind/);
  assert.match(pane, /minuteFlowOf\(b, flowKind\)/);
  assert.match(chart, /minute\.meta\?\.source === "tdx"/);
  assert.doesNotMatch(lk, /\/astock\/tdx-quote/);
});

test("分时右侧五档走同一把 tdx_quote, 跟 hubPollMs 续拉当前码", () => {
  assert.match(depth, /export function DepthRail/);
  assert.match(depth, /export function canTdxBook/);
  assert.match(depth, /us\(\?:dji\|ixic\|inx\|vix\|soxx\)/);
  assert.match(chart, /function useTdxBook/);
  assert.match(chart, /api\.tdxQuote\(code\)/);
  assert.match(chart, /side=\{book \? <DepthRail book=\{book\} \/> : null\}/);
  assert.match(chart, /function useTdxBook[\s\S]*setTimeout[\s\S]*hubPollMs/);
  assert.doesNotMatch(chart, /function useTdxBook[\s\S]{0,800}setInterval/);
  assert.match(chart, /keep last-good/);
  assert.match(pane, /side\?: ReactNode/);
});
