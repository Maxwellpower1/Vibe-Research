import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CTX = new URL("../src/lib/reviewContext.ts", import.meta.url);
const REVIEW = new URL("../src/pages/DailyReview.tsx", import.meta.url);
const ASK = new URL("../src/components/ui/AskAiButton.tsx", import.meta.url);
const HOOK = new URL("../src/hooks/useReviewData.ts", import.meta.url);

const src = await readFile(CTX, "utf8");
const reviewSrc = await readFile(REVIEW, "utf8");
const askSrc = await readFile(ASK, "utf8");
const hookSrc = await readFile(HOOK, "utf8");

const EXPECTED = [
  "全球指数",
  "涨跌分布",
  "涨跌停",
  "板块热点",
  "板块资金",
  "主力净流入",
  "个股榜单",
  "大宗商品",
  "实时热点",
  "自选",
  "龙虎榜",
  "资金利率",
];

function fmtSignedPct(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function fmtYi(v) {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

function take(rows, n) {
  return (rows ?? []).slice(0, n);
}

function missingPanels(text) {
  return EXPECTED.filter((name) => !text.includes(`【${name}】`));
}

test("fmtSignedPct keeps sign and placeholder", () => {
  assert.equal(fmtSignedPct(1.2), "+1.20%");
  assert.equal(fmtSignedPct(-0.5), "-0.50%");
  assert.equal(fmtSignedPct(0), "0.00%");
  assert.equal(fmtSignedPct(null), "—");
});

test("fmtYi compact units", () => {
  assert.equal(fmtYi(2.5e8), "2.50亿");
  assert.equal(fmtYi(-3.2e4), "-3万");
  assert.equal(fmtYi(0), "—");
});

test("take caps and treats null as empty", () => {
  assert.deepEqual(take([1, 2, 3, 4], 2), [1, 2]);
  assert.deepEqual(take(null, 3), []);
});

test("missingPanels lists every absent cockpit section", () => {
  assert.deepEqual(missingPanels(""), EXPECTED);
  assert.deepEqual(missingPanels("【全球指数】\n上证 +1%"), EXPECTED.filter((n) => n !== "全球指数"));
});

test("reviewContext packs every cockpit section and refuses to invent", () => {
  assert.match(src, /const EXPECTED = \[/);
  for (const name of EXPECTED) {
    assert.match(src, new RegExp(`"${name}"`));
  }
  assert.match(src, /【\$\{title\}】/);
  assert.match(src, /不要编造数字/);
  assert.match(src, /REVIEW_CONTEXT_MAX_CHARS\s*=\s*24_000/);
  assert.doesNotMatch(src, /NEWS_BODY/);
  assert.doesNotMatch(src, /extra\.slice\(0,\s*NEWS_BODY\)/);
  assert.match(src, /fetchCockpitLive/);
  assert.match(src, /peekQuotes/);
  assert.match(src, /peekTelegraphItems/);
  assert.match(src, /sectorBoards/);
  assert.match(src, /stockRank/);
  assert.match(src, /boardFlowIntraday/);
  assert.match(src, /clsTelegraph/);
  assert.match(src, /marketLives/);
  assert.match(src, /formatNewsLine/);
  assert.match(src, /newsTag/);
});

test("formatNewsLine keeps the full telegraph body", () => {
  function formatNewsLine(it) {
    const extra = (it.content || it.summary || "").replace(/\s+/g, " ").trim();
    const time = (it.time || "").slice(11, 16) || (it.time || "").slice(-8, -3);
    const body = extra && extra !== it.title ? extra : "";
    return { time, title: it.title, body: body || undefined };
  }
  const long = `${"降准释放长期资金。".repeat(20)}结尾。`;
  const line = formatNewsLine({
    title: "央行宣布降准",
    content: `  ${long}  `,
    time: "2026-08-16 14:32:00",
  });
  assert.equal(line.time, "14:32");
  assert.equal(line.title, "央行宣布降准");
  assert.equal(line.body, long);
  assert.ok(line.body.length > 80);
});

test("Daily Review and Ask AI send the packed snapshot, not the old index-only line", () => {
  assert.match(reviewSrc, /collectReviewContext/);
  assert.match(reviewSrc, /REVIEW_PROMPT_TASK/);
  assert.match(reviewSrc, /sectorKind/);
  assert.match(reviewSrc, /newsSource/);
  assert.doesNotMatch(reviewSrc, /今日大盘数据：\$\{d\.dataSummary\}/);
  assert.match(askSrc, /getContext\?:/);
  assert.match(askSrc, /await getContext\(\)/);
  assert.match(hookSrc, /buildReviewContext\(contextInput\)/);
  assert.match(hookSrc, /contextInput/);
});
