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
            project_id: "project-1",
            status: taskStatus,
            assignee_specialist_id: assignedSpecialistId,
            version: 3,
            fencing_token: 4,
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
  assert.equal(result.execution.fencingToken, 5);
  assert.equal(result.execution.leaseToken, "generated-2");
  assert.ok(result.execution.leaseExpiresAt);
  assert.equal(result.execution.workerId, "worker-1");
  assert.equal(calls[0].sql, "BEGIN");
  assert.ok(calls.some(call => call.sql.includes("INSERT INTO studio.executions")));
  assert.ok(calls.some(call => call.sql.includes("fencing_token = $5")));
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


test("renews only the current, unexpired execution lease", async () => {
  let captured;
  const pool = {
    async connect() { throw new Error("not used"); },
    async query(sql, params) {
      captured = { sql, params };
      return { rowCount: 1, rows: [{ id: "execution-1" }] };
    },
  };
  const store = createPostgresExecutionStore({ pool, createId: () => "event-id" });
  const result = await store.heartbeatExecution({
    executionId: "execution-1", fencingToken: 7, leaseToken: "lease-7",
    at: "2026-11-07T12:00:00.000Z", leaseMs: 60_000,
  });
  assert.equal(result.executionId, "execution-1");
  assert.equal(captured.params[1], 7);
  assert.equal(captured.params[2], "lease-7");
  assert.match(captured.sql, /lease_expires_at > \$4/);
});

test("rejects heartbeat after a lease has been lost", async () => {
  const pool = {
    async connect() { throw new Error("not used"); },
    async query() { return { rowCount: 0, rows: [] }; },
  };
  const store = createPostgresExecutionStore({ pool, createId: () => "event-id" });
  await assert.rejects(
    store.heartbeatExecution({
      executionId: "execution-1", fencingToken: 7, leaseToken: "old-lease",
      at: "2026-11-07T12:00:00.000Z",
    }),
    error => error.code === "EXECUTION_LEASE_LOST",
  );
});

test("recovers an expired execution and writes its audit and outbox events atomically", async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT e.id AS execution_id")) {
        return { rows: [{
          execution_id: "execution-old", task_id: "task-1", fencing_token: "3",
          project_id: "project-1", task_status: "running", version: 8,
          payload: { id: "task-1", title: "Build lobby", status: "running", assigneeSpecialistId: "specialist-1" },
          task_fencing_token: "3", assignee_specialist_id: "specialist-1",
          organization_id: "org-1",
        }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push({ sql: "RELEASE", params: [] }); },
  };
  const pool = { async connect() { return client; } };
  const ids = ["recovery-event-id"];
  const store = createPostgresExecutionStore({ pool, createId: () => ids.shift() });
  const result = await store.recoverExpiredExecutions({
    at: "2026-11-07T12:00:00.000Z", limit: 10,
  });
  assert.equal(result.recovered, 1);
  assert.deepEqual(result.tasks[0], {
    taskId: "task-1", executionId: "execution-old", status: "assigned",
  });
  assert.ok(calls.some(call => call.sql.includes("FOR UPDATE OF e, t SKIP LOCKED")));
  assert.ok(calls.some(call => call.sql.includes("UPDATE studio.executions SET status = 'failed'")));
  assert.ok(calls.some(call => call.sql.includes("UPDATE studio.tasks SET status = 'assigned'")));
  assert.ok(calls.some(call => call.sql.includes("INSERT INTO studio.events")));
  assert.ok(calls.some(call => call.sql.includes("INSERT INTO studio.outbox_events")));
  assert.equal(calls.at(-2).sql, "COMMIT");
});


test("completion reads the task fencing token before validating and persisting the artifact", async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT * FROM studio.executions WHERE id = $1 FOR UPDATE")) {
        return { rows: [{
          id: "execution-1", task_id: "task-1", specialist_id: "specialist-1",
          status: "running", fencing_token: 5, lease_token: "lease-5",
          lease_expires_at: "2026-11-07T12:10:00.000Z",
        }] };
      }
      if (sql.includes("SELECT id FROM studio.artifacts WHERE execution_id = $1")) {
        return { rows: [] };
      }
      if (sql.includes("FROM studio.tasks t JOIN studio.projects p") && sql.includes("FOR UPDATE OF t")) {
        return { rows: [{
          id: "task-1", project_id: "project-1", status: "running", version: 4,
          fencing_token: 5, payload: { id: "task-1", title: "Build lobby", status: "running" },
          organization_id: "org-1",
        }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push({ sql: "RELEASE", params: [] }); },
  };
  let nextId = 0;
  const store = createPostgresExecutionStore({
    pool: { async connect() { return client; } },
    createId: () => `generated-${++nextId}`,
  });
  const result = await store.completeExecution({
    executionId: "execution-1", output: "Lobby built",
    modelSnapshot: { provider: "test", model: "test-model" },
    artifact: { type: "text", name: "Lobby result", createdByWorkerId: "worker-1", specialistId: "specialist-1" },
    at: "2026-11-07T12:00:00.000Z", fencingToken: 5, leaseToken: "lease-5",
  });
  assert.equal(result.task.status, "qa");
  assert.equal(result.artifactId, "generated-1");
  const taskLockQuery = calls.find(call => call.sql.includes("FROM studio.tasks t JOIN studio.projects p") && call.sql.includes("FOR UPDATE OF t"));
  assert.match(taskLockQuery.sql, /t\.fencing_token/);
  assert.ok(calls.some(call => call.sql.includes("INSERT INTO studio.artifacts")));
  assert.ok(calls.some(call => call.sql.includes("UPDATE studio.tasks SET status = 'qa'")));
  assert.equal(calls.at(-2).sql, "COMMIT");
});
