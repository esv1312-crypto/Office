import test from "node:test";
import assert from "node:assert/strict";
import { createStudioRuntime } from "./create-studio-runtime.js";

function dependencies(overrides = {}) {
  return {
    pool: { connect: async () => { throw new Error("must not connect during construction"); }, query: async () => { throw new Error("must not query during construction"); } },
    createId: () => "generated-id",
    createWorkerId: () => "worker-id",
    authorize: async () => true,
    planningGateway: { generatePlan: async () => ({}) },
    workerModelGateway: { generate: async () => ({}) },
    qaGateway: { review: async () => ({}) },
    ...overrides,
  };
}

test("composes Director, approval, dispatch, Worker, QA, and workflow without connecting", () => {
  const runtime = createStudioRuntime(dependencies());
  assert.equal(typeof runtime.director.plan, "function");
  assert.equal(typeof runtime.approval.approve, "function");
  assert.equal(typeof runtime.dispatch.dispatch, "function");
  assert.equal(typeof runtime.worker.execute, "function");
  assert.equal(typeof runtime.qa.review, "function");
  assert.equal(typeof runtime.workflow.run, "function");
  assert.ok(runtime.stores.domain);
  assert.ok(runtime.stores.assignment);
  assert.ok(runtime.stores.execution);
  assert.ok(runtime.stores.qa);
});

test("requires explicit database, governance, and gateway dependencies", () => {
  assert.throws(() => createStudioRuntime(dependencies({ pool: null })), /PostgreSQL pool/);
  assert.throws(() => createStudioRuntime(dependencies({ authorize: null })), /authorization policy/);
  assert.throws(() => createStudioRuntime(dependencies({ qaGateway: null })), /qaGateway.review/);
});
