import test from "node:test";
import assert from "node:assert/strict";
import { createOfficeTaskSubmissionService } from "./submit-office-task.js";

function fixture(overrides = {}) {
  const calls = { submissions: [], patches: [], runtime: [] };
  const service = createOfficeTaskSubmissionService({
    runtimeClient: {
      async submitTask(payload) {
        calls.runtime.push(payload);
        return { ok: true, task: { id: "legacy-task-42", status: "running" } };
      },
    },
    store: {
      async createSubmission(value) { calls.submissions.push(value); },
      async markSubmission(id, patch) { calls.patches.push({ id, patch }); },
    },
    getProject: async id => ({
      id,
      organizationId: "org-1",
      status: "active",
    }),
    authorize: async () => true,
    createId: (() => {
      let id = 0;
      return () => `id-${++id}`;
    })(),
    now: () => "2026-11-07T10:00:00.000Z",
    ...overrides,
  });
  return { service, calls };
}

test("requires durable persistence dependencies", () => {
  assert.throws(
    () => createOfficeTaskSubmissionService({
      runtimeClient: { submitTask() {} },
      store: {},
      getProject() {},
      authorize() {},
      createId() {},
    }),
    /durable submission store/,
  );
});

test("only an authenticated owner can submit work", async () => {
  const { service, calls } = fixture();
  await assert.rejects(
    service.submit({
      actor: { id: "member-1", role: "member" },
      projectId: "project-1",
      title: "Prepare a plan",
    }),
    error => error.code === "OWNER_APPROVAL_REQUIRED",
  );
  assert.equal(calls.runtime.length, 0);
  assert.equal(calls.submissions.length, 0);
});

test("checks project authorization before creating a submission", async () => {
  const { service, calls } = fixture({
    authorize: async () => false,
  });
  await assert.rejects(
    service.submit({
      actor: { id: "owner-1", role: "owner" },
      projectId: "project-1",
      title: "Prepare a plan",
    }),
    error => error.code === "POLICY_DENIED",
  );
  assert.equal(calls.runtime.length, 0);
});

test("persists intent before handing a root task to the Chief", async () => {
  const { service, calls } = fixture();
  const result = await service.submit({
    actor: { id: "owner-1", role: "owner" },
    projectId: "project-1",
    title: "Prepare an implementation plan",
    description: "Read-only analysis; no code changes.",
  });

  assert.equal(calls.submissions.length, 1);
  assert.equal(calls.submissions[0].status, "submitting");
  assert.equal(calls.submissions[0].ownerId, "owner-1");
  assert.equal(calls.runtime.length, 1);
  assert.equal(calls.runtime[0].employeeId, "chief");
  assert.equal(calls.runtime[0].kind, "root");
  assert.match(calls.runtime[0].task, /Read-only analysis/);
  assert.equal(calls.patches[0].patch.status, "accepted");
  assert.equal(calls.patches[0].patch.runtimeTaskId, "legacy-task-42");
  assert.equal(result.status, "accepted");
  assert.equal(result.runtimeTaskId, "legacy-task-42");
});

test("does not retry an ambiguous network failure and marks it unknown", async () => {
  let callsToRuntime = 0;
  const { service, calls } = fixture({
    runtimeClient: {
      async submitTask() {
        callsToRuntime += 1;
        const error = new Error("connection closed after request");
        error.code = "RUNTIME_UNREACHABLE";
        throw error;
      },
    },
  });

  const result = await service.submit({
    actor: { id: "owner-1", role: "owner" },
    projectId: "project-1",
    title: "Do not duplicate this task",
  });

  assert.equal(callsToRuntime, 1);
  assert.equal(result.status, "unknown");
  assert.equal(calls.patches[0].patch.status, "unknown");
});

test("rejects inactive projects without contacting the runtime", async () => {
  const { service, calls } = fixture({
    getProject: async id => ({ id, organizationId: "org-1", status: "archived" }),
  });

  await assert.rejects(
    service.submit({
      actor: { id: "owner-1", role: "owner" },
      projectId: "project-1",
      title: "Archived project task",
    }),
    error => error.code === "PROJECT_NOT_ACTIVE",
  );
  assert.equal(calls.runtime.length, 0);
});
