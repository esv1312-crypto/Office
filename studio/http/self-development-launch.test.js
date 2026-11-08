import test from "node:test";
import assert from "node:assert/strict";
import { createSelfDevelopmentLaunchHandler } from "./self-development-launch.js";

function fixture({ owner = true, priorPlan = null, plannerError = null, existingSpecialists = [] } = {}) {
  const calls = { projects: [], specialists: [], plans: [], approvals: [], executions: [], recoveries: [] };
  const pool = {
    async query(sql, params) {
      if (sql.includes("JOIN studio.organization_memberships")) return { rows: owner ? [{ id: "org-1" }] : [] };
      if (sql.includes("FROM studio.projects")) return { rows: [] };
      if (sql.includes("FROM studio.specialists")) return { rows: existingSpecialists };
      if (sql.includes("FROM studio.plans")) {
        const matchesTitle = !sql.includes("payload->>'title' = $2") || params?.[1] === priorPlan?.payload?.title;
        return { rows: priorPlan && matchesTitle ? [priorPlan] : [] };
      }
      throw new Error("Unexpected query");
    },
  };
  const domain = {
    async createProject(project) { calls.projects.push(project); },
    async createSpecialist(specialist) { calls.specialists.push(specialist); },
    async updateSpecialist(input) { calls.updatedSpecialists = [...(calls.updatedSpecialists || []), input]; },
    async createPlanWithTasks(input) { calls.fallbackPlan = input; return input; },
  };
  const controlPlane = { runtime: {
    stores: { domain },
    director: { async plan(input) {
      calls.plans.push(input);
      if (plannerError) throw plannerError;
      return { plan: { id: "plan-1", status: "proposed" } };
    } },
    approval: { async approve(input) {
      calls.approvals.push(input);
      return { plan: { id: "plan-1", status: "approved" } };
    } },
    recovery: { async recover(input) {
      calls.recoveries.push(input);
      return { recovered: 2, tasks: [{ taskId: "stale-1" }, { taskId: "stale-2" }] };
    } },
    workflow: { async run(input) {
      calls.executions.push(input);
      return { status: "running", blocked: [] };
    } },
  } };
  const createSpecialistsForProfile = ({ organizationId, createId, at }) => [
    { id: createId(), organizationId, name: "Solution Architect", role: "solution_architect", instructions: "Design", competencies: ["architecture", "system.design", "integration", "repository inspection", "source code analysis", "root cause analysis", "technical documentation"], allowedTools: ["list_repo_directory", "read_repo_file"], status: "active", version: 1, createdAt: at, updatedAt: at },
    { id: createId(), organizationId, name: "Platform Engineer", role: "implementation_specialist", instructions: "Implement", competencies: ["implementation", "coding", "documentation", "code patching", "test development", "regression testing", "source code modification"], allowedTools: ["list_repo_directory", "read_repo_file", "write_repo_file"], status: "active", version: 1, createdAt: at, updatedAt: at },
    { id: createId(), organizationId, name: "Quality Engineer", role: "quality_engineer", instructions: "Review deliverables and inspect persisted workspace files in studio-ai-agent-workspace.", competencies: ["qa.review", "testing", "security.review", "acceptance.criteria", "code review", "quality assurance", "test coverage analysis", "safety assessment", "platform.qa"], allowedTools: ["list_repo_directory", "read_repo_file"], status: "active", version: 1, createdAt: at, updatedAt: at },
  ];
  const handler = createSelfDevelopmentLaunchHandler({
    pool, controlPlane, createId: (() => { let id = 0; return () => `id-${++id}`; })(),
    createSpecialistsForProfile, now: () => "2026-11-08T00:00:00.000Z",
  });
  return { handler, calls };
}

test("creates a separate project in the existing organization and starts Director workflow", async () => {
  const { handler, calls } = fixture();
  const result = await handler({ auth: { actor: { id: "owner-1" } }, params: { organizationId: "org-1" } });
  assert.equal(result.status, 202);
  assert.equal(result.body.projectCreated, true);
  assert.equal(calls.projects[0].organizationId, "org-1");
  assert.equal(calls.projects[0].name, "AI Office Self-Development");
  assert.equal(calls.plans.length, 1);
  assert.equal(calls.approvals.length, 1);
  assert.equal(calls.executions[0].planId, "plan-1");
});

test("rejects non-owner before creating anything", async () => {
  const { handler, calls } = fixture({ owner: false });
  await assert.rejects(handler({ auth: { actor: { id: "member-1" } }, params: { organizationId: "org-1" } }),
    error => error.code === "ORGANIZATION_OWNER_REQUIRED" && error.status === 403);
  assert.equal(calls.projects.length, 0);
  assert.equal(calls.plans.length, 0);
});

test("resumes an existing approved plan and recovers expired work without creating a duplicate", async () => {
  const { handler, calls } = fixture({
    priorPlan: { id: "existing-plan", status: "approved", payload: { title: "AI Office Self-Development — Sprint 2: Reliable Autonomous Execution" } },
  });
  const result = await handler({ auth: { actor: { id: "owner-1" } }, params: { organizationId: "org-1" } });
  assert.equal(result.status, 202);
  assert.equal(result.body.planId, "existing-plan");
  assert.equal(result.body.planStatus, "approved");
  assert.equal(result.body.recovery.recovered, 2);
  assert.deepEqual(calls.recoveries, [{ actor: { id: "owner-1" }, limit: 50 }]);
  assert.deepEqual(calls.executions, [{ planId: "existing-plan", actor: { id: "owner-1" } }]);
  assert.equal(calls.plans.length, 0);
});


test("uses a deterministic, evidence-bounded bootstrap plan when planner output fails", async () => {
  const { handler, calls } = fixture({
    plannerError: Object.assign(new Error("invalid model JSON"), { code: "INVALID_MODEL_JSON" }),
  });
  const result = await handler({ auth: { actor: { id: "owner-1" } }, params: { organizationId: "org-1" } });
  assert.equal(result.status, 202);
  assert.equal(result.body.planSource, "deterministic-bootstrap-fallback");
  assert.equal(result.body.plannerFailure.code, "INVALID_MODEL_JSON");
  assert.equal(calls.fallbackPlan.plan.title, "AI Office Self-Development — Sprint 2: Reliable Autonomous Execution");
  assert.equal(calls.fallbackPlan.tasks.length, 3);
  assert.ok(calls.fallbackPlan.tasks.every(task => task.status === "draft" && task.assigneeSpecialistId === null));
  assert.equal(calls.approvals.length, 1);
  assert.equal(calls.executions[0].planId, calls.fallbackPlan.plan.id);
});


test("does not resume an unrelated product-pilot plan in the self-development project", async () => {
  const { handler, calls } = fixture({
    priorPlan: { id: "roblox-plan", status: "approved", payload: { title: "Roblox Fan District — First Playable Vertical Slice v1" } },
  });
  const result = await handler({ auth: { actor: { id: "owner-1" } }, params: { organizationId: "org-1" } });
  assert.equal(result.status, 202);
  assert.equal(calls.plans.length, 1);
  assert.equal(calls.recoveries.length, 0);
  assert.equal(calls.executions.length, 1);
});

test("updates existing Solution Architect permissions instead of skipping the existing role", async () => {
  const { handler, calls } = fixture({
    existingSpecialists: [{
      id: "architect-1", role: "solution_architect", version: 1,
      payload: { allowedTools: [], competencies: ["architecture", "system.design", "integration", "repository inspection", "source code analysis", "root cause analysis", "technical documentation"] },
    }],
  });
  const result = await handler({ auth: { actor: { id: "owner-1" } }, params: { organizationId: "org-1" } });
  assert.equal(result.status, 202);
  assert.equal(calls.specialists.some(item => item.role === "solution_architect"), false);
  assert.deepEqual(calls.updatedSpecialists, [{
    specialistId: "architect-1",
    expectedVersion: 1,
    patch: { allowedTools: ["list_repo_directory", "read_repo_file"] },
    at: "2026-11-08T00:00:00.000Z",
  }]);
  assert.deepEqual(result.body.updatedSpecialists, ["solution_architect"]);
});


test("updates the existing Implementation Specialist with canonical code-task competency aliases", async () => {
  const { handler, calls } = fixture({
    existingSpecialists: [{
      id: "implementer-1", role: "implementation_specialist", version: 2,
      payload: { allowedTools: ["list_repo_directory", "read_repo_file", "write_repo_file"], competencies: ["implementation", "coding", "documentation"] },
    }],
  });
  const result = await handler({ auth: { actor: { id: "owner-1" } }, params: { organizationId: "org-1" } });
  assert.equal(result.status, 202);
  const update = calls.updatedSpecialists.find(item => item.specialistId === "implementer-1");
  assert.ok(update.patch.competencies.includes("code patching"));
  assert.ok(update.patch.competencies.includes("regression testing"));
});

test("grants the existing Quality Engineer read-only access to persisted workspace patches", async () => {
  const { handler, calls } = fixture({
    existingSpecialists: [{
      id: "qa-1", role: "quality_engineer", version: 3,
      payload: { allowedTools: [], competencies: ["qa.review"], instructions: "Review deliverables" },
    }],
  });
  const result = await handler({ auth: { actor: { id: "owner-1" } }, params: { organizationId: "org-1" } });
  assert.equal(result.status, 202);
  const update = calls.updatedSpecialists.find(item => item.specialistId === "qa-1");
  assert.deepEqual(update.patch.allowedTools, ["list_repo_directory", "read_repo_file"]);
  assert.ok(update.patch.competencies.includes("platform.qa"));
  assert.match(update.patch.instructions, /studio-ai-agent-workspace/);
});
