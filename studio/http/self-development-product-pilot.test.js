import test from "node:test";
import assert from "node:assert/strict";
import { createSelfDevelopmentProductPilot } from "./self-development-product-pilot.js";

function fixture({ existingPlan = null, taskStatuses = [] } = {}) {
  const calls = { plans: [], approvals: [], recoveries: [], executions: [] };
  const pool = {
    async query(sql) {
      if (sql.includes("JOIN studio.organization_memberships")) return { rows: [{ id: "project-1" }] };
      if (sql.includes("payload->>'title'")) return { rows: existingPlan ? [existingPlan] : [] };
      if (sql.includes("FROM studio.tasks")) return { rows: taskStatuses.map((status, i) => ({ id: "task-" + i, status })) };
      throw new Error("Unexpected query: " + sql);
    },
  };
  const plan = { id: "plan-new", status: "proposed", projectId: "project-1" };
  const controlPlane = {
    access: { async loadProject(input) { return { id: input.projectId, name: "AI Office Self-Development" }; } },
    runtime: {
      director: { async plan(input) { calls.plans.push(input); return { plan }; } },
      approval: { async approve(input) { calls.approvals.push(input); return { plan: { ...input.plan, status: "approved" } }; } },
      recovery: { async recover(input) { calls.recoveries.push(input); return { recovered: 0 }; } },
      workflow: { async run(input) { calls.executions.push(input); return { status: "completed", qaReviews: [{ verdict: "accepted" }], executions: [{ status: "qa" }] }; } },
    },
  };
  const run = createSelfDevelopmentProductPilot({ pool, controlPlane, now: () => "2026-11-08T12:00:00.000Z" });
  return { run, calls };
}

test("asks the Director for a real Roblox implementation plan and runs the standard QA workflow", async () => {
  const { run, calls } = fixture();
  const result = await run({ organizationId: "org-1", actor: { id: "legacy-office-owner" } });
  assert.equal(result.status, "completed");
  assert.equal(result.created, true);
  assert.equal(calls.plans.length, 1);
  const brief = calls.plans[0].request;
  assert.match(brief, /This is an implementation assignment/);
  assert.match(brief, /studio\/agent-workspace\/roblox-fan-district\//);
  assert.match(brief, /server-authoritative/);
  assert.match(brief, /independently inspect/);
  assert.equal(calls.approvals.length, 1);
  assert.equal(calls.approvals[0].plan.id, "plan-new");
  assert.equal(calls.approvals[0].actor.id, "legacy-office-owner");
  assert.deepEqual(calls.executions, [{ planId: "plan-new", actor: { id: "legacy-office-owner" } }]);
});

test("does not create a duplicate after the product pilot is completed", async () => {
  const { run, calls } = fixture({
    existingPlan: { id: "existing-plan", status: "approved", payload: { title: "Roblox Fan District — First Playable Vertical Slice v1" } },
    taskStatuses: ["completed", "completed"],
  });
  const result = await run({ organizationId: "org-1", actor: { id: "legacy-office-owner" } });
  assert.equal(result.status, "already_completed");
  assert.equal(result.planId, "existing-plan");
  assert.equal(calls.plans.length, 0);
  assert.equal(calls.executions.length, 0);
});

test("requires an owner actor before doing any work", async () => {
  const { run, calls } = fixture();
  await assert.rejects(run({ organizationId: "org-1", actor: null }), /Authenticated owner actor/);
  assert.equal(calls.plans.length, 0);
});
