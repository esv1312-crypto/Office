import test from "node:test";
import assert from "node:assert/strict";
import { isZeroPrice, isUsableFreeModel, resolveProviderDiscovery } from "../src/model-scout.js";

test("explicit zero input and output pricing is free", () => {
  assert.equal(isZeroPrice({ input: "0", output: "0" }), true);
  assert.equal(isZeroPrice({ prompt: 0, completion: 0 }), true);
});

test("missing or null prices are not proof of a free model", () => {
  assert.equal(isZeroPrice({}), false);
  assert.equal(isZeroPrice({ input: null, output: null }), false);
  assert.equal(isZeroPrice({ input: 0 }), false);
  assert.equal(isZeroPrice(null), false);
});

test("explicit free model suffix is accepted unless expired", () => {
  assert.equal(isUsableFreeModel({ id: "vendor/model:free" }), true);
  assert.equal(isUsableFreeModel({ id: "vendor/model:free", expiration_date: "2000-01-01" }), false);
});

test("zero pricing requires both input and output prices", () => {
  assert.equal(isUsableFreeModel({ id: "vendor/model", pricing: { input: 0, output: 0 } }), true);
  assert.equal(isUsableFreeModel({ id: "vendor/model", pricing: { input: 0 } }), false);
});

import { normalizeApinexModels } from "../src/model-scout.js";

test("APINEX discovery includes only explicitly free model IDs", () => {
  const models = normalizeApinexModels({ data: [
    { id: "free/gpt-6-luna", context_length: 100000 },
    { id: "free/kimi-k3" },
    { id: "gpt-6-astra" },
    { id: "deepseek-v4-flash", pricing: { input: 0, output: 0 } },
    { id: "free/expired-model", expiration_date: "2000-01-01" }
  ] });

  assert.deepEqual(models.map(model => model.id), ["free/gpt-6-luna", "free/kimi-k3"]);
  assert.ok(models.every(model => model.provider === "apinex"));
  assert.ok(models.every(model => model.qualification === "discovered_unverified"));
});

test("model catalog fetch aborts when the configured timeout elapses", async () => {
  const { fetchJson } = await import("../src/model-scout.js");
  await assert.rejects(
    fetchJson("https://catalog.example/models", {
      timeoutMs: 1000,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("request aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      })
    }),
    error => error.name === "AbortError"
  );
});


test("provider discovery failure preserves the last successful model snapshot", () => {
  const previous = [{ id: "provider/model:free" }];
  const failed = resolveProviderDiscovery(previous, { status: "rejected", reason: new Error("HTTP 429 rate limit") });
  assert.equal(failed.ok, false);
  assert.equal(failed.models, previous);
  assert.match(failed.error, /429/);

  const succeeded = resolveProviderDiscovery(previous, { status: "fulfilled", value: [] });
  assert.equal(succeeded.ok, true);
  assert.deepEqual(succeeded.models, []);
  assert.equal(succeeded.error, null);
});
