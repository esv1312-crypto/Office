import test from "node:test";
import assert from "node:assert/strict";
import { assertTaskTransitionAllowed, normalizeTaskSnapshotAfterRestart, validateSubtaskBatch, TASK_STATES, getWatchdogTimeoutAge, isVerificationCompletionEligible, applyPersistedTaskTransition } from "../src/task-state.js";

test("task state policy contains the expected lifecycle states", () => {
  assert.deepEqual([...TASK_STATES], ["accepted", "planning", "running", "waiting", "completed", "failed", "cancelled"]);
});

test("normal task lifecycle transitions are allowed", () => {
  assert.equal(assertTaskTransitionAllowed("accepted", "planning"), true);
  assert.equal(assertTaskTransitionAllowed("planning", "running"), true);
  assert.equal(assertTaskTransitionAllowed("running", "waiting"), true);
  assert.equal(assertTaskTransitionAllowed("waiting", "running"), true);
  assert.equal(assertTaskTransitionAllowed("waiting", "planning"), true);
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

test("accepted, planning, and running tasks are marked interrupted after restart", () => {
  for (const status of ["accepted", "planning", "running"]) {
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

test("configuration-blocked waiting tasks remain waiting after restart", () => {
  const { record, changed } = normalizeTaskSnapshotAfterRestart({
    id: "task-2",
    status: "waiting",
    waitingReason: "ai_not_configured",
    startedAt: "2026-01-01T00:00:00.000Z"
  }, "2026-10-19T12:00:00.000Z");

  assert.equal(changed, true);
  assert.equal(record.status, "waiting");
  assert.equal(record.startedAt, null);
  assert.equal(record.waitingReason, "ai_not_configured");
});

test("parent tasks waiting on in-memory subtasks fail clearly after restart", () => {
  const { record, changed } = normalizeTaskSnapshotAfterRestart({
    id: "task-parent",
    status: "waiting",
    waitingReason: "subtasks_running",
    startedAt: "2026-10-19T11:59:00.000Z",
    subtaskIds: ["task-child"]
  }, "2026-10-19T12:00:00.000Z");

  assert.equal(changed, true);
  assert.equal(record.status, "failed");
  assert.equal(record.error, "SERVICE_RESTART_INTERRUPTED");
  assert.equal(record.failedAt, "2026-10-19T12:00:00.000Z");
  assert.equal(record.startedAt, null);
  assert.equal(record.completedAt, null);
  assert.equal(record.restartInterrupted, true);
  assert.equal(record.waitingReason, null);
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


test("subtask batch validation is atomic and rejects empty or malformed batches before creation", () => {
  assert.deepEqual(validateSubtaskBatch([{task:"first"},{task:"second"}]), {
    ok:true,
    items:[{task:"first"},{task:"second"}]
  });
  assert.deepEqual(validateSubtaskBatch([{task:"first"},{task:"   "}]), {
    ok:false,
    error:"each subtask requires task"
  });
  assert.deepEqual(validateSubtaskBatch([]), {
    ok:false,
    error:"at least one subtask is required"
  });
  assert.deepEqual(validateSubtaskBatch(undefined, {task:"  single task  "}), {
    ok:true,
    items:[{task:"single task"}]
  });
});


test("watchdog eligibility is deterministic at the timeout boundary", () => {
  const record = { id: "worker-1", kind: "worker", status: "running", startedAt: "2026-10-20T12:00:00.000Z" };
  const startedAt = Date.parse(record.startedAt);
  assert.equal(getWatchdogTimeoutAge(record, startedAt + 999, 1000), null);
  assert.equal(getWatchdogTimeoutAge(record, startedAt + 1000, 1000), 1000);
  assert.equal(getWatchdogTimeoutAge(record, startedAt + 2500, 1000), 2500);
});

test("watchdog ignores root, terminal, unstarted, invalid-time, and already-marked tasks", () => {
  const now = Date.parse("2026-10-20T12:10:00.000Z");
  const base = { kind: "worker", status: "running", startedAt: "2026-10-20T12:00:00.000Z" };
  for (const record of [
    { ...base, kind: "root" },
    { ...base, status: "completed" },
    { ...base, status: "failed" },
    { ...base, startedAt: null },
    { ...base, startedAt: "not-a-date" },
    { ...base, watchdogFailedAt: "2026-10-20T12:09:00.000Z" },
  ]) assert.equal(getWatchdogTimeoutAge(record, now, 1000), null);
  assert.equal(getWatchdogTimeoutAge({ ...base, status: "waiting" }, now, 1000), 600000);
});


test("root completion requires explicit PASS and every verification check to pass", () => {
  assert.equal(isVerificationCompletionEligible(null), false);
  assert.equal(isVerificationCompletionEligible({ status: "DEGRADED", checks: [{ passed: true }] }), false);
  assert.equal(isVerificationCompletionEligible({ status: "FAIL", checks: [{ passed: true }] }), false);
  assert.equal(isVerificationCompletionEligible({ status: "PASS", checks: [] }), false);
  assert.equal(isVerificationCompletionEligible({ status: "PASS", checks: [{ passed: true }, { passed: false }] }), false);
  assert.equal(isVerificationCompletionEligible({ status: "PASS", checks: [{ passed: true }, {}] }), false);
  assert.equal(isVerificationCompletionEligible({ status: "PASS", checks: [{ passed: true }, { passed: true }] }), true);
});


test("persisted task transition rolls back all top-level changes when persistence fails", async () => {
  const record = { id: "task-1", status: "running", task: "keep this", attempts: 2 };
  await assert.rejects(
    applyPersistedTaskTransition(record, "failed", { error: "disk unavailable", failedAt: "2026-10-20T00:00:00.000Z" }, async current => {
      assert.equal(current.status, "failed");
      assert.equal(current.error, "disk unavailable");
      throw new Error("database unavailable");
    }),
    /database unavailable/
  );
  assert.deepEqual(record, { id: "task-1", status: "running", task: "keep this", attempts: 2 });
});

test("persisted task transition validates state before writing and returns the previous state", async () => {
  const record = { id: "task-2", status: "running" };
  let writes = 0;
  const result = await applyPersistedTaskTransition(record, "completed", { result: "verified" }, async current => {
    writes += 1;
    assert.equal(current.status, "completed");
  });
  assert.equal(result.previousStatus, "running");
  assert.equal(result.record, record);
  assert.equal(record.status, "completed");
  assert.equal(writes, 1);

  await assert.rejects(applyPersistedTaskTransition(record, "accepted", {}, async () => {
    writes += 1;
  }), /Invalid task transition/);
  assert.equal(writes, 1, "invalid transitions must not be persisted");
});
