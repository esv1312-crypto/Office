import test from "node:test";
import assert from "node:assert/strict";
import { boundedIntegerSetting } from "../src/runtime-config.js";

test("numeric runtime settings use defaults for missing or invalid values", () => {
  assert.equal(boundedIntegerSetting(undefined, 3, 1, 100), 3);
  assert.equal(boundedIntegerSetting("", 3, 1, 100), 3);
  assert.equal(boundedIntegerSetting("abc", 3, 1, 100), 3);
  assert.equal(boundedIntegerSetting("Infinity", 3, 1, 100), 3);
  assert.equal(boundedIntegerSetting("NaN", 3, 1, 100), 3);
});

test("numeric runtime settings clamp to safe bounds and integers", () => {
  assert.equal(boundedIntegerSetting("0", 3, 1, 100), 1);
  assert.equal(boundedIntegerSetting("-4", 3, 1, 100), 1);
  assert.equal(boundedIntegerSetting("2.9", 3, 1, 100), 2);
  assert.equal(boundedIntegerSetting("999", 3, 1, 100), 100);
  assert.equal(boundedIntegerSetting("5000", 15000, 5000, 3600000), 5000);
});
