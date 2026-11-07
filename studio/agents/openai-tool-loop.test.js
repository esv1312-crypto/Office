import test from "node:test";
import assert from "node:assert/strict";
import { runOpenAiToolLoop } from "./openai-tool-loop.js";

const tool = { type: "function", function: { name: "read_file", parameters: { type: "object" } } };

test("executes a tool call, returns its result to the model, and continues to final answer", async () => {
  const calls = [];
  const client = { chat: { completions: { create: async request => {
    calls.push(request);
    if (calls.length === 1) return { choices: [{ message: { role: "assistant", content: null, tool_calls: [
      { id: "call-1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "studio/a.js" }) } },
    ] } }] };
    return { choices: [{ message: { role: "assistant", content: "Read complete." } }] };
  } } } };
  const result = await runOpenAiToolLoop({
    client, model: "deepseek/flash", messages: [{ role: "user", content: "Inspect file" }],
    tools: [tool], executeTool: async ({ name, arguments: args }) => ({ name, path: JSON.parse(args).path, content: "hello" }),
  });
  assert.equal(result.text, "Read complete.");
  assert.equal(result.toolCallsExecuted, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages.at(-1).role, "tool");
  assert.equal(JSON.parse(calls[1].messages.at(-1).content).content, "hello");
});

test("returns tool errors to the model without leaking stack traces", async () => {
  let round = 0;
  const client = { chat: { completions: { create: async request => {
    round += 1;
    if (round === 1) return { choices: [{ message: { tool_calls: [
      { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } },
    ] } }] };
    assert.match(request.messages.at(-1).content, /DENIED/);
    assert.doesNotMatch(request.messages.at(-1).content, /stack|secret-token/i);
    return { choices: [{ message: { content: "Permission respected." } }] };
  } } } };
  const result = await runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "read" }], tools: [tool],
    executeTool: async () => { throw Object.assign(new Error("DENIED"), { code: "DENIED" }); },
  });
  assert.equal(result.text, "Permission respected.");
});

test("rejects tool calls outside the granted definitions", async () => {
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { tool_calls: [
    { id: "call-1", type: "function", function: { name: "run_shell", arguments: "{}" } },
  ] } }] }) } } };
  await assert.rejects(runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "do it" }], tools: [tool],
    executeTool: async () => ({}),
  }), error => error.code === "TOOL_NOT_ALLOWED");
});

test("stops at the configured round limit", async () => {
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { tool_calls: [
    { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } },
  ] } }] }) } } };
  await assert.rejects(runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "loop" }], tools: [tool],
    executeTool: async () => ({}), maxRounds: 1,
  }), error => error.code === "TOOL_ROUND_LIMIT");
});
