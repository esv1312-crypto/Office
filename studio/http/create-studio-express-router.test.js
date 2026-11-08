import test from "node:test";
import assert from "node:assert/strict";
import { createStudioExpressRouter } from "./create-studio-express-router.js";

function fixture() {
  const routes = [];
  const calls = { auth: [], rateLimit: [], bootstrap: [], plan: [], approve: [], recover: [], execute: [] };
  const authenticate = (_req, _res, next) => { calls.auth.push(true); next(); };
  const rateLimit = (_req, _res, next) => { calls.rateLimit.push(true); next(); };
  const runtime = {
    bootstrap: { bootstrap: async value => { calls.bootstrap.push(value); return { status: "plan_proposed" }; } },
    director: { plan: async value => {
      calls.plan.push(value);
      return { plan: { id: "plan-1", status: "proposed" }, tasks: [] };
    } },
    approval: { approve: async value => {
      calls.approve.push(value);
      return { plan: { id: value.plan.id, status: "approved" } };
    } },
    recovery: { recover: async value => {
      calls.recover.push(value);
      return { recovered: 0, tasks: [] };
    } },
    workflow: { run: async value => {
      calls.execute.push(value);
      return { planId: value.planId, status: "completed" };
    } },
  };
  const router = createStudioExpressRouter({
    express: { Router: () => ({ post: (...args) => routes.push(args) }) },
    runtime, authenticate, rateLimit,
    loadProject: async ({ projectId }) => ({
      id: projectId, organizationId: "org-1", productProfileId: "roblox", status: "active",
    }),
    loadPlan: async ({ planId }) => ({ id: planId, status: "approved" }),
  });
  return { router, routes, calls, authenticate, rateLimit };
}

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("registers all owner workflow routes behind authentication and rate limiting", () => {
  const { router, routes, authenticate, rateLimit } = fixture();
  assert.ok(router);
  assert.deepEqual(routes.map(route => route[0]), [
    "/bootstrap",
    "/projects/:projectId/plans",
    "/plans/:planId/approve",
    "/plans/:planId/execute",
  ]);
  for (const route of routes) {
    assert.equal(route[1], authenticate);
    assert.equal(route[2], rateLimit);
    assert.equal(typeof route[3], "function");
  }
});

test("creates plans through the Director and returns HTTP 201", async () => {
  const { routes, calls } = fixture();
  const response = responseRecorder();
  let forwarded;
  await routes[1][3]({
    auth: { actor: { id: "owner-1" } },
    params: { projectId: "project-1" },
    body: { request: "Build a prototype" },
  }, response, error => { forwarded = error; });
  assert.equal(forwarded, undefined);
  assert.equal(response.statusCode, 201);
  assert.equal(calls.plan[0].actor.id, "owner-1");
  assert.equal(calls.plan[0].project.id, "project-1");
});

test("forwards authentication and handler errors to Express error middleware", async () => {
  const { routes } = fixture();
  const response = responseRecorder();
  let forwarded;
  await routes[3][3]({
    params: { planId: "plan-1" },
  }, response, error => { forwarded = error; });
  assert.equal(forwarded.code, "AUTHENTICATION_REQUIRED");
  assert.equal(forwarded.status, 401);
  assert.equal(response.statusCode, null);
});

test("executes an approved plan and returns the workflow result", async () => {
  const { routes, calls } = fixture();
  const response = responseRecorder();
  await routes[3][3]({
    auth: { actor: { id: "owner-1" } },
    params: { planId: "plan-1" },
  }, response, error => { throw error; });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "completed");
  assert.deepEqual(response.body.recovery, { recovered: 0, tasks: [] });
  assert.deepEqual(calls.recover, [{ actor: { id: "owner-1" }, limit: 50 }]);
  assert.deepEqual(calls.execute, [{ planId: "plan-1", actor: { id: "owner-1" }, maxAssignments: 3 }]);
});


test("bootstraps a product workspace from one authenticated owner command", async () => {
  const { routes, calls } = fixture();
  const response = responseRecorder();
  await routes[0][3]({
    auth: { actor: { id: "owner-1" } },
    body: {
      organizationName: "My Studio",
      projectName: "First Product",
      productProfileId: "web-application",
      brief: "Build a useful web product",
    },
  }, response, error => { throw error; });
  assert.equal(response.statusCode, 201);
  assert.equal(calls.bootstrap[0].actor.id, "owner-1");
  assert.equal(calls.bootstrap[0].productProfileId, "web-application");
  assert.equal(calls.bootstrap[0].brief, "Build a useful web product");
});
