import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("OpenRouter model gateway delegates model cooldown decisions to the shared retry policy", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function generateWithOpenRouter");
  const end = source.indexOf("\\nfunction normalizeHuggingFaceModel", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const gateway = source.slice(start, end);

  assert.ok(source.includes("modelCooldownMs"));
  assert.match(gateway, /modelCooldownMs\\(finalError\\?\\.status,failureMessage\\)/);
  assert.match(gateway, /suppressModel\\(model,failureMessage,cooldownMs,"openrouter"\\)/);
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
  assert.match(gateway, /15\*60\*1000:5\*60\*1000/);
  assert.match(gateway, /gateway\.model_fallback/);
});


test("Gemini quota exhaustion receives a long provider cooldown instead of a 60-second retry loop", async () => {
  const { providerCooldownMs } = await import("../src/provider-retry-policy.js");
  assert.equal(providerCooldownMs("gemini", 429, "Quota exceeded for free tier"), 12 * 60 * 60 * 1000);
  assert.equal(providerCooldownMs("gemini", 400, "RESOURCE_EXHAUSTED: quota exceeded"), 12 * 60 * 60 * 1000);
  assert.equal(providerCooldownMs("openrouter", 429, "rate limit"), 60 * 1000);
  assert.equal(providerCooldownMs("gemini", 500, "temporary server error"), 15 * 60 * 1000);
});


test("OpenRouter empty completions immediately fall through to another candidate", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function generateWithOpenRouter");
  const end = source.indexOf("\nfunction normalizeHuggingFaceModel", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const gateway = source.slice(start, end);
  assert.match(gateway, /empty completion is evidence that this route is not usable/);
  assert.doesNotMatch(gateway, /const retry=await callOpenAICompatible/);
  assert.match(gateway, /const fallbackLimit=boundedIntegerSetting\(process\.env\.OPENROUTER_MAX_MODEL_FALLBACKS,12,8,20\)/);
  assert.match(gateway, /Send the real task immediately/);
  assert.doesNotMatch(gateway, /const readiness=await preflightModel\("openrouter",model,employee\)/);
});


test("free OpenRouter requests always set a bounded output token budget", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.ok(source.includes('provider==="openrouter"&&!paidTestEnabled()?{max_tokens:boundedIntegerSetting(process.env.OPENROUTER_MAX_OUTPUT_TOKENS,2048,256,8192)}:{}'));
});
