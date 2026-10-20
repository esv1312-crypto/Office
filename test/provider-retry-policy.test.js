import test from "node:test";
import assert from "node:assert/strict";
import { shouldStopOpenRouterFallback } from "../src/provider-retry-policy.js";

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
