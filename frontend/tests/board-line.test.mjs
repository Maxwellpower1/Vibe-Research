import { test } from "node:test";
import assert from "node:assert/strict";

function boardLineParts(bd) {
  const industry = String(bd?.industry || "").trim();
  const concepts = (bd?.concepts || []).map((x) => String(x).trim()).filter(Boolean);
  if (!industry && !concepts.length) return null;
  return { industry, concepts: concepts.join("/") };
}

test("board line matches reference cockpit", () => {
  const line = boardLineParts({
    industry: "通信设备",
    concepts: ["物联网", "5G概念", "光通信模块"],
  });
  assert.equal(line.industry, "通信设备");
  assert.equal(line.concepts, "物联网/5G概念/光通信模块");
});

test("board line skips empty", () => {
  assert.equal(boardLineParts({ industry: "", concepts: [] }), null);
});
