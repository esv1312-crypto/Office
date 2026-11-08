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
    tools: [tool], executeTool: async () => ({ path: "src/main.js", branch: "studio-v1-foundation", sha: "source-blob-sha", range: { startLine: 10, endLine: 20, totalLines: 40 }, content: "hello" })
  });
  assert.equal(result.text, "Done.");
  assert.equal(result.toolCallsExecuted, 1);
  assert.deepEqual(result.toolEvidence, [{
    name: "read_file", status: "ok", path: "src/main.js",
    branch: "studio-v1-foundation", sha: "source-blob-sha",
    range: { startLine: 10, endLine: 20, totalLines: 40 },
  }]);
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


test("stops when cumulative prompt tokens exceed the task budget and records provider cost", async () => {
  const client = clientFor(async () => ({
    choices: [{ message: { tool_calls: [
      { id: "a", type: "function", function: { name: "read_file", arguments: "{}" } }
    ] } }],
    usage: { prompt_tokens: 101, completion_tokens: 2, cost: 0.0004 }
  }));
  await assert.rejects(runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "loop" }], tools: [tool],
    executeTool: async () => ({}), maxTotalPromptTokens: 100
  }), error => error.code === "PROMPT_TOKEN_BUDGET" &&
    error.usage.promptTokens === 101 && error.usage.providerCost === 0.0004);
});


test("applies a bounded provider timeout to each tool-loop request", async () => {
  let options;
  const client = clientFor(async (_request, requestOptions) => {
    options = requestOptions;
    return { choices: [{ message: { content: "Finished." } }] };
  });
  const result = await runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "inspect" }],
    tools: [tool], executeTool: async () => ({}),
  });
  assert.equal(result.text, "Finished.");
  assert.equal(options.timeout, 90_000);
});


test("includes exact content only for workspace verification-file read-backs", async () => {
  const client = clientFor(async request => {
    if (request.messages.length === 1) {
      return { choices: [{ message: { tool_calls: [
        { id: "readback-1", type: "function", function: { name: "read_repo_file", arguments: JSON.stringify({
          path: "studio/agent-workspace/verification/audit.md",
          branch: "studio-ai-agent-workspace",
          start_line: 1,
          end_line: 20,
        }) } },
      ] } }] };
    }
    return { choices: [{ message: { content: "Read-back checked." } }] };
  });
  const readRepoTool = { type: "function", function: { name: "read_repo_file", parameters: { type: "object" } } };
  const result = await runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "read back" }],
    tools: [readRepoTool],
    executeTool: async () => ({
      path: "studio/agent-workspace/verification/audit.md",
      branch: "studio-ai-agent-workspace",
      sha: "readback-sha",
      range: { startLine: 1, endLine: 2, totalLines: 2 },
      content: "# Evidence\nExact persisted text.",
    }),
  });
  assert.equal(result.toolEvidence[0].content, "# Evidence\nExact persisted text.");
  assert.equal(result.toolEvidence[0].sha, "readback-sha");
});


test("includes exact source snippets for the three audit source files only", async () => {
  const client = clientFor(async request => {
    if (request.messages.length === 1) {
      return { choices: [{ message: { tool_calls: [
        { id: "source-1", type: "function", function: { name: "read_repo_file", arguments: JSON.stringify({
          path: "studio/agents/worker-runtime.js",
          branch: "studio-v1-foundation",
          start_line: 175,
          end_line: 185,
        }) } },
      ] } }] };
    }
    return { choices: [{ message: { content: "Inspected." } }] };
  });
  const readRepoTool = { type: "function", function: { name: "read_repo_file", parameters: { type: "object" } } };
  const result = await runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "inspect source" }],
    tools: [readRepoTool],
    executeTool: async () => ({
      path: "studio/agents/worker-runtime.js",
      branch: "studio-v1-foundation",
      sha: "source-sha",
      range: { startLine: 175, endLine: 185, totalLines: 315 },
      content: "line 184: allowedTools is forwarded",
    }),
  });
  assert.equal(result.toolEvidence[0].contentKind, "source-snippet");
  assert.equal(result.toolEvidence[0].content, "line 184: allowedTools is forwarded");
});
