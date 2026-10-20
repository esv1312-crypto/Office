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
