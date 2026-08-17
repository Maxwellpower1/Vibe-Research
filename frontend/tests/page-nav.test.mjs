import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("desktop header and phone bar share PAGE_NAV", () => {
  const header = readFileSync(join(root, "src/components/cockpit/CockpitHeader.tsx"), "utf8");
  const layout = readFileSync(join(root, "src/components/layout/Layout.tsx"), "utf8");
  assert.match(header, /export const PAGE_NAV/);
  assert.match(layout, /PAGE_NAV/);
  assert.doesNotMatch(layout, /const MOBILE_NAV/);
  assert.doesNotMatch(header, /const NAV =/);
  assert.match(header, /to: "\/backtest"/);
  assert.match(layout, /"\/backtest"/);
  assert.match(header, /to: "\/data"/);
  assert.match(layout, /"\/data"/);
});

test("A-share portfolio jumps to backtest and autostarts", () => {
  const src = readFileSync(join(root, "src/components/portfolio/StockPortfolio.tsx"), "utf8");
  assert.match(src, /\/backtest\?codes=/);
  assert.match(src, /autostart=1/);
  assert.match(src, /from=portfolio/);
  assert.match(src, /slice\(0, 100\)/);
});

test("backtest page uses store cover and meta limit", () => {
  const src = readFileSync(join(root, "src/pages/Backtest.tsx"), "utf8");
  assert.match(src, /backtestCover/);
  assert.match(src, /backtestMeta/);
  assert.match(src, /FALLBACK_MAX/);
  assert.match(src, /to="\/data"/);
  assert.match(src, /rank_mom/);
  assert.match(src, /对照/);
  assert.match(src, /填回表单/);
  assert.match(src, /by_symbol/);
  assert.match(src, /FactorPanel/);
  assert.match(src, /stopLossPct/);
  assert.match(src, /Tearsheet/);
  assert.match(src, /IndexPoolButtons/);
  assert.match(src, /useBacktestJob/);
  const job = readFileSync(join(root, "src/pages/backtest/useBacktestJob.ts"), "utf8");
  assert.match(job, /backtestProgress/);
  const tear = readFileSync(join(root, "src/pages/backtest/Tearsheet.tsx"), "utf8");
  assert.match(tear, /月收益/);
  assert.match(tear, /最大回撤/);
  assert.match(tear, /gridTemplateColumns/);
  const factor = readFileSync(join(root, "src/pages/backtest/FactorPanel.tsx"), "utf8");
  assert.match(factor, /backtestRuns\(20, "factor"\)/);
  assert.match(factor, /写完不改/);
  assert.match(factor, /backtestFactorCompare/);
  assert.match(factor, /越小越好/);
  assert.match(factor, /IndexPoolButtons/);
  const api = readFileSync(join(root, "src/lib/api.ts"), "utf8");
  assert.match(api, /backtestIndexPool/);
});
