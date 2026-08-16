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
});
