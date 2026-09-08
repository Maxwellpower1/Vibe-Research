import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const LLM = new URL("../src/lib/llm.ts", import.meta.url);
const SETTINGS = new URL("../src/pages/Settings.tsx", import.meta.url);
const ASK = new URL("../src/components/ui/AskAiButton.tsx", import.meta.url);

const llmSrc = await readFile(LLM, "utf8");
const settingsSrc = await readFile(SETTINGS, "utf8");
const askSrc = await readFile(ASK, "utf8");

test("probe is a separate endpoint from chat", () => {
  assert.match(llmSrc, /\/api\/llm-probe/);
  assert.match(llmSrc, /export async function probeLlm/);
  assert.match(llmSrc, /\/api\/chat/);
  assert.match(llmSrc, /export async function chatStream/);
});

test("settings test-and-save uses probe, not chat", () => {
  assert.match(settingsSrc, /probeLlm/);
  assert.match(settingsSrc, /测试并保存/);
  assert.match(settingsSrc, /仅保存/);
  assert.doesNotMatch(settingsSrc, /\/api\/chat/);
  assert.doesNotMatch(settingsSrc, /chatStream/);
});

test("ask AI still talks to /api/chat via chatStream", () => {
  assert.match(askSrc, /chatStream/);
  assert.doesNotMatch(askSrc, /\/api\/llm-probe/);
});
