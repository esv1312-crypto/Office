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
  assert.ok(calls.some(call => call.sql.includes("project.created")));
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
