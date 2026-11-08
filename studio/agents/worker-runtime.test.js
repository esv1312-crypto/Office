import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerRuntime } from "./worker-runtime.js";

const specialist = {
  id: "specialist-programmer",
  role: "Roblox developer",
  instructions: "Implement the assigned task and explain the result.",
  modelProfile: { preferredProvider: "openrouter", preferredModel: "configured-by-gateway" },
};

function fixture({ generated, startResult, completeResult, gatewayError, gatewayDelayMs = 0, heartbeatIntervalMs = 60_000, modelTimeoutMs, heartbeatError, artifactWriter } = {}) {
  const calls = { started: [], generated: [], completed: [], failed: [], heartbeats: [], artifacts: [] };
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
        execution: { attempt: 1, fencingToken: 1, leaseToken: "lease-1" },
      };
    },
    async completeExecution(value) {
      calls.completed.push(value);
      return completeResult === null ? null : (completeResult || { task: { status: "qa" }, artifactId: "artifact-1" });
    },
    async failExecution(value) {
      calls.failed.push(value);
    },
    async heartbeatExecution(value) {
      calls.heartbeats.push(value);
      if (heartbeatError) throw heartbeatError;
      return { executionId: value.executionId, leaseExpiresAt: "2026-11-07T01:05:00.000Z" };
    },
  };
  const modelGateway = {
    async generate(value) {
      calls.generated.push(value);
      if (gatewayError) throw gatewayError;
      if (gatewayDelayMs) await new Promise(resolve => setTimeout(resolve, gatewayDelayMs));
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
    heartbeatIntervalMs,
    ...(modelTimeoutMs !== undefined ? { modelTimeoutMs } : {}),
    ...(artifactWriter ? { artifactWriter: { async writeTextArtifact(value) { calls.artifacts.push(value); return artifactWriter(value); } } } : {}),
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
  assert.equal(calls.completed[0].fencingToken, 1);
  assert.equal(calls.completed[0].leaseToken, "lease-1");
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
  assert.equal(calls.failed[0].fencingToken, 1);
  assert.equal(calls.failed[0].leaseToken, "lease-1");
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
      execution: { fencingToken: 1, leaseToken: "lease-1" },
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


test("renews a worker lease through the durable store", async () => {
  const { runtime, calls } = fixture();
  const result = await runtime.heartbeat({ executionId: "execution-1", fencingToken: 1, leaseToken: "lease-1" });
  assert.equal(calls.heartbeats.length, 1);
  assert.equal(calls.heartbeats[0].executionId, "execution-1");
  assert.equal(calls.heartbeats[0].fencingToken, 1);
  assert.equal(result.executionId, "execution-1");
});


test("automatically renews the lease while a long model call is running", async () => {
  const { runtime, calls } = fixture({ gatewayDelayMs: 240, heartbeatIntervalMs: 100 });
  const result = await runtime.execute({ taskId: "task-1", specialist, workerId: "worker-1" });
  assert.equal(result.status, "qa");
  assert.ok(calls.heartbeats.length >= 1);
  assert.equal(calls.completed.length, 1);
});

test("does not commit a result after heartbeat reports a lost lease", async () => {
  const leaseError = Object.assign(new Error("Lease lost"), { code: "EXECUTION_LEASE_LOST" });
  const { runtime, calls } = fixture({
    gatewayDelayMs: 140, heartbeatIntervalMs: 100, heartbeatError: leaseError,
  });
  const result = await runtime.execute({ taskId: "task-1", specialist, workerId: "worker-1" });
  assert.equal(result.status, "lease_lost");
  assert.equal(calls.completed.length, 0);
  assert.equal(calls.failed.length, 0);
});


test("persists worker output to the approved repository workspace before database QA hand-off", async () => {
  const { runtime, calls } = fixture({
    artifactWriter: async value => ({
      path: value.path, branch: "studio-v1-foundation", sha256: "checksum",
      commitSha: "commit-1", provenance: value.provenance,
    }),
  });
  const result = await runtime.execute({ taskId: "task-1", specialist, workerId: "worker-1" });
  assert.equal(result.status, "qa");
  assert.equal(calls.artifacts.length, 1);
  assert.equal(calls.artifacts[0].path, "studio/projects/project-1/artifacts/task-1.md");
  assert.equal(calls.artifacts[0].provenance.executionId, "execution-1");
  assert.equal(calls.completed[0].artifact.external.commitSha, "commit-1");
  assert.equal(result.externalArtifact.sha256, "checksum");
});

test("fails the execution instead of handing off to QA when repository artifact writing fails", async () => {
  const { runtime, calls } = fixture({
    artifactWriter: async () => {
      throw Object.assign(new Error("private provider detail"), { code: "ARTIFACT_REPOSITORY_FORBIDDEN" });
    },
  });
  const result = await runtime.execute({ taskId: "task-1", specialist, workerId: "worker-1" });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "ARTIFACT_REPOSITORY_FORBIDDEN");
  assert.equal(result.error, "Artifact repository write failed");
  assert.equal(calls.failed.length, 1);
  assert.equal(calls.completed.length, 0);
});


test("skips the external artifact repository when the task explicitly opts out", async () => {
  const startResult = {
    executionId: "execution-1",
    task: {
      id: "task-1", projectId: "project-1", title: "Verify source",
      description: "Write only to isolated workspace.", status: "running",
      assigneeSpecialistId: specialist.id, version: 1, externalArtifact: false,
    },
    execution: { attempt: 1, fencingToken: 1, leaseToken: "lease-1" },
  };
  const { runtime, calls } = fixture({
    startResult,
    artifactWriter: async () => ({ commitSha: "must-not-be-written" }),
  });
  const result = await runtime.execute({ taskId: "task-1", specialist, workerId: "worker-1" });
  assert.equal(result.status, "qa");
  assert.equal(calls.artifacts.length, 0);
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].artifact.external, undefined);
});


test("appends authoritative tool metadata to the persisted artifact", async () => {
  const { runtime, calls } = fixture({
    generated: {
      text: "Source inspection report.",
      modelSnapshot: { provider: "openrouter", model: "test-model", instructionVersion: 1 },
      toolEvidence: [{
        name: "read_repo_file",
        status: "ok",
        path: "studio/server.js",
        branch: "studio-v1-foundation",
        sha: "verified-source-sha",
        range: { startLine: 160, endLine: 180, totalLines: 409 },
      }, {
        name: "write_repo_file",
        status: "ok",
        path: "studio/agent-workspace/verification/audit.md",
        branch: "studio-ai-agent-workspace",
        blobSha: "verified-workspace-blob",
        commitSha: "verified-commit",
      }, {
        name: "read_repo_file",
        status: "ok",
        path: "studio/agent-workspace/verification/audit.md",
        branch: "studio-ai-agent-workspace",
        sha: "verified-readback-sha",
        range: { startLine: 1, endLine: 2, totalLines: 2 },
        content: "# Evidence\\nExact persisted file text.",
      }],
    },
  });
  const result = await runtime.execute({ taskId: "task-1", specialist, workerId: "worker-1" });
  assert.equal(result.status, "qa");
  assert.match(result.output, /## Runtime-verified tool evidence/);
  assert.match(result.output, /verified-source-sha/);
  assert.match(result.output, /verified-workspace-blob/);
  assert.match(result.output, /studio-v1-foundation/);
  assert.match(result.output, /studio-ai-agent-workspace/);
  assert.match(result.output, /verified-readback-sha/);
  assert.match(result.output, /Exact persisted file text/);
  assert.equal(calls.completed[0].artifact.content, result.output);
});


test("fails a worker execution when the model gateway exceeds its hard deadline", async () => {
  const { runtime, calls } = fixture({
    gatewayDelayMs: 1_200,
    modelTimeoutMs: 1_000,
  });
  const result = await runtime.execute({
    taskId: "task-1",
    specialist,
    workerId: "worker-1",
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "MODEL_EXECUTION_TIMEOUT");
  assert.equal(calls.failed.length, 1);
  assert.equal(calls.completed.length, 0);
  assert.equal(calls.generated[0].signal.aborted, true);
});
