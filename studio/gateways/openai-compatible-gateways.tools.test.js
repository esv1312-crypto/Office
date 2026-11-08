import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatibleGateways } from "./openai-compatible-gateways.js";

function makeGateway(responses, workerTools) {
  const calls = [];
  const client = { chat: { completions: { create: async request => {
    calls.push(request);
    const next = responses.shift();
    return { choices: [{ message: next }] };
  } } } };
  const gateways = createOpenAiCompatibleGateways({
    client,
    provider: "openrouter",
    workerTools,
    models: {
      planner: { model: "planner" },
      worker: { model: "deepseek/deepseek-v4.1-flash-1017" },
      qa: { model: "qa" },
    },
  });
  return { gateway: gateways.workerModelGateway, calls };
}

const toolDefinition = {
  type: "function",
  function: { name: "read_repo_file", description: "Read an allowed source file", parameters: {
    type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false,
  } },
};

test("worker uses only specialist-granted tools and records real tool-call evidence", async () => {
  const responses = [
    { role: "assistant", content: null, tool_calls: [
      { id: "call-1", type: "function", function: { name: "read_repo_file", arguments: JSON.stringify({ path: "studio/agent-workspace/a.js" }) } },
    ] },
    { role: "assistant", content: "I inspected the file and found the issue." },
  ];
  const executed = [];
  const workerTools = {
    definitions: [toolDefinition],
    execute: async args => { executed.push(args); return { path: "studio/agent-workspace/a.js", branch: "studio-v1-foundation", sha: "verified-sha", range: { startLine: 1, endLine: 1, totalLines: 1 }, content: "export const x = 1;" }; },
  };
  const { gateway, calls } = makeGateway(responses, workerTools);
  const result = await gateway.generate({
    task: { id: "task-1", title: "Inspect source" },
    specialist: { id: "worker-1", role: "implementation_specialist", instructions: "Inspect", allowedTools: ["read_repo_file"] },
    execution: { attempt: 1, executionId: "exec-1" },
  });
  assert.equal(result.text, "I inspected the file and found the issue.");
  assert.equal(executed.length, 1);
  assert.equal(calls[0].tools.length, 1);
  assert.equal(calls[0].tools[0].function.name, "read_repo_file");
  assert.equal(calls[1].messages.at(-1).role, "tool");
  assert.equal(result.modelSnapshot.toolCallsExecuted, 1);
  assert.deepEqual(result.toolEvidence, [{ name: "read_repo_file", status: "ok", path: "studio/agent-workspace/a.js", branch: "studio-v1-foundation", sha: "verified-sha", range: { startLine: 1, endLine: 1, totalLines: 1 } }]);
  assert.equal(result.modelSnapshot.model, "deepseek/deepseek-v4.1-flash-1017");
});

test("worker without explicit allowedTools receives no tool definitions", async () => {
  const responses = [{ role: "assistant", content: "Text-only draft." }];
  const { gateway, calls } = makeGateway(responses, { definitions: [toolDefinition], execute: async () => ({}) });
  const result = await gateway.generate({
    task: { id: "task-1" },
    specialist: { id: "worker-2", role: "reviewer", instructions: "Review", allowedTools: [] },
    execution: {},
  });
  assert.equal(result.text, "Text-only draft.");
  assert.equal("tools" in calls[0], false);
});

test("fails closed if a specialist has a tool permission but the tool is not configured", async () => {
  const { gateway } = makeGateway([], null);
  await assert.rejects(gateway.generate({
    task: { id: "task-1" },
    specialist: { id: "worker-3", role: "builder", instructions: "Build", allowedTools: ["write_repo_file"] },
    execution: {},
  }), error => error.code === "WORKER_TOOLS_UNAVAILABLE");
});
