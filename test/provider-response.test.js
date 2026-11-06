import test from "node:test";
import assert from "node:assert/strict";
import { extractFinalAssistantText } from "../src/provider-response.js";

test("final assistant content is returned instead of separate reasoning", () => {
  assert.equal(
    extractFinalAssistantText({
      content: "Completed report with evidence.",
      reasoning: "The user wants me to think through the task first."
    }),
    "Completed report with evidence."
  );
});

test("reasoning-only provider payload is not treated as a final answer", () => {
  assert.equal(
    extractFinalAssistantText({
      content: null,
      reasoning: "The user wants me to report three facts. Let me think."
    }),
    ""
  );
});

test("reasoning_details are not treated as a final answer", () => {
  assert.equal(
    extractFinalAssistantText({
      content: "",
      reasoning_details: [{ text: "PREFLIGHT_OK" }]
    }),
    ""
  );
});

test("multimodal content parts are normalized to final text", () => {
  assert.equal(
    extractFinalAssistantText({
      content: [{ type: "text", text: "Fact A." }, { type: "text", text: "Fact B." }]
    }),
    "Fact A.\nFact B."
  );
});

test("legacy choice text remains supported when final content is absent", () => {
  assert.equal(extractFinalAssistantText({ content: null, reasoning: "internal only" }, "Legacy final answer."), "Legacy final answer.");
});

test("provider response diagnostics expose shape but never response or reasoning text", async () => {
  const { summarizeProviderResponse } = await import("../src/provider-response.js");
  const summary = summarizeProviderResponse({
    id: "resp_123", model: "example/model",
    choices: [{ finish_reason: "length", message: { role: "assistant", content: null, reasoning: "private reasoning text", reasoning_details: [{ type: "reasoning.text", text: "private detail" }], tool_calls: [] } }],
    usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 }
  }, 200, "req_abc");
  assert.equal(summary.httpStatus, 200);
  assert.equal(summary.requestId, "req_abc");
  assert.equal(summary.finishReason, "length");
  assert.equal(summary.contentType, "null");
  assert.equal(summary.contentChars, 0);
  assert.equal(summary.reasoningChars, 22);
  assert.equal(summary.reasoningDetailsCount, 1);
  assert.deepEqual(summary.usage, { promptTokens: 12, completionTokens: 34, totalTokens: 46 });
  assert.equal(JSON.stringify(summary).includes("private reasoning"), false);
  assert.equal(JSON.stringify(summary).includes("private detail"), false);
});
