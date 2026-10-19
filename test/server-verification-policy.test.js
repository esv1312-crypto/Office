import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("root task completion cannot bypass independent verification", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /let verificationPassed\s*=\s*await verifyRootTask\(record\)/);
  assert.doesNotMatch(source, /verificationPassed\s*=\s*true/);
  assert.doesNotMatch(source, /verifierId\s*:\s*["']runtime-objective-check["']/);
});

test("root recovery replaces the stale result before independent retesting", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function recoverRootTask(record)");
  const end = source.indexOf("\nfunction buildPlanningPrompt", start);
  assert.notEqual(start, -1, "recoverRootTask must exist");
  assert.notEqual(end, -1, "recovery function boundary must exist");
  const recovery = source.slice(start, end);
  const resultIndex = recovery.indexOf("record.result=recoveredResult");
  const verifierIndex = recovery.indexOf("await verifyRootTask(record)");

  assert.ok(resultIndex >= 0, "recovery result must replace the stale root result");
  assert.ok(resultIndex < verifierIndex, "the recovered result must be installed before verification");
  assert.match(recovery, /record\.model=fixTask\.model \|\| record\.model/);
  assert.match(recovery, /if\s*\(!recoveredResult\)/);
});

test("remote backend calls forward the audit token in a header, never in the URL", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("function generateViaGateway");
  const end = source.indexOf("\nconst TOOL_REGISTRY", start);
  assert.notEqual(start, -1, "generateViaGateway must exist");
  assert.notEqual(end, -1, "gateway function boundary must exist");
  const gateway = source.slice(start, end);

  assert.match(gateway, /backendHeaders\["x-ai-office-audit-token"\]\s*=\s*auditToken/);
  assert.match(gateway, /fetch\(base\s*\+\s*["']\/api\/backend\/generate["']/);
  assert.match(gateway, /headers:\s*backendHeaders/);
  assert.doesNotMatch(gateway, /[?&]token=\$\{?auditToken/);
});
