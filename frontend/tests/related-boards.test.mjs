import assert from "node:assert/strict";
import test from "node:test";

function matchRelatedBoards(boards, keywords, n = 8) {
  const keys = keywords.filter(Boolean);
  return boards
    .filter((b) => keys.some((k) => b.name.includes(k) || k.includes(b.name)))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, n);
}

test("matchRelatedBoards ranks and caps", () => {
  const out = matchRelatedBoards(
    [
      { name: "人工智能", pct: 1.2 },
      { name: "银行", pct: 3.0 },
      { name: "算力", pct: 2.5 },
      { name: "白酒", pct: 4.0 },
    ],
    ["大模型", "AI", "算力", "人工智能"],
    8,
  );
  assert.deepEqual(out.map((b) => b.name), ["算力", "人工智能"]);
});
