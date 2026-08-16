import assert from "node:assert/strict";
import test from "node:test";

const ROW1 = [0.25, 0.42, 0.33];
const ROW2 = [0.2, 0.18, 0.2, 0.18, 0.24];
const ROW3 = [0.28, 0.36, 0.36];

test("review cockpit row widths sum to 1", () => {
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  assert.equal(Number(sum(ROW1).toFixed(2)), 1);
  assert.equal(Number(sum(ROW2).toFixed(2)), 1);
  assert.equal(Number(sum(ROW3).toFixed(2)), 1);
});
