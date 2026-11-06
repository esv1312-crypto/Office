import test from "node:test";
import assert from "node:assert/strict";
import { createStudioControlPlane } from "./create-studio-control-plane.js";

function fixture() {
  const calls = { database: 0, models: 0, routes: [] };
  const pool = {
    async connect() {
      calls.database += 1;
      throw new Error("No database connection during composition");
    },
    async query() {
      calls.database += 1;
      throw new Error("No database query during composition");
    },
  };
  const client = {
    chat: { completions: { create: async () => {
      calls.models += 1;
      return { choices: [{ message: { content: "{}" } }] };
    } } },
  };
  const express = {
    Router: () => ({ post: (...args) => calls.routes.push(args) }),
  };
  const authenticate = (_request, _response, next) => next();
  const rateLimit = (_request, _response, next) => next();
  const plane = createStudioControlPlane({
    express, pool, client,
    models: { planner: "planner", worker: "worker", qa: "qa" },
    provider: "test-provider",
    createId: () => "id",
    createWorkerId: () => "worker-id",
    authenticate,
    rateLimit,
  });
  return { plane, calls, authenticate, rateLimit };
}

test("composes access policy, model gateways, runtime and owner routes without side effects", () => {
  const { plane, calls, authenticate, rateLimit } = fixture();
  assert.equal(typeof plane.access.authorize, "function");
  assert.equal(typeof plane.access.loadProject, "function");
  assert.equal(typeof plane.access.loadPlan, "function");
  assert.equal(typeof plane.runtime.director.plan, "function");
  assert.equal(typeof plane.runtime.workflow.run, "function");
  assert.equal(calls.routes.length, 3);
  assert.ok(calls.routes.every(route => route[1] === authenticate && route[2] === rateLimit));
  assert.equal(calls.database, 0);
  assert.equal(calls.models, 0);
});

test("requires verified identity and rate limiting before building routes", () => {
  assert.throws(() => createStudioControlPlane({
    pool: { connect() {}, query() {} },
    client: { chat: { completions: { create() {} } } },
    models: { planner: "p", worker: "w", qa: "q" },
    createId() {}, createWorkerId() {}, rateLimit() {},
  }), /identity-provider middleware/);
  assert.throws(() => createStudioControlPlane({
    pool: { connect() {}, query() {} },
    client: { chat: { completions: { create() {} } } },
    models: { planner: "p", worker: "w", qa: "q" },
    createId() {}, createWorkerId() {}, authenticate() {},
  }), /rate-limit middleware/);
});

test("requires a pool with both transactional and scoped-query capabilities", () => {
  assert.throws(() => createStudioControlPlane({
    pool: { connect() {} },
    client: { chat: { completions: { create() {} } } },
    models: { planner: "p", worker: "w", qa: "q" },
    createId() {}, createWorkerId() {}, authenticate() {}, rateLimit() {},
  }), /PostgreSQL pool/);
});
