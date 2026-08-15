import assert from "node:assert/strict";
import test from "node:test";

function toMinute(t) {
  const s = (t || "").trim();
  const colon = s.match(/(\d{1,2}):(\d{2})/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const compact = s.match(/(?:^|[\sT])(\d{4})(?:\D|$)/);
  if (compact) {
    const hhmm = compact[1];
    return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
  }
  return NaN;
}

function sparkXs(times, n, width, session = "ashare") {
  const even = () => Array.from({ length: n }, (_, i) => (n <= 1 ? 1 : 1 + (i / (n - 1)) * (width - 2)));
  if (n < 2) return even();
  if (session === "daily" || !times || times.length !== n) return even();
  let xs;
  if (session === "h24") {
    const gapMin = 5;
    const tl = [0];
    for (let i = 1; i < n; i++) {
      let d = toMinute(times[i] || "") - toMinute(times[i - 1] || "");
      if (d < -720) d += 1440;
      if (d < 0 || d > gapMin) d = 1;
      tl.push(tl[i - 1] + d);
    }
    const span = Math.max(tl[tl.length - 1], 1);
    xs = tl.map((v) => (v / span) * (width - 2) + 1);
  } else {
    const open = 9 * 60 + 30;
    const lunchS = 11 * 60 + 30;
    const lunchE = 13 * 60;
    const sessionMin = 240;
    xs = times.map((t) => {
      const m = toMinute(t || "");
      let e = m - open;
      if (m >= lunchE) e -= lunchE - lunchS;
      return (Math.max(0, Math.min(e, sessionMin)) / sessionMin) * (width - 2) + 1;
    });
  }
  if (xs.some((x) => !Number.isFinite(x))) return even();
  return xs;
}

test("ashare lunch maps 11:30 and 13:00 to the same x", () => {
  const xs = sparkXs(["09:30", "11:30", "13:00", "15:00"], 4, 242, "ashare");
  assert.equal(xs[0], 1);
  assert.equal(xs[1], xs[2]);
  assert.equal(xs[3], 241);
});

test("h24 compresses a multi-hour gap", () => {
  const xs = sparkXs(["21:00", "21:01", "09:00", "09:01"], 4, 242, "h24");
  const stepOpen = xs[1] - xs[0];
  const stepGap = xs[2] - xs[1];
  assert.ok(stepGap <= stepOpen + 1e-6);
});

test("toMinute reads datetime and compact hhmm", () => {
  assert.equal(toMinute("2026-08-15 09:31"), 9 * 60 + 31);
  assert.equal(toMinute("0931"), 9 * 60 + 31);
});
