import test from "node:test";
import assert from "node:assert/strict";
import { assertTaskTransitionAllowed, TASK_STATES } from "../src/task-state.js";

test("task state policy contains the expected lifecycle states", () => {
  assert.deepEqual([...TASK_STATES], ["accepted", "planning", "running", "waiting", "completed", "failed", "cancelled"]);
});

test("normal task lifecycle transitions are allowed", () => {
  assert.equal(assertTaskTransitionAllowed("accepted", "planning"), true);
  assert.equal(assertTaskTransitionAllowed("planning", "running"), true);
  assert.equal(assertTaskTransitionAllowed("running", "waiting"), true);
  assert.equal(assertTaskTransitionAllowed("waiting", "running"), true);
  assert.equal(assertTaskTransitionAllowed("running", "completed"), true);
});

test("failed tasks can be retried or cancelled", () => {
  assert.equal(assertTaskTransitionAllowed("failed", "running"), true);
  assert.equal(assertTaskTransitionAllowed("failed", "planning"), true);
  assert.equal(assertTaskTransitionAllowed("failed", "cancelled"), true);
});

test("completed and cancelled tasks are terminal", () => {
  assert.throws(() => assertTaskTransitionAllowed("completed", "running"), /Invalid task transition/);
  assert.throws(() => assertTaskTransitionAllowed("cancelled", "running"), /Invalid task transition/);
});

test("invalid and unknown states are rejected", () => {
  assert.throws(() => assertTaskTransitionAllowed("running", "queued"), /Invalid task state/);
  assert.throws(() => assertTaskTransitionAllowed("mystery", "running"), /Invalid task transition/);
});

test("idempotent same-state updates are allowed", () => {
  for (const state of TASK_STATES) assert.equal(assertTaskTransitionAllowed(state, state), true);
});
