import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CHART = new URL("../src/pages/AShareLightChart.tsx", import.meta.url);
const FEED = new URL("../src/components/WatchlistFeed.tsx", import.meta.url);
const QUOTE = new URL("../src/lib/quoteHub.ts", import.meta.url);
const MINUTE = new URL("../src/lib/minuteHub.ts", import.meta.url);
const WORLD = new URL("../src/components/cockpit/WorldIndexPanel.tsx", import.meta.url);
const SESSION = new URL("../src/lib/ashareSession.ts", import.meta.url);
const DIRECT = new URL("../src/lib/tencentDirect.ts", import.meta.url);

const chartSrc = await readFile(CHART, "utf8");
const feedSrc = await readFile(FEED, "utf8");
const quoteSrc = await readFile(QUOTE, "utf8");
const minuteSrc = await readFile(MINUTE, "utf8");
const worldSrc = await readFile(WORLD, "utf8");
const sessionSrc = await readFile(SESSION, "utf8");
const directSrc = await readFile(DIRECT, "utf8");

test("K-line page and watchlist feed subscribe to the quote hub", () => {
  assert.match(chartSrc, /useQuotes\(codes\)/);
  assert.doesNotMatch(chartSrc, /api\.quote\(/);
  assert.match(feedSrc, /useQuotes\(codes\)/);
  assert.doesNotMatch(feedSrc, /api\.quote\(/);
});

test("quote and minute hubs stretch the interval when A-share is not open", () => {
  assert.match(sessionSrc, /export const HUB_POLL_CLOSED_MS = 60_000/);
  assert.match(sessionSrc, /export function hubPollMs/);
  assert.match(sessionSrc, /primeTradingDay/);
  assert.match(sessionSrc, /reviewWarmup/);
  assert.match(quoteSrc, /hubPollMs\(QUOTE_POLL_MS\)/);
  assert.match(minuteSrc, /hubPollMs\(MINUTE_POLL_MS\)/);
  assert.match(quoteSrc, /primeTradingDay/);
  assert.match(minuteSrc, /primeTradingDay/);
  assert.doesNotMatch(quoteSrc, /setInterval/);
  assert.doesNotMatch(minuteSrc, /setInterval/);
});

test("browser-direct Tencent fallback keeps PE/PB/total mcap", () => {
  assert.match(directSrc, /pe_ttm/);
  assert.match(directSrc, /mcap_yi/);
  assert.match(directSrc, /f\[39\]/);
  assert.match(directSrc, /f\[45\]/);
  assert.match(directSrc, /f\[46\]/);
  assert.match(chartSrc, /selQuote\?\.mcap_yi/);
});

test("world index minutes subscribe to the minute hub", () => {
  assert.match(worldSrc, /useMinutes\(KLINE_SYMS\)/);
  assert.doesNotMatch(worldSrc, /loadLightKlineBatch/);
  assert.doesNotMatch(worldSrc, /usePolling/);
});
