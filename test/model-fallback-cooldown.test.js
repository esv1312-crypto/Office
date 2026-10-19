import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("OpenRouter model gateway cools down timed-out and failing free models", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function generateWithOpenRouter");
  const end = source.indexOf("\nfunction normalizeHuggingFaceModel", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const gateway = source.slice(start, end);

  assert.match(gateway, /error\?\.status===408/);
  assert.match(gateway, /Number\(error\?\.status\)>=500/);
  assert.match(gateway, /timeout\|timed out\|abort/);
  assert.match(gateway, /suppressModel\(model,failureMessage[^\n]*5\*60\*1000/);
  assert.match(gateway, /empty response[^\n]*15\*60\*1000/);
});

test("Hugging Face model gateway cools down stale and temporarily failing models", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function generateWithHuggingFace");
  const end = source.indexOf("\nasync function generateWithApinex", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const gateway = source.slice(start, end);

  assert.match(gateway, /suppressModel\(model,failureMessage[^\n]*6\*60\*60\*1000,"huggingface"\)/);
  assert.match(gateway, /timeout\|timed out\|abort/);
  assert.match(gateway, /suppressModel\(model,failureMessage[^\n]*5\*60\*1000,"huggingface"\)/);
  assert.match(gateway, /gateway\.model_fallback/);
});
