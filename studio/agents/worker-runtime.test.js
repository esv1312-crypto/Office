import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerRuntime } from "./worker-runtime.js";

const specialist = {
  id: "specialist-programmer",
  role: "Roblox developer",
  instructions: "Implement the assigned task and explain the result.",
  modelProfile: { preferredProvider: "openrouter", preferredModel: "configured-by-gateway" },
};

function fixture({ generated, startResult, completeResult, gatewayError } = {}) {
  const calls = { started: [], generated: [], completed: [], failed: [] };
  const store = {
    async startExecution(value) {
      calls.started.push(value);
      return startResult || {
        executionId: "execution-1",
        task: {
          id: "task-1",
          projectId: "project-1",
          title: "Build a lobby",
          description: "Create the first playable lobby.",
          status: "running",
          assigneeSpecialistId: specialist.id,
          version: 5,
        },
        execution: { attempt: 1 },
      };
    },
    async completeExecution(value) {
      calls.completed.push(value);
      return completeResult || { task: { status: "qa" }, artifactId: "artifact-1" };
    },
    async failExecution(value) {
      calls.failed.push(value);
    },
  };
  const modelGateway = {
    async generate(value) {
      calls.generated.push(value);
      if (gatewayError) throw gatewayError;
      return generated || {
        text: "The lobby implementation plan is ready.",
        modelSnapshot: { provider: "openrouter", model: "example-model", instructionVersion: 1 },
      };
    },
  };
  const runtime = createWorkerRuntime({
    store,
    modelGateway,
    now: () => "2026-11-07T01:00:00.000Z",
  });
  return { runtime, calls };
}

test("requires durable store and provider-neutral model gateway", () => {
  assert.throws(
    () => createWorkerRuntime({ store: {}, modelGateway: { generate() {} } }),
    /durable execution store contract/,
  );
  assert.throws(
    () => createWorkerRuntime({
      store: {
        startExecution() {},
        completeExecution() {},
        failExecution() {},
      },
      modelGateway: {},
    }),
    /modelGateway.generate is required/,
  );
});

test("claims an assigned task, invokes the gateway, stores an artifact, and hands off to QA", async () => {
  const { runtime, calls } = fixture();
  const result = await runtime.execute({
    taskId: "task-1",
    specialist,
    workerId: "worker-1",
  });

  assert.equal(calls.started.length, 1);
  assert.equal(calls.started[0].taskId, "task-1");
  assert.equal(calls.started[0].specialistId, specialist.id);
  assert.equal(calls.generated.length, 1);
  assert.equal(calls.generated[0].task.status, "running");
  assert.equal(calls.generated[0].specialist.instructions, specialist.instructions);
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].artifact.type, "text");
  assert.equal(calls.completed[0].artifact.content, result.output);
  assert.deepEqual(calls.completed[0].modelSnapshot, result.modelSnapshot);
  assert.equal(calls.failed.length, 0);
  assert.equal(result.status, "qa");
  assert.equal(result.artifactId, "artifact-1");
});

test("records model failures and does not create an artifact", async () => {
  const error = Object.assign(new Error("Provider unavailable"), { code: "PROVIDER_UNAVAILABLE" });
  const { runtime, calls } = fixture({ gatewayError: error });
  const result = await runtime.execute({
    taskId: "task-1",
    specialist,
    workerId: "worker-1",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "PROVIDER_UNAVAILABLE");
  assert.equal(calls.failed.length, 1);
  assert.equal(calls.failed[0].executionId, "execution-1");
  assert.equal(calls.completed.length, 0);
});

test("treats empty model output as a failed execution", async () => {
  const { runtime, calls } = fixture({
    generated: { text: "  ", modelSnapshot: { provider: "test", model: "empty" } },
  });
  const result = await runtime.execute({
    taskId: "task-1",
    specialist,
    workerId: "worker-1",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "EMPTY_MODEL_OUTPUT");
  assert.equal(calls.failed.length, 1);
  assert.equal(calls.completed.length, 0);
});

test("does not mark a generated result as model-failed when artifact persistence fails", async () => {
  const { runtime, calls } = fixture({
    completeResult: null,
  });
  await assert.rejects(
    runtime.execute({ taskId: "task-1", specialist, workerId: "worker-1" }),
    /did not confirm durable artifact and QA hand-off/,
  );
  assert.equal(calls.generated.length, 1);
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.failed.length, 0);
});

test("rejects a store response that did not claim the requested specialist", async () => {
  const { runtime, calls } = fixture({
    startResult: {
      executionId: "execution-1",
      task: {
        id: "task-1",
        title: "Build a lobby",
        status: "running",
        assigneeSpecialistId: "someone-else",
      },
    },
  });
  await assert.rejects(
    runtime.execute({ taskId: "task-1", specialist, workerId: "worker-1" }),
    /did not return the claimed running task/,
  );
  assert.equal(calls.generated.length, 0);
});
