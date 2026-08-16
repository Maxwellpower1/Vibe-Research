import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CHART = new URL("../src/pages/AShareLightChart.tsx", import.meta.url);
const FEED = new URL("../src/components/WatchlistFeed.tsx", import.meta.url);

const chartSrc = await readFile(CHART, "utf8");
const feedSrc = await readFile(FEED, "utf8");

test("K-line page and watchlist feed subscribe to the quote hub", () => {
  assert.match(chartSrc, /useQuotes\(codes\)/);
  assert.doesNotMatch(chartSrc, /api\.quote\(/);
  assert.match(feedSrc, /useQuotes\(codes\)/);
  assert.doesNotMatch(feedSrc, /api\.quote\(/);
});
