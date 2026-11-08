import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresDomainStore } from "./postgres-domain-store.js";

function fakePool({ projectExists = true } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT organization_id FROM studio.projects")) {
        return { rows: projectExists ? [{ organization_id: "org-1" }] : [] };
      }
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE", params: [] }); },
  };
  return { calls, pool: { async connect() { return client; } } };
}
const at = "2026-11-07T10:00:00.000Z";

test("requires injected database pool and ID generator", () => {
  assert.throws(() => createPostgresDomainStore({ pool: {} , createId: () => "id" }), /pool/);
  assert.throws(() => createPostgresDomainStore({ pool: { connect() {} } }), /createId/);
});

test("creates project and event in one transaction", async () => {
  const { pool, calls } = fakePool();
  let id = 0;
  const store = createPostgresDomainStore({ pool, createId: () => `id-${++id}` });
  const project = {
    id: "p1", organizationId: "org-1", name: "Pilot", productProfileId: "roblox",
    status: "active", version: 1, createdAt: at, updatedAt: at,
  };
  const result = await store.createProject(project);
  assert.equal(result.project.id, "p1");
  assert.ok(calls.some(call => call.sql.includes("INSERT INTO studio.projects")));
  const projectEvent = calls.find(call => call.sql.includes("project.created"));
  assert.ok(projectEvent);
  assert.match(projectEvent.sql, /project_id/);
  assert.deepEqual(projectEvent.params.slice(1, 4), ["org-1", "p1", "p1"]);
  assert.equal(calls.at(-2).sql, "COMMIT");
});

test("creates specialist and stores its dynamic competencies", async () => {
  const { pool, calls } = fakePool();
  const store = createPostgresDomainStore({ pool, createId: () => "event-1" });
  const specialist = {
    id: "s1", organizationId: "org-1", name: "Lua Developer", role: "developer",
    instructions: "Implement assigned Lua tasks", competencies: ["lua", "roblox"],
    allowedTools: ["repo.read"], modelProfile: {}, status: "active",
    version: 1, createdAt: at, updatedAt: at,
  };
  await store.createSpecialist(specialist);
  const insert = calls.find(call => call.sql.includes("INSERT INTO studio.specialists"));
  assert.deepEqual(JSON.parse(insert.params[6]).competencies, ["lua", "roblox"]);
  assert.ok(calls.some(call => call.sql.includes("specialist.created")));
});

test("creates task only inside an active project", async () => {
  const { pool, calls } = fakePool();
  const store = createPostgresDomainStore({ pool, createId: () => "event-1" });
  const task = {
    id: "t1", projectId: "p1", title: "Build lobby", description: "",
    requiredCompetencies: ["roblox", "lua"], status: "draft",
    assigneeSpecialistId: null, version: 1, createdAt: at, updatedAt: at,
  };
  await store.createTask(task);
  assert.ok(calls.some(call => call.sql.includes("INSERT INTO studio.tasks")));
  assert.ok(calls.some(call => call.sql.includes("task.created")));
});

test("rolls back task creation if project is absent or inactive", async () => {
  const { pool, calls } = fakePool({ projectExists: false });
  const store = createPostgresDomainStore({ pool, createId: () => "event-1" });
  await assert.rejects(store.createTask({
    id: "t1", projectId: "p1", title: "Build lobby", description: "",
    requiredCompetencies: [], status: "draft", assigneeSpecialistId: null,
    version: 1, createdAt: at, updatedAt: at,
  }), error => error.code === "PROJECT_NOT_FOUND_OR_INACTIVE");
  assert.ok(calls.some(call => call.sql === "ROLLBACK"));
  assert.equal(calls.some(call => call.sql.includes("INSERT INTO studio.tasks")), false);
});


test("approval transaction locks only a plan owned by the authenticated active organization owner", async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM studio.plans pl") && sql.includes("m.role = 'owner'")) {
        return { rows: [{
          id: "plan-1", project_id: "project-1", organization_id: "org-1",
          status: "proposed", version: 1, payload: { id: "plan-1", title: "Pilot" },
        }] };
      }
      if (sql.includes("SELECT id, status, version, payload FROM studio.tasks")) {
        return { rows: [{
          id: "task-1", status: "draft", version: 1,
          payload: { id: "task-1", title: "Build lobby" },
        }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  let id = 0;
  const store = createPostgresDomainStore({
    pool: { async connect() { return client; } },
    createId: () => `event-${++id}`,
  });
  const result = await store.approvePlan({
    planId: "plan-1", actorId: "verified-owner-subject", at,
  });
  const lock = calls.find(call => call.sql.includes("FROM studio.plans pl") && call.sql.includes("m.role = 'owner'"));
  assert.ok(lock);
  assert.deepEqual(lock.params, ["plan-1", "verified-owner-subject"]);
  assert.match(lock.sql, /m\.status = 'active'/);
  assert.match(lock.sql, /o\.status = 'active'/);
  assert.equal(result.plan.status, "approved");
  assert.equal(result.tasks[0].status, "planned");
  assert.ok(calls.some(call => call.sql.includes("INSERT INTO studio.outbox_events")));
  assert.equal(calls.at(-1).sql, "COMMIT");
});

test("approval refuses a missing verified owner identity before opening a transaction", async () => {
  let connected = false;
  const store = createPostgresDomainStore({
    pool: { async connect() { connected = true; throw new Error("should not connect"); } },
    createId: () => "event-1",
  });
  await assert.rejects(
    store.approvePlan({ planId: "plan-1", actorId: null, at }),
    /actorId is required/,
  );
  assert.equal(connected, false);
});


test("updates an existing specialist's allowed tools with version check and audit event", async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT id, organization_id, name, role, status, version, payload FROM studio.specialists")) {
        return { rows: [{
          id: "s1", organization_id: "org-1", name: "Solution Architect",
          role: "solution_architect", status: "active", version: 1,
          payload: { id: "s1", name: "Solution Architect", role: "solution_architect", allowedTools: [], version: 1 },
        }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const store = createPostgresDomainStore({
    pool: { async connect() { return client; } },
    createId: () => "event-update-1",
  });
  const result = await store.updateSpecialist({
    specialistId: "s1", expectedVersion: 1,
    patch: { allowedTools: ["list_repo_directory", "read_repo_file"] }, at,
  });
  assert.deepEqual(result.specialist.allowedTools, ["list_repo_directory", "read_repo_file"]);
  assert.equal(result.specialist.version, 2);
  assert.ok(calls.some(call => call.sql.includes("UPDATE studio.specialists")));
  assert.ok(calls.some(call => call.sql.includes("specialist.updated")));
  assert.equal(calls.at(-1).sql, "COMMIT");
});

test("rejects stale specialist updates", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("SELECT id, organization_id, name, role, status, version, payload FROM studio.specialists")) {
        return { rows: [{ id: "s1", organization_id: "org-1", name: "Architect", role: "solution_architect", status: "active", version: 2, payload: {} }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const store = createPostgresDomainStore({ pool: { async connect() { return client; } }, createId: () => "event-1" });
  await assert.rejects(store.updateSpecialist({
    specialistId: "s1", expectedVersion: 1, patch: { allowedTools: ["read_repo_file"] }, at,
  }), error => error.code === "SPECIALIST_VERSION_CONFLICT");
});


test("requeues a failed task for one bounded retry and records an audit event", async () => {
  const calls = [];
  const taskPayload = {
    id: "task-failed", projectId: "project-1", title: "Inspect runtime",
    requiredCompetencies: ["architecture"], failureReason: "MODEL_EXECUTION_TIMEOUT",
    status: "failed", version: 5, assigneeSpecialistId: "specialist-1",
  };
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT t.*") && sql.includes("FROM studio.tasks")) {
        return { rows: [{
          id: "task-failed", project_id: "project-1", organization_id: "org-1",
          status: "failed", version: 5, assignee_specialist_id: "specialist-1",
          payload: taskPayload,
        }] };
      }
      if (sql.includes("FROM studio.specialists")) {
        return { rows: [{
          id: "specialist-1", organization_id: "org-1", status: "active",
          payload: { id: "specialist-1", competencies: ["architecture"], projectIds: [] },
        }] };
      }
      if (sql.includes("COUNT(*)::int AS attempts")) return { rows: [{ attempts: 1 }] };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const store = createPostgresDomainStore({
    pool: { async connect() { return client; } },
    createId: () => "retry-event-1",
  });
  const result = await store.retryFailedTask({
    taskId: "task-failed", expectedVersion: 5, maxAttempts: 2, at,
    actorId: "owner-1",
  });
  assert.equal(result.task.status, "assigned");
  assert.equal(result.task.version, 6);
  assert.equal(result.task.retryCount, 1);
  assert.equal(result.task.previousFailureReason, "MODEL_EXECUTION_TIMEOUT");
  assert.equal("failureReason" in result.task, false);
  assert.equal(result.attempt, 2);
  const update = calls.find(call => call.sql.includes("UPDATE studio.tasks SET status = 'assigned'"));
  assert.ok(update);
  const audit = calls.find(call => call.sql.includes("task.retry_scheduled"));
  assert.ok(audit);
  assert.equal(calls.at(-1).sql, "COMMIT");
});

test("does not exceed the configured failed-task retry limit", async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT t.*") && sql.includes("FROM studio.tasks")) {
        return { rows: [{
          id: "task-failed", project_id: "project-1", organization_id: "org-1",
          status: "failed", version: 6, assignee_specialist_id: "specialist-1",
          payload: { id: "task-failed", requiredCompetencies: ["architecture"], failureReason: "timeout" },
        }] };
      }
      if (sql.includes("FROM studio.specialists")) {
        return { rows: [{
          id: "specialist-1", organization_id: "org-1", status: "active",
          payload: { id: "specialist-1", competencies: ["architecture"], projectIds: [] },
        }] };
      }
      if (sql.includes("COUNT(*)::int AS attempts")) return { rows: [{ attempts: 2 }] };
      return { rows: [] };
    },
    release() {},
  };
  const store = createPostgresDomainStore({
    pool: { async connect() { return client; } },
    createId: () => "retry-event-2",
  });
  await assert.rejects(
    store.retryFailedTask({ taskId: "task-failed", expectedVersion: 6, maxAttempts: 2, at }),
    error => error.code === "TASK_RETRY_LIMIT_REACHED",
  );
  assert.equal(calls.some(call => call.sql.includes("UPDATE studio.tasks SET status = 'assigned'")), false);
  assert.equal(calls.at(-1).sql, "ROLLBACK");
});
