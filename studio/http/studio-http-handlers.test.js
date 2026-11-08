import test from "node:test";
import assert from "node:assert/strict";
import { createStudioHttpHandlers } from "./studio-http-handlers.js";

function fixture({ planStatus = "proposed" } = {}) {
  const calls = { bootstrap: [], create: [], approve: [], recover: [], execute: [], order: [], projectLookup: [], planLookup: [] };
  const runtime = {
    bootstrap: { bootstrap: async value => { calls.bootstrap.push(value); return { status: "plan_proposed" }; } },
    director: { plan: async value => {
      calls.create.push(value);
      return { plan: { id: "plan-1", status: "proposed" }, tasks: [], status: "proposed" };
    } },
    approval: { approve: async value => {
      calls.approve.push(value);
      return { plan: { ...value.plan, status: "approved" }, tasks: [] };
    } },
    recovery: { recover: async value => {
      calls.order.push("recover");
      calls.recover.push(value);
      return { recovered: 1, tasks: [{ taskId: "task-recovered" }] };
    } },
    workflow: { run: async value => {
      calls.order.push("workflow");
      calls.execute.push(value);
      return { planId: value.planId, status: "completed", blocked: [] };
    } },
  };
  const handlers = createStudioHttpHandlers({
    runtime,
    loadProject: async value => {
      calls.projectLookup.push(value);
      return { id: value.projectId, organizationId: "org-1", productProfileId: "roblox", status: "active" };
    },
    loadPlan: async value => {
      calls.planLookup.push(value);
      return { id: value.planId, status: planStatus };
    },
  });
  return { handlers, calls };
}

const ownerRequest = { auth: { actor: { id: "owner-1" } } };

test("creates a Director plan using the authenticated actor and server-loaded project", async () => {
  const { handlers, calls } = fixture();
  const result = await handlers.createPlan({
    ...ownerRequest,
    params: { projectId: "project-1" },
    body: { request: "Create a small playable prototype", project: { id: "attacker-project" } },
  });
  assert.equal(result.status, 201);
  assert.equal(calls.create[0].project.id, "project-1");
  assert.equal(calls.create[0].actor.id, "owner-1");
  assert.equal(calls.projectLookup.length, 1);
});

test("requires authenticated owner context", async () => {
  const { handlers } = fixture();
  await assert.rejects(
    handlers.createPlan({ params: { projectId: "project-1" }, body: { request: "Build" } }),
    error => error.code === "AUTHENTICATION_REQUIRED" && error.status === 401,
  );
});

test("approves only the server-loaded persisted plan", async () => {
  const { handlers, calls } = fixture();
  const result = await handlers.approvePlan({
    ...ownerRequest, params: { planId: "plan-1" },
    body: { plan: { id: "forged-plan", status: "approved" } },
  });
  assert.equal(result.status, 200);
  assert.equal(calls.approve[0].plan.id, "plan-1");
  assert.equal(calls.approve[0].actor.id, "owner-1");
});

test("does not execute a plan until the persisted plan is approved", async () => {
  const { handlers, calls } = fixture({ planStatus: "proposed" });
  await assert.rejects(
    handlers.executeApprovedPlan({ ...ownerRequest, params: { planId: "plan-1" } }),
    error => error.code === "PLAN_NOT_APPROVED" && error.status === 409,
  );
  assert.equal(calls.execute.length, 0);
});

test("executes an approved plan and returns the workflow report", async () => {
  const { handlers, calls } = fixture({ planStatus: "approved" });
  const result = await handlers.executeApprovedPlan({
    ...ownerRequest, params: { planId: "plan-1" },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "completed");
  assert.deepEqual(result.body.recovery, { recovered: 1, tasks: [{ taskId: "task-recovered" }] });
  assert.deepEqual(calls.recover, [{ actor: ownerRequest.auth.actor, limit: 50 }]);
  assert.deepEqual(calls.order, ["recover", "workflow"]);
  assert.deepEqual(calls.execute, [{ planId: "plan-1", actor: ownerRequest.auth.actor }]);
});


test("does not dispatch when owner-authorized recovery is denied", async () => {
  const calls = { execute: [] };
  const deniedHandlers = createStudioHttpHandlers({
    runtime: {
      director: { plan: async () => ({}) },
      approval: { approve: async () => ({}) },
      recovery: { recover: async () => {
        throw Object.assign(new Error("forbidden"), { code: "EXECUTION_RECOVERY_FORBIDDEN" });
      } },
      workflow: { run: async value => { calls.execute.push(value); return { status: "completed" }; } },
    },
    loadProject: async () => null,
    loadPlan: async value => ({ id: value.planId, status: "approved" }),
  });
  await assert.rejects(
    deniedHandlers.executeApprovedPlan({ ...ownerRequest, params: { planId: "plan-1" } }),
    error => error.code === "EXECUTION_RECOVERY_FORBIDDEN",
  );
  assert.equal(calls.execute.length, 0);
});
test("bootstraps a workspace using only the verified request actor", async () => {
  const { handlers, calls } = fixture();
  const result = await handlers.bootstrapWorkspace({
    ...ownerRequest,
    body: {
      organizationName: "My Studio",
      projectName: "Universal Product",
      productProfileId: "saas-platform",
      brief: "Create a subscription management product",
      ownerActorId: "forged-owner",
    },
  });
  assert.equal(result.status, 201);
  assert.equal(calls.bootstrap[0].actor.id, "owner-1");
  assert.equal(calls.bootstrap[0].productProfileId, "saas-platform");
  assert.equal(calls.bootstrap[0].brief, "Create a subscription management product");
  assert.equal("ownerActorId" in calls.bootstrap[0], false);
});
