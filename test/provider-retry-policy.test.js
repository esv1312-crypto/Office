import test from "node:test";
import assert from "node:assert/strict";
import { shouldStopOpenRouterFallback, modelCooldownMs } from "../src/provider-retry-policy.js";

test("OpenRouter stops immediately on authentication failure", () => {
  assert.equal(shouldStopOpenRouterFallback(401), true);
});

test("OpenRouter tries alternate free models after route-level payment/rate errors", () => {
  assert.equal(shouldStopOpenRouterFallback(402), false);
  assert.equal(shouldStopOpenRouterFallback(429), false);
  assert.equal(shouldStopOpenRouterFallback(503), false);
});

import { shouldSuppressProviderForStatus } from "../src/provider-retry-policy.js";

test("OpenRouter route quota/rate errors do not suppress every model", () => {
  assert.equal(shouldSuppressProviderForStatus("openrouter", 402), false);
  assert.equal(shouldSuppressProviderForStatus("openrouter", 429), false);
  assert.equal(shouldSuppressProviderForStatus("openrouter", 401), true);
});

test("other providers retain provider-wide quota/rate suppression", () => {
  assert.equal(shouldSuppressProviderForStatus("gemini", 402), true);
  assert.equal(shouldSuppressProviderForStatus("gemini", 429), true);
  assert.equal(shouldSuppressProviderForStatus("huggingface", 401), true);
  assert.equal(shouldSuppressProviderForStatus("openrouter", 503), false);
});


test("ordinary gateway routing skips providers already under cooldown", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function generateViaLocalGateway");
  const end = source.indexOf("\nasync function generateViaGateway", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const gateway = source.slice(start, end);
  assert.match(gateway, /!Array\.isArray\(forcedProvider\)\s*&&\s*isProviderSuppressed\(provider\)/);
  assert.match(gateway, /gateway\.provider_skipped/);
  assert.match(gateway, /ALL_PROVIDERS_SUPPRESSED/);
});


test("explicitly restricted and stale free routes receive long model cooldowns", () => {
  const sixHours=6*60*60*1000;
  assert.equal(modelCooldownMs(403,"This model is only available on agentic harnesses"),sixHours);
  assert.equal(modelCooldownMs(404,"This model is unavailable for free"),sixHours);
  assert.equal(modelCooldownMs(400,"Provider returned error"),15*60*1000);
});

test("empty responses and temporary outages receive bounded short cooldowns", () => {
  assert.equal(modelCooldownMs(null,"openrouter returned an empty response"),60*1000);
  assert.equal(modelCooldownMs(503,"upstream unavailable"),2*60*1000);
  assert.equal(modelCooldownMs(429,"rate limited"),60*1000);
});
