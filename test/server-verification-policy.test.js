import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("root task completion cannot bypass independent verification", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /let verificationPassed\s*=\s*await verifyRootTask\(record\)/);
  assert.doesNotMatch(source, /verificationPassed\s*=\s*true/);
  assert.doesNotMatch(source, /verifierId\s*:\s*["']runtime-objective-check["']/);
});
