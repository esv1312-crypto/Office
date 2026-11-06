import test from "node:test";
import assert from "node:assert/strict";
import { createConfiguredStudioRuntime } from "./create-configured-studio-runtime.js";

function fixture() {
  const calls = { database: 0, models: [] };
  const pool = {
    async connect() {
      calls.database += 1;
      throw new Error("Database must not be contacted during composition");
    },
    async query() {
      calls.database += 1;
      throw new Error("Database must not be contacted during composition");
    },
  };
  const client = {
    chat: { completions: { create: async request => {
      calls.models.push(request);
      return { choices: [{ message: { content: "A bounded worker result." } }] };
    } } },
  };
  const runtime = createConfiguredStudioRuntime({
    pool,
    client,
    provider: "openrouter",
    models: {
      planner: "planner-model",
      worker: "worker-model",
      qa: "qa-model",
    },
    createId: () => "generated-id",
    createWorkerId: () => "worker-id",
    authorize: async () => false,
  });
  return { runtime, calls };
}

test("composes all Studio roles without connecting to database or provider", () => {
  const { runtime, calls } = fixture();
  assert.equal(typeof runtime.director.plan, "function");
  assert.equal(typeof runtime.approval.approve, "function");
  assert.equal(typeof runtime.workflow.run, "function");
  assert.equal(typeof runtime.gateways.planningGateway.generatePlan, "function");
  assert.equal(typeof runtime.gateways.workerModelGateway.generate, "function");
  assert.equal(typeof runtime.gateways.qaGateway.review, "function");
  assert.equal(calls.database, 0);
  assert.equal(calls.models.length, 0);
});

test("composed worker gateway uses its configured role model", async () => {
  const { runtime, calls } = fixture();
  const result = await runtime.gateways.workerModelGateway.generate({
    task: { id: "task-1", description: "Do bounded work" },
    specialist: { id: "builder", role: "Builder", instructions: "Complete the task" },
    execution: { attempt: 1 },
  });
  assert.equal(result.text, "A bounded worker result.");
  assert.equal(result.modelSnapshot.provider, "openrouter");
  assert.equal(result.modelSnapshot.model, "worker-model");
  assert.equal(calls.models.length, 1);
  assert.equal(calls.models[0].model, "worker-model");
  assert.equal(calls.database, 0);
});

test("requires a configured database pool and authorization policy", () => {
  assert.throws(() => createConfiguredStudioRuntime({
    client: {}, models: {}, createId() {}, createWorkerId() {}, authorize() {},
  }), /migrated Studio PostgreSQL pool/);
  assert.throws(() => createConfiguredStudioRuntime({
    pool: { connect() {} }, client: {}, models: {},
    createId() {}, createWorkerId() {},
  }), /governance authorization policy/);
});
