import assert from "node:assert/strict";
import test from "node:test";

function nextHi(i, n, dir) {
  if (n <= 0) return -1;
  if (dir === 1) return (i + 1) % n;
  return i <= 0 ? n - 1 : i - 1;
}

const CODE_RE = /^(?:sh|sz|bj)?\d{6}$/i;

test("suggest highlight wraps", () => {
  assert.equal(nextHi(-1, 3, 1), 0);
  assert.equal(nextHi(2, 3, 1), 0);
  assert.equal(nextHi(0, 3, -1), 2);
  assert.equal(nextHi(-1, 0, 1), -1);
});

test("skipCode treats 6-digit and prefixed codes as codes", () => {
  assert.equal(CODE_RE.test("600519"), true);
  assert.equal(CODE_RE.test("sh600519"), true);
  assert.equal(CODE_RE.test("茅台"), false);
});
