import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

test("default employees do not pin a potentially stale free model", () => {
  const start = source.indexOf("const DEFAULT_EMPLOYEES = [");
  const end = source.indexOf("\n];", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const defaults = source.slice(start, end);
  assert.doesNotMatch(defaults, /minimax\/minimax-m3\.1-flash:free/);
  assert.match(defaults, /model:null/);
});

test("free-only mode serializes worker execution regardless of a higher concurrency env value", () => {
  assert.match(source, /limit:freeOnly\(\)\?1:boundedIntegerSetting\(process\.env\.MAX_CONCURRENT_WORKERS,3,1,100\)/);
});

test("employee-assigned models must exist in the current provider catalog and obey free-only routing", () => {
  assert.match(source, /const catalogModels=getCandidatePool\(employee,assignedProvider\)/);
  assert.match(source, /const assignedIsAllowed=!freeOnly\(\) \|\| \(assignedProvider==="openrouter" && assignedModel\.endsWith\(":free"\)\)/);
  assert.match(source, /catalogModels\.includes\(assignedModel\)/);
});

test("model prompts forbid inventing tools and explain unavailable tools", () => {
  assert.match(source, /Never invent or call tools, APIs, or function names that were not provided/);
  assert.match(source, /If a needed tool is not listed, state that it is unavailable/);
});

test("runtime rejects tool calls that were not advertised to the employee", () => {
  assert.match(source, /const availableTools=toolSchemasForEmployee\(getEmployee\(employeeId\|\|"executor"\)\)/);
  assert.match(source, /TOOL_NOT_AVAILABLE/);
});
