import test from "node:test";
import assert from "node:assert/strict";
import { assertTaskTransitionAllowed, normalizeTaskSnapshotAfterRestart, TASK_STATES } from "../src/task-state.js";

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

test("planning and running tasks are marked interrupted after restart", () => {
  for (const status of ["planning", "running"]) {
    const { record, changed } = normalizeTaskSnapshotAfterRestart({
      id: "task-1",
      status,
      startedAt: "2026-01-01T00:00:00.000Z",
      children: [{ id: "child" }]
    }, "2026-10-19T12:00:00.000Z");

    assert.equal(changed, true);
    assert.equal(record.status, "failed");
    assert.equal(record.error, "SERVICE_RESTART_INTERRUPTED");
    assert.equal(record.failedAt, "2026-10-19T12:00:00.000Z");
    assert.equal(record.startedAt, null);
    assert.equal(record.completedAt, null);
    assert.equal(record.restartInterrupted, true);
    assert.equal("children" in record, false);
  }
});

test("waiting tasks remain waiting but clear stale start timestamps", () => {
  const { record, changed } = normalizeTaskSnapshotAfterRestart({
    id: "task-2",
    status: "waiting",
    startedAt: "2026-01-01T00:00:00.000Z"
  }, "2026-10-19T12:00:00.000Z");

  assert.equal(changed, true);
  assert.equal(record.status, "waiting");
  assert.equal(record.startedAt, null);
  assert.equal(record.waitingReason, "service_restart");
});

test("terminal tasks are not rewritten during restart normalization", () => {
  const { record, changed } = normalizeTaskSnapshotAfterRestart({
    id: "task-3",
    status: "completed",
    completedAt: "2026-10-18T12:00:00.000Z"
  });

  assert.equal(changed, false);
  assert.equal(record.status, "completed");
  assert.equal(record.completedAt, "2026-10-18T12:00:00.000Z");
});
