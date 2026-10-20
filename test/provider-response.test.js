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
