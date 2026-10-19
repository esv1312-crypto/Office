import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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


test("runtime worker, provider and recovery settings use bounded parsing", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /limit:boundedIntegerSetting\(process\.env\.MAX_CONCURRENT_WORKERS,3,1,100\)/);
  assert.match(server, /workerWatchdogIntervalMs=boundedIntegerSetting\(process\.env\.WORKER_WATCHDOG_INTERVAL_MS,15000,5000,3600000\)/);
  assert.match(server, /workerTimeoutMs=boundedIntegerSetting\(process\.env\.WORKER_TIMEOUT_MS,600000,30000,86400000\)/);
  assert.match(server, /maxToolRounds=boundedIntegerSetting\(process\.env\.AI_TOOL_MAX_ROUNDS,6,1,8\)/);
  assert.match(server, /MAX_RECOVERY_ATTEMPTS,1,20\)/);
  assert.match(server, /MAX_WORKER_REPLACEMENTS,2,0,20\)/);
});
