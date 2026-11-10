import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresAssignmentStore } from "./postgres-assignment-store.js";

test("PostgreSQL assignment rejects specialists without required tools before mutation", async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT t.*") && sql.includes("FROM studio.tasks")) {
        return { rows: [{
          id: "task-write", project_id: "project-1", organization_id: "org-1",
          status: "ready", version: 2,
          payload: { id: "task-write", requiredCompetencies: ["implementation"], requiredTools: ["write_repo_file"] },
        }] };
      }
      if (sql.includes("SELECT id, organization_id, status, payload FROM studio.specialists")) {
        return { rows: [{
          id: "read-only", organization_id: "org-1", status: "active",
          payload: { competencies: ["implementation"], allowedTools: ["read_repo_file"], projectIds: ["project-1"] },
        }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push({ sql: "RELEASE", params: [] }); },
  };
  const store = createPostgresAssignmentStore({
    pool: { async connect() { return client; } },
    createId: () => "assignment-event",
  });
  await assert.rejects(
    store.assignTask({ taskId: "task-write", specialistId: "read-only", expectedVersion: 2, at: "2026-11-10T00:00:00.000Z" }),
    error => error.code === "SPECIALIST_TOOL_CAPABILITY_MISMATCH",
  );
  assert.equal(calls.some(call => call.sql.includes("UPDATE studio.tasks SET status = 'assigned'")), false);
  assert.equal(calls.at(-2).sql, "ROLLBACK");
});
