import assert from "node:assert/strict";
import test from "node:test";

function itemKey(it, i) {
  return String(it.id ?? `${it.time}-${i}`);
}

function countNew(items, seen) {
  if (!items.length) return 0;
  if (!seen) return Math.min(items.length, 9);
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    if (itemKey(items[i], i) === seen) break;
    n += 1;
  }
  return Math.min(n, 99);
}

test("news cell has jin10 tab on the same telegraph hub", async () => {
  const { readFile } = await import("node:fs/promises");
  const hub = await readFile(new URL("../src/lib/telegraphHub.ts", import.meta.url), "utf8");
  const panel = await readFile(new URL("../src/components/cockpit/NewsCockpitPanel.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  assert.match(hub, /"cls" \| "lives" \| "jin10"/);
  assert.match(hub, /src === "jin10" \? "jin10"/);
  assert.match(panel, /\["jin10", "金十"\]/);
  assert.match(panel, /cats=\{it\.tags\}/);
  assert.match(api, /source=\$\{source\}/);
});

test("itemKey prefers id then time-index", () => {
  assert.equal(itemKey({ id: 12, time: "2026-08-16 10:00" }, 0), "12");
  assert.equal(itemKey({ time: "2026-08-16 10:00" }, 3), "2026-08-16 10:00-3");
});

test("countNew is 0 when empty or already at top", () => {
  assert.equal(countNew([], ""), 0);
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(countNew(items, "a"), 0);
  assert.equal(countNew(items, "c"), 2);
});

test("countNew caps first visit and unread", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: String(i) }));
  assert.equal(countNew(items, ""), 9);
  assert.equal(countNew(items, "never"), 20);
});
