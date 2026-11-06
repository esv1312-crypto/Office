import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresDomainStore } from "./postgres-domain-store.js";

function fakePool() {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM studio.projects") && sql.includes("FOR SHARE")) {
        return { rows: [{ organization_id: "org-1" }] };
      }
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE", params: [] }); },
  };
  return { calls, pool: { async connect() { return client; } } };
}
const at = "2026-11-07T10:00:00.000Z";

test("persists proposed plan, draft tasks, and events in one transaction", async () => {
  const { pool, calls } = fakePool();
  let id = 0;
  const store = createPostgresDomainStore({ pool, createId: () => `event-${++id}` });
  const plan = {
    id: "plan-1", projectId: "project-1", organizationId: "org-1",
    title: "Pilot", objective: "Deliver a playable slice", summary: "Build and test the first slice",
    acceptanceCriteria: ["The slice loads"], status: "proposed", version: 1,
    createdBy: "owner-1", planningModelSnapshot: { provider: "fixture", model: "test" },
    createdAt: at, updatedAt: at,
  };
  const tasks = [{
    id: "task-1", projectId: "project-1", title: "Build map", description: "Create blockout",
    requiredCompetencies: ["roblox"], acceptanceCriteria: ["Map loads"],
    status: "draft", assigneeSpecialistId: null, version: 1, createdAt: at, updatedAt: at,
  }];
  const result = await store.createPlanWithTasks({ plan, tasks });
  assert.equal(result.plan.id, "plan-1");
  assert.equal(result.tasks.length, 1);
  assert.ok(calls.some(call => call.sql.includes("INSERT INTO studio.plans")));
  assert.ok(calls.some(call => call.sql.includes("INSERT INTO studio.tasks") && call.sql.includes("plan_id")));
  assert.ok(calls.some(call => call.sql.includes("plan.created")));
  assert.ok(calls.some(call => call.sql.includes("task.created")));
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-2).sql, "COMMIT");
});

test("rejects tasks from a different project before opening transaction", async () => {
  const { pool, calls } = fakePool();
  const store = createPostgresDomainStore({ pool, createId: () => "event" });
  const plan = {
    id: "plan-1", projectId: "project-1", title: "Plan", status: "proposed", version: 1,
    createdAt: at, updatedAt: at,
  };
  await assert.rejects(store.createPlanWithTasks({
    plan,
    tasks: [{
      id: "task-1", projectId: "other-project", title: "Task",
      status: "draft", version: 1, assigneeSpecialistId: null,
      createdAt: at, updatedAt: at,
    }],
  }), /same project/);
  assert.equal(calls.length, 0);
});
