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


test("includes exact content for workspace verification-file read-backs", async () => {
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


test("includes exact content for product workspace read-backs so QA can inspect persisted files", async () => {
  const client = clientFor(async request => {
    if (request.messages.length === 1) {
      return { choices: [{ message: { tool_calls: [
        { id: "product-readback-1", type: "function", function: { name: "read_repo_file", arguments: JSON.stringify({
          path: "studio/agent-workspace/roblox-fan-district/Server/PointsSystem.server.lua",
          branch: "studio-ai-agent-workspace",
          start_line: 1,
          end_line: 10,
        }) } },
      ] } }] };
    }
    return { choices: [{ message: { content: "Product file read back and inspected." } }] };
  });
  const readRepoTool = { type: "function", function: { name: "read_repo_file", parameters: { type: "object" } } };
  const result = await runOpenAiToolLoop({
    client, model: "m", messages: [{ role: "user", content: "read back product source" }],
    tools: [readRepoTool],
    executeTool: async () => ({
      path: "studio/agent-workspace/roblox-fan-district/Server/PointsSystem.server.lua",
      branch: "studio-ai-agent-workspace",
      sha: "product-source-sha",
      range: { startLine: 1, endLine: 10, totalLines: 214 },
      content: "-- server-owned points logic\\nlocal Players = game:GetService(\"Players\")",
    }),
  });
  assert.equal(result.toolEvidence[0].contentKind, "workspace-product-readback");
  assert.match(result.toolEvidence[0].content, /server-owned points logic/);
  assert.equal(result.toolEvidence[0].sha, "product-source-sha");
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


test("compacts older tool rounds while retaining valid recent tool-call pairs and verified history", async () => {
  let requestCount = 0;
  const client = clientFor(async request => {
    requestCount += 1;
    if (requestCount > 1) {
      const messages = request.messages;
      for (let i = 0; i < messages.length; i += 1) {
        const item = messages[i];
        if (item.role === "assistant" && Array.isArray(item.tool_calls)) {
          const expected = item.tool_calls.map(call => call.id);
          const actual = messages.slice(i + 1, i + 1 + expected.length)
            .filter(message => message.role === "tool")
            .map(message => message.tool_call_id);
          assert.deepEqual(actual, expected, "compaction must preserve complete tool-call/result groups");
        }
      }
    }
    if (requestCount <= 6) {
      return {
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{
          id: "call-" + requestCount,
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path: "src/file-" + requestCount + ".js" }) },
        }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      };
    }
    const summary = request.messages.find(message =>
      message.role === "system" && String(message.content).includes("Earlier tool rounds were compacted"));
    assert.ok(summary, "older rounds should be summarized after the rolling window fills");
    assert.match(summary.content, /src\/file-1\.js/);
    assert.equal(request.messages.filter(message =>
      message.role === "assistant" && Array.isArray(message.tool_calls)).length, 4);
    return { choices: [{ message: { role: "assistant", content: "Finished after compaction." } }] };
  });
  const result = await runOpenAiToolLoop({
    client,
    model: "m",
    messages: [{ role: "system", content: "You are a worker." }, { role: "user", content: "Inspect six files." }],
    tools: [tool],
    executeTool: async ({ arguments: raw }) => ({ content: "read " + JSON.parse(raw).path }),
    maxRounds: 10,
    maxToolCalls: 10,
    maxTotalPromptTokens: 10000,
  });
  assert.equal(result.text, "Finished after compaction.");
  assert.equal(result.toolEvidence.length, 6);
  assert.equal(result.toolCallsExecuted, 6);
});


test("supports the expanded 40-round worker budget", async () => {
  let requests = 0;
  const client = clientFor(async () => {
    requests += 1;
    if (requests <= 21) {
      return {
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{
          id: "round-" + requests,
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path: "src/round-" + requests + ".js" }) },
        }] } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      };
    }
    return { choices: [{ message: { role: "assistant", content: "Completed after 21 rounds." } }] };
  });
  const result = await runOpenAiToolLoop({
    client,
    model: "m",
    messages: [{ role: "system", content: "worker" }, { role: "user", content: "inspect" }],
    tools: [tool],
    executeTool: async () => ({ ok: true }),
    maxRounds: 40,
    maxToolCalls: 30,
    maxTotalPromptTokens: 10000,
  });
  assert.equal(result.text, "Completed after 21 rounds.");
  assert.equal(result.toolCallsExecuted, 21);
  assert.equal(requests, 22);
});


test("supports 40 tool rounds with a bounded 512 KiB cumulative tool-result budget", async () => {
  let requests = 0;
  const client = clientFor(async () => {
    requests += 1;
    if (requests <= 40) {
      return {
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{
          id: "large-round-" + requests,
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path: "src/large-" + requests + ".js" }) },
        }] } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      };
    }
    return { choices: [{ message: { role: "assistant", content: "Finished 40 rounds." } }] };
  });
  const result = await runOpenAiToolLoop({
    client,
    model: "m",
    messages: [{ role: "system", content: "worker" }, { role: "user", content: "inspect a large workspace" }],
    tools: [tool],
    executeTool: async () => ({ content: "x".repeat(8 * 1024) }),
    maxRounds: 40,
    maxToolCalls: 100,
    maxToolResultBytes: 24 * 1024,
    maxTotalToolResultBytes: 512 * 1024,
    maxTotalPromptTokens: 10000,
  });
  assert.equal(result.text, "Finished 40 rounds.");
  assert.equal(result.toolCallsExecuted, 40);
  assert.equal(result.toolEvidence.length, 40);
  assert.equal(requests, 41);
});
