import test from "node:test";
import assert from "node:assert/strict";
import { runOpenAiToolLoop } from "./openai-tool-loop.js";

const tool = { type: "function", function: { name: "read_file", parameters: { type: "object" } } };
function clientFor(create) {
  return { chat: { completions: { create } } };
}

test("executes a tool call and returns a compact result to the model", async () => {
  const calls = [];
  const client = clientFor(async request => {
    calls.push(request);
    if (calls.length === 1) {
      return {
        choices: [{ message: { role: "assistant", content: null, tool_calls: [
          { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } }
        ] } }],
        usage: { prompt_tokens: 20, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 7 } }
      };
    }
    return {
      choices: [{ message: { role: "assistant", content: "Done." } }],
      usage: { prompt_tokens: 25, completion_tokens: 3 }
    };
  });
  const result = await runOpenAiToolLoop({
    client, model: "deepseek/flash", messages: [{ role: "user", content: "Inspect file" }],
    tools: [tool], executeTool: async () => ({ content: "hello" })
  });
  assert.equal(result.text, "Done.");
  assert.equal(result.toolCallsExecuted, 1);
  assert.equal(result.usage.promptTokens, 45);
  assert.equal(result.usage.completionTokens, 8);
  assert.equal(result.usage.cachedInputTokens, 7);
  assert.equal(calls[1].messages.at(-1).role, "tool");
});

test("caps oversized tool results before adding them to model context", async () => {
  let call = 0;
  const client = clientFor(async request => {
    call += 1;
    if (call === 1) {
      return { choices: [{ message: { tool_calls: [
        { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } }
      ] } }] };
    }
    const payload = JSON.parse(request.messages.at(-1).content);
    assert.equal(payload.truncated, true);
    assert.ok(Buffer.byteLength(request.messages.at(-1).content) < 700);
    return { choices: [{ message: { content: "Summarized." } }] };
  });
  const result = await runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "read" }], tools: [tool],
    executeTool: async () => ({ content: "x".repeat(5000) }), maxToolResultBytes: 512
  });
  assert.equal(result.text, "Summarized.");
});

test("stops before exceeding the total tool-call budget", async () => {
  const client = clientFor(async () => ({
    choices: [{ message: { tool_calls: [
      { id: "a", type: "function", function: { name: "read_file", arguments: "{}" } },
      { id: "b", type: "function", function: { name: "read_file", arguments: "{}" } }
    ] } }]
  }));
  await assert.rejects(runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "loop" }], tools: [tool],
    executeTool: async () => ({}), maxToolCalls: 1
  }), error => error.code === "TOOL_CALL_BUDGET");
});

test("stops when cumulative tool output exceeds the context budget", async () => {
  const client = clientFor(async () => ({
    choices: [{ message: { tool_calls: [
      { id: "a", type: "function", function: { name: "read_file", arguments: "{}" } }
    ] } }]
  }));
  await assert.rejects(runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "loop" }], tools: [tool],
    executeTool: async () => ({ content: "x".repeat(2000) }),
    maxToolResultBytes: 512, maxTotalToolResultBytes: 512
  }), error => error.code === "TOOL_CONTEXT_BUDGET");
});

test("rejects tool calls outside the granted definitions", async () => {
  const client = clientFor(async () => ({
    choices: [{ message: { tool_calls: [
      { id: "call-1", type: "function", function: { name: "run_shell", arguments: "{}" } }
    ] } }]
  }));
  await assert.rejects(runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "do it" }], tools: [tool],
    executeTool: async () => ({})
  }), error => error.code === "TOOL_NOT_ALLOWED");
});

test("stops at the configured round limit", async () => {
  const client = clientFor(async () => ({
    choices: [{ message: { tool_calls: [
      { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } }
    ] } }]
  }));
  await assert.rejects(runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "loop" }], tools: [tool],
    executeTool: async () => ({}), maxRounds: 1
  }), error => error.code === "TOOL_ROUND_LIMIT");
});
