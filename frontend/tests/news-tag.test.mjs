import assert from "node:assert/strict";
import test from "node:test";

const CHAINS = [
  { name: "大模型", keywords: ["大模型", "AI", "人工智能", "算力"] },
  { name: "半导体", keywords: ["半导体", "芯片", "光刻"] },
];
const MACRO = ["央行", "美联储", "降息", "CPI", "汇率"];

function newsTag(title, extra = "") {
  const text = `${title}${extra}`;
  for (const c of CHAINS) {
    if (c.keywords.some((k) => k && text.includes(k))) return { label: c.name, color: "#22d3ee" };
  }
  if (MACRO.some((k) => text.includes(k))) return { label: "宏观", color: "#fbbf24" };
  if (/MLF|LPR/.test(text)) return { label: "政策", color: "#fbbf24" };
  return null;
}

test("newsTag prefers chain over macro", () => {
  const t = newsTag("算力集群扩产, 央行同步表态");
  assert.equal(t?.label, "大模型");
});

test("newsTag marks macro and policy", () => {
  assert.equal(newsTag("美联储维持利率").label, "宏观");
  assert.equal(newsTag("1年期LPR报价出炉").label, "政策");
});

test("newsTag returns null when no keyword", () => {
  assert.equal(newsTag("某公司发布日常公告"), null);
});
