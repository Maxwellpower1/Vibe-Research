import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CTX = new URL("../src/lib/reviewContext.ts", import.meta.url);
const REVIEW = new URL("../src/pages/DailyReview.tsx", import.meta.url);
const ASK = new URL("../src/components/ui/AskAiButton.tsx", import.meta.url);
const HOOK = new URL("../src/hooks/useReviewData.ts", import.meta.url);
const API = new URL("../src/lib/api.ts", import.meta.url);
const COCKPIT = new URL("../src/config/cockpit.ts", import.meta.url);
const CATALOG = new URL("../../backend/index_catalog.py", import.meta.url);

const src = await readFile(CTX, "utf8");
const reviewSrc = await readFile(REVIEW, "utf8");
const askSrc = await readFile(ASK, "utf8");
const hookSrc = await readFile(HOOK, "utf8");
const apiSrc = await readFile(API, "utf8");
const cockpitSrc = await readFile(COCKPIT, "utf8");
const catalogSrc = await readFile(CATALOG, "utf8");

test("reviewContext is a thin client of the backend packer", () => {
  assert.match(src, /api\.reviewContext/);
  assert.match(src, /watch_codes/);
  assert.doesNotMatch(src, /const EXPECTED/);
  assert.doesNotMatch(src, /assembleReviewContext/);
  assert.doesNotMatch(src, /fetchCockpitLive/);
  assert.doesNotMatch(src, /fmtSignedPct/);
  assert.match(apiSrc, /\/market\/review-context/);
});

test("Daily Review and Ask AI send the packed snapshot", () => {
  assert.match(reviewSrc, /collectReviewContext/);
  assert.match(reviewSrc, /api\.reviewContext/);
  assert.match(reviewSrc, /prompt_task/);
  assert.match(reviewSrc, /sectorKind/);
  assert.match(reviewSrc, /newsSource/);
  assert.doesNotMatch(reviewSrc, /今日大盘数据：\$\{d\.dataSummary\}/);
  assert.match(askSrc, /getContext\?:/);
  assert.match(askSrc, /await getContext\(\)/);
  assert.doesNotMatch(hookSrc, /buildReviewContext/);
});

test("frontend WORLD_INDEX_DEFS matches backend index_catalog", () => {
  const fe = [...cockpitSrc.matchAll(/code:\s*"([^"]+)"/g)].map((m) => m[1]).slice(0, 14);
  const be = [...catalogSrc.matchAll(/\("([A-Za-z0-9]+)",\s*"[^"]+",\s*"(?:CN|HK|US|FX)"\)/g)].map((m) => m[1]);
  assert.deepEqual(fe, be);
  assert.ok(fe.includes("sh000905"));
  assert.ok(!fe.includes("sh000852"));
});
