import test from "node:test";
import assert from "node:assert/strict";
import { buildDeterministicRecoveryPlan } from "../src/planner-recovery.js";

test("deterministic recovery respects an explicit exact-role delegation constraint", () => {
  const task = "SMOKE TEST — READ-ONLY EVIDENCE PIPELINE.\nRequirements:\n- Delegate exactly two subtasks: Analyst and Developer. Do not create Verifier or Executor subtasks.";
  const plan = buildDeterministicRecoveryPlan(task);
  assert.deepEqual(plan.subtasks.map(item => item.employeeId), ["analyst", "developer"]);
  assert.equal(plan.subtasks.length, 2);
});

test("deterministic recovery keeps its safe default when no exact-role constraint is supplied", () => {
  const plan = buildDeterministicRecoveryPlan("Review the current runtime and report evidence.");
  assert.deepEqual(plan.subtasks.map(item => item.employeeId), ["analyst", "developer", "verifier", "executor"]);
});

test("malformed exact-role constraints fall back safely instead of silently creating a partial plan", () => {
  const plan = buildDeterministicRecoveryPlan("Delegate exactly three subtasks: Analyst and Developer.");
  assert.deepEqual(plan.subtasks.map(item => item.employeeId), ["analyst", "developer", "verifier", "executor"]);
});
