import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresExecutionStore } from "./postgres-execution-store.js";

function fakePool({ taskStatus = "assigned", assignedSpecialistId = "specialist-1" } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM studio.tasks t") && sql.includes("FOR UPDATE OF t")) {
        return {
          rows: [{
            id: "task-1",
            status: taskStatus,
            assignee_specialist_id: assignedSpecialistId,
            version: 3,
            payload: {
              id: "task-1",
              projectId: "project-1",
              title: "Create a lobby",
              status: taskStatus,
              assigneeSpecialistId: assignedSpecialistId,
              version: 3,
            },
            organization_id: "org-1",
          }],
        };
      }
      if (sql.includes("FROM studio.specialists")) {
        return { rows: [{ id: "specialist-1" }] };
      }
      if (sql.includes("MAX(attempt)")) return { rows: [{ next_attempt: 2 }] };
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE", params: [] }); },
  };
  return {
    calls,
    pool: { async connect() { return client; } },
  };
}

test("requires an injected PostgreSQL pool and ID generator", () => {
  assert.throws(
    () => createPostgresExecutionStore({ pool: {}, createId: () => "id" }),
    /pg-compatible pool/,
  );
  assert.throws(
    () => createPostgresExecutionStore({ pool: { connect() {} } }),
    /createId is required/,
  );
});

test("claims an assigned task and writes execution in one transaction", async () => {
  const { pool, calls } = fakePool();
  let nextId = 0;
  const store = createPostgresExecutionStore({
    pool,
    createId: () => `generated-${++nextId}`,
  });

  const result = await store.startExecution({
    taskId: "task-1",
    specialistId: "specialist-1",
    workerId: "worker-1",
    at: "2026-11-07T01:00:00.000Z",
  });

  assert.equal(result.executionId, "generated-1");
  assert.equal(result.task.status, "running");
  assert.equal(result.task.version, 4);
  assert.equal(result.execution.attempt, 2);
  assert.equal(result.execution.workerId, "worker-1");
  assert.equal(calls[0].sql, "BEGIN");
  assert.ok(calls.some(call => call.sql.includes("INSERT INTO studio.executions")));
  assert.ok(calls.some(call => call.sql.includes("execution.started")));
  assert.equal(calls.at(-2).sql, "COMMIT");
  assert.equal(calls.at(-1).sql, "RELEASE");
});

test("rolls back if a task is not assigned", async () => {
  const { pool, calls } = fakePool({ taskStatus: "ready" });
  const store = createPostgresExecutionStore({
    pool,
    createId: () => "generated-id",
  });

  await assert.rejects(
    store.startExecution({
      taskId: "task-1",
      specialistId: "specialist-1",
      workerId: "worker-1",
      at: "2026-11-07T01:00:00.000Z",
    }),
    error => error.code === "TASK_NOT_ASSIGNED",
  );

  assert.ok(calls.some(call => call.sql === "ROLLBACK"));
  assert.equal(calls.some(call => call.sql.includes("INSERT INTO studio.executions")), false);
  assert.equal(calls.at(-1).sql, "RELEASE");
});

test("rejects a mismatched specialist assignment", async () => {
  const { pool, calls } = fakePool({ assignedSpecialistId: "specialist-else" });
  const store = createPostgresExecutionStore({
    pool,
    createId: () => "generated-id",
  });

  await assert.rejects(
    store.startExecution({
      taskId: "task-1",
      specialistId: "specialist-1",
      workerId: "worker-1",
      at: "2026-11-07T01:00:00.000Z",
    }),
    error => error.code === "SPECIALIST_ASSIGNMENT_MISMATCH",
  );
  assert.ok(calls.some(call => call.sql === "ROLLBACK"));
});
