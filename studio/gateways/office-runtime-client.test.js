import test from "node:test";
import assert from "node:assert/strict";
import {
  createOfficeRuntimeClient,
  OfficeRuntimeError,
} from "./office-runtime-client.js";

function jsonResponse(data, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(data);
    },
  };
}

test("requires an explicit runtime URL and audit token", () => {
  assert.throws(
    () => createOfficeRuntimeClient({ baseUrl: "", auditToken: "secret" }),
    /baseUrl is required/,
  );
  assert.throws(
    () => createOfficeRuntimeClient({ baseUrl: "https://office.example", auditToken: "" }),
    /auditToken is required/,
  );
});

test("submits a task to the existing Chief endpoint with the audit header", async () => {
  const calls = [];
  const client = createOfficeRuntimeClient({
    baseUrl: "https://office.example/",
    auditToken: "test-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true, task: { id: "task-123", status: "accepted" } }, { status: 202 });
    },
  });

  const result = await client.submitTask({
    task: "Prepare a read-only implementation plan",
  });

  assert.equal(result.task.id, "task-123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://office.example/api/tasks");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["x-ai-office-audit-token"], "test-secret");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    task: "Prepare a read-only implementation plan",
    employeeId: "chief",
    parentTaskId: null,
    kind: "root",
  });
});

test("reads task status using an encoded task identifier", async () => {
  const calls = [];
  const client = createOfficeRuntimeClient({
    baseUrl: "https://office.example",
    auditToken: "test-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true, task: { id: "task/a", status: "completed" } });
    },
  });

  const result = await client.getTask("task/a");

  assert.equal(result.task.status, "completed");
  assert.equal(calls[0].url, "https://office.example/api/tasks/task%2Fa");
  assert.equal(calls[0].options.method, "GET");
});

test("surfaces runtime errors without retrying task submission", async () => {
  let calls = 0;
  const client = createOfficeRuntimeClient({
    baseUrl: "https://office.example",
    auditToken: "test-secret",
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ ok: false, error: "task could not be durably accepted" }, { status: 503 });
    },
  });

  await assert.rejects(
    client.submitTask({ task: "A task that must not be duplicated" }),
    error => error instanceof OfficeRuntimeError
      && error.status === 503
      && error.code === "RUNTIME_REQUEST_REJECTED",
  );
  assert.equal(calls, 1);
});

test("reports malformed runtime responses", async () => {
  const client = createOfficeRuntimeClient({
    baseUrl: "https://office.example",
    auditToken: "test-secret",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() { return "not-json"; },
    }),
  });

  await assert.rejects(
    client.getState(),
    error => error instanceof OfficeRuntimeError && error.code === "INVALID_RUNTIME_RESPONSE",
  );
});
