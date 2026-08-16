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
});
