import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresDomainStore } from "./postgres-domain-store.js";

function fakePool({ planStatus = "proposed", taskStatuses = ["draft"] } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM studio.plans pl") && sql.includes("m.role = 'owner'")) return { rows: [{
        id: "plan-1", project_id: "project-1", organization_id: "org-1",
        status: planStatus, version: 1,
        payload: { id: "plan-1", status: planStatus, version: 1 },
      }] };
      if (sql.includes("FROM studio.tasks WHERE plan_id")) return { rows: taskStatuses.map((status, index) => ({
        id: `task-${index + 1}`, status, version: 1,
        payload: { id: `task-${index + 1}`, status, version: 1 },
      })) };
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE", params: [] }); },
  };
  return { calls, pool: { async connect() { return client; } } };
}

test("approves plan and moves all draft tasks to planned in one transaction", async () => {
  const { pool, calls } = fakePool({ taskStatuses: ["draft", "draft"] });
  let id = 0;
  const store = createPostgresDomainStore({ pool, createId: () => `event-${++id}` });
  const result = await store.approvePlan({
    planId: "plan-1", actorId: "owner-1", at: "2026-11-07T10:00:00.000Z",
  });
  assert.equal(result.plan.status, "approved");
  assert.equal(result.tasks.length, 2);
  assert.ok(result.tasks.every(task => task.status === "planned"));
  assert.ok(calls.some(call => call.sql.includes("plan.approved")));
  assert.ok(calls.filter(call => call.sql.includes("task.status_changed")).length === 2);
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-2).sql, "COMMIT");
});

test("rolls back when plan is not proposed", async () => {
  const { pool, calls } = fakePool({ planStatus: "approved" });
  const store = createPostgresDomainStore({ pool, createId: () => "event" });
  await assert.rejects(
    store.approvePlan({ planId: "plan-1", actorId: "owner-1", at: "2026-11-07T10:00:00.000Z" }),
    error => error.code === "PLAN_NOT_PROPOSED",
  );
  assert.ok(calls.some(call => call.sql === "ROLLBACK"));
  assert.equal(calls.some(call => call.sql.includes("UPDATE studio.plans")), false);
});
