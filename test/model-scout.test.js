import test from "node:test";
import assert from "node:assert/strict";
import { isZeroPrice, isUsableFreeModel } from "../src/model-scout.js";

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
