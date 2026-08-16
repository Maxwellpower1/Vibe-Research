import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("router provider keeps cockpit nav sync", () => {
  const src = readFileSync(join(root, "src/main.tsx"), "utf8");
  assert.match(src, /useTransitions=\{false\}/);
});

test("lazy route errors stay under the header", () => {
  const src = readFileSync(join(root, "src/router.tsx"), "utf8");
  assert.match(src, /errorElement:\s*<RouteError/);
});
