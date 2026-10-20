import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("deterministic planner recovery honors explicit exact-role delegation constraints", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('const explicitConstraint=String(record.task||"").match(');
  const end = source.indexOf('      };', start);
  assert.notEqual(start, -1, "explicit delegation constraint parser must exist");
  assert.notEqual(end, -1, "deterministic recovery plan must close");
  const recovery = source.slice(start, end);

  assert.match(recovery, /delegate exactly/);
  assert.match(recovery, /explicitCount\\s*>=\\s*1\\s*&&\\s*explicitCount\\s*<=\\s*4/);
  assert.match(recovery, /recoveryWorkers\.filter/);
  assert.match(recovery, /constrainedWorkers\.length===explicitCount/);
  assert.match(recovery, /subtasks:useConstraint \? constrainedWorkers : recoveryWorkers/);
});

test("planner recovery preserves the four-role safe default when constraints are absent or malformed", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /const useConstraint=constrainedWorkers\.length===explicitCount/);
  assert.match(source, /subtasks:useConstraint \? constrainedWorkers : recoveryWorkers/);
});
