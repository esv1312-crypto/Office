import test from "node:test";
import assert from "node:assert/strict";
import { createSelfDevelopmentSourceVerification } from "./self-development-source-verification.js";

function fixture({ owner = true, existingPlan = null, taskStatuses = [] } = {}) {
  const calls = { created: [], approved: [], recovered: [], executed: [] };
  const pool = {
    async query(sql, params) {
      if (sql.includes("JOIN studio.organization_memberships")) return { rows: owner ? [{ id: "project-1" }] : [] };
      if (sql.includes("payload->>'title'")) return { rows: existingPlan ? [existingPlan] : [] };
      if (sql.includes("FROM studio.tasks")) return { rows: taskStatuses.map((status, i) => ({ id: "task-" + i, status })) };
      throw new Error("Unexpected query: " + sql);
    },
  };
  const runtime = {
    stores: { domain: { async createPlanWithTasks(input) { calls.created.push(input); return input; } } },
    approval: { async approve({ plan }) { calls.approved.push(plan.id); return { plan: { ...plan, status: "approved" }, tasks: [] }; } },
    recovery: { async recover(input) { calls.recovered.push(input); return { recovered: 0 }; } },
    workflow: { async run(input) { calls.executed.push(input); return { status: "completed", qaReviews: [{ verdict: "accepted" }], executions: [{ status: "qa" }] }; } },
  };
  let id = 0;
  const run = createSelfDevelopmentSourceVerification({
    pool, controlPlane: { runtime }, createId: () => "id-" + (++id),
    now: () => "2026-11-08T12:00:00.000Z",
  });
  return { run, calls };
}

test("creates one scoped source-verification plan, approves it, and executes through workflow", async () => {
  const { run, calls } = fixture();
  const result = await run({ organizationId: "org-1", actor: { id: "legacy-office-owner" } });
  assert.equal(result.status, "completed");
  assert.equal(result.created, true);
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].tasks.length, 1);
  const task = calls.created[0].tasks[0];
  assert.equal(task.externalArtifact, false);
  assert.deepEqual(task.requiredCompetencies, ["implementation", "coding"]);
  assert.ok(task.description.includes("studio/server.js"));
  assert.ok(task.description.includes("studio/agents/github-workspace-tools.js"));
  assert.ok(task.description.includes("studio/agents/worker-runtime.js lines 180-188 and 238-245"));
  assert.ok(task.description.includes("Do NOT put the evidence file's own blob SHA"));
  assert.ok(task.description.includes("exact bounded source snippets from the three allowlisted source files"));
  assert.ok(task.description.includes("studio/agent-workspace/verification/post-pr81-source-audit-v6.md"));
  assert.deepEqual(calls.approved, [calls.created[0].plan.id]);
  assert.deepEqual(calls.executed, [{ planId: calls.created[0].plan.id, actor: { id: "legacy-office-owner" } }]);
});

test("does not create a duplicate when the verification task is already completed", async () => {
  const { run, calls } = fixture({
    existingPlan: { id: "existing-plan", status: "approved", payload: { title: "AI Office — Live Source Read/Write Verification v6" } },
    taskStatuses: ["completed"],
  });
  const result = await run({ organizationId: "org-1", actor: { id: "legacy-office-owner" } });
  assert.equal(result.status, "already_completed");
  assert.equal(result.planId, "existing-plan");
  assert.equal(calls.created.length, 0);
  assert.equal(calls.executed.length, 0);
});

test("requires an active owner before creating a verification plan", async () => {
  const { run, calls } = fixture({ owner: false });
  await assert.rejects(
    run({ organizationId: "org-1", actor: { id: "not-an-owner" } }),
    error => error.code === "SELF_DEVELOPMENT_PROJECT_NOT_FOUND",
  );
  assert.equal(calls.created.length, 0);
});

test("rejects missing owner actor", async () => {
  const { run, calls } = fixture();
  await assert.rejects(run({ organizationId: "org-1", actor: null }), /Authenticated owner actor/);
  assert.equal(calls.created.length, 0);
});
