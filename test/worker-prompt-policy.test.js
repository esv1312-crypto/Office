import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("worker evidence prompts adapt to domain tasks without inventing source paths", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("function buildWorkerPrompt(record,employee)");
  const end = source.indexOf("\nasync function executeWorkerTask(record)", start);
  assert.notEqual(start, -1, "buildWorkerPrompt must exist");
  assert.notEqual(end, -1, "worker prompt boundary must exist");
  const prompt = source.slice(start, end);
  assert.match(prompt, /const codeEvidenceTask=\/\\b\(code\|coding\|repository/);
  assert.match(prompt, /exact source path/);
  assert.match(prompt, /provided task brief, general domain knowledge, or an inference/);
  assert.match(prompt, /Never invent URLs, source documents, statistics, prices, market shares, companies, or evidence/);
  assert.match(prompt, /If no external sources were consulted, say so explicitly in the index/);
  assert.match(prompt, /actual source or honest basis/);
});
