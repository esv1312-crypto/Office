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

  assert.ok(gateway.includes("finalError?.status===408"));
  assert.ok(gateway.includes("Number(finalError?.status)>=500"));
  assert.match(gateway, /timeout\\|timed out\\|abort/);
  assert.match(gateway, /cooldownMs=.*60\*1000/);
  assert.match(gateway, /empty response.*60\*1000/);
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


test("successful OpenRouter retry clears failure suppression and restores qualification", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function generateWithOpenRouter");
  const end = source.indexOf("\\nfunction normalizeHuggingFaceModel", start);
  const gateway = source.slice(start, end);
  const retrySuccess = gateway.indexOf("A successful retry is positive runtime evidence");
  const qualificationRestore = gateway.indexOf('recordModelQualification({provider:"openrouter",model,role,ok:true', retrySuccess);
  const suppressionClear = gateway.indexOf('modelSuppressions.delete("openrouter:"+model)', retrySuccess);
  const returnRetry = gateway.indexOf("return retry;", retrySuccess);
  assert.ok(retrySuccess >= 0 && qualificationRestore > retrySuccess && suppressionClear > qualificationRestore && returnRetry > suppressionClear);
  assert.match(gateway, /const fallbackLimit=boundedIntegerSetting\(process\.env\.OPENROUTER_MAX_MODEL_FALLBACKS,8,2,20\)/);
  assert.match(gateway, /const readiness=await preflightModel\("openrouter",model,employee\)/);
});
