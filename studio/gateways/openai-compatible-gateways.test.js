import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatibleGateways } from "./openai-compatible-gateways.js";

function fixture({ contents = [] } = {}) {
  const calls = [];
  const client = {
    chat: { completions: { create: async (request, options) => {
      calls.push({ request, options });
      const content = contents.length ? contents.shift() : "ok";
      return { choices: [{ message: { content } }] };
    } } },
  };
  const gateways = createOpenAiCompatibleGateways({
    client,
    provider: "openrouter",
    models: {
      planner: { model: "planner-model", temperature: 0.1, maxTokens: 3000, instructionVersion: 2 },
      worker: { model: "worker-model", temperature: 0.3, maxTokens: 5000 },
      qa: { model: "qa-model", temperature: 0, maxTokens: 2000 },
    },
  });
  return { gateways, calls };
}

test("planner requests structured JSON and returns a provider/model snapshot", async () => {
  const proposal = {
    title: "Plan",
    objective: "Objective",
    summary: "Summary",
    acceptanceCriteria: ["Criterion"],
    tasks: [{ title: "Task", description: "Do work",
      requiredCompetencies: ["javascript"], acceptanceCriteria: ["It works"] }],
  };
  const { gateways, calls } = fixture({ contents: [JSON.stringify(proposal)] });
  const result = await gateways.planningGateway.generatePlan({
    request: "Build a small feature",
    project: { id: "project-1" },
  });
  assert.deepEqual({ ...result, modelSnapshot: undefined }, { ...proposal, modelSnapshot: undefined });
  assert.deepEqual(calls[0].request.response_format, { type: "json_object" });
  assert.equal(result.modelSnapshot.provider, "openrouter");
  assert.equal(result.modelSnapshot.model, "planner-model");
  assert.equal(result.modelSnapshot.instructionVersion, 2);
});

test("planner retries empty output without JSON mode and accepts fenced JSON", async () => {
  const proposal = {
    title: "Recovered plan",
    objective: "Create a playable vertical slice",
    summary: "A compact first milestone.",
    acceptanceCriteria: ["A player can enter and complete the core loop."],
    tasks: [{
      title: "Build the greybox",
      description: "Create the first testable district block.",
      requiredCompetencies: ["roblox.worldbuilding"],
      acceptanceCriteria: ["The block is navigable and has a spawn point."],
    }],
  };
  const { gateways, calls } = fixture({
    contents: ["", "```json\n" + JSON.stringify(proposal) + "\n```"],
  });
  const result = await gateways.planningGateway.generatePlan({
    request: "Build the first Roblox district slice",
    project: { id: "project-1" },
  });
  assert.equal(result.title, "Recovered plan");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].request.response_format, { type: "json_object" });
  assert.equal("response_format" in calls[1].request, false);
});
test("worker forwards abort signal and returns text with a model snapshot", async () => {
  const { gateways, calls } = fixture({ contents: ["Implemented the assigned change."] });
  const controller = new AbortController();
  const result = await gateways.workerModelGateway.generate({
    task: { id: "task-1" },
    specialist: { id: "builder", role: "Developer", instructions: "Build it" },
    execution: { attempt: 1 },
    signal: controller.signal,
  });
  assert.equal(result.text, "Implemented the assigned change.");
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal("response_format" in calls[0].request, false);
  assert.equal(result.modelSnapshot.model, "worker-model");
});

test("QA requests JSON and preserves the independent reviewer verdict", async () => {
  const { gateways, calls } = fixture({
    contents: [JSON.stringify({ verdict: "accepted", findings: [] })],
  });
  const result = await gateways.qaGateway.review({
    task: { id: "task-1", acceptanceCriteria: ["Works"] },
    artifact: { id: "artifact-1", content: "Evidence" },
    reviewer: { id: "qa-1" },
  });
  assert.equal(result.verdict, "accepted");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(calls[0].request.response_format, { type: "json_object" });
  assert.equal(result.modelSnapshot.model, "qa-model");
});

test("rejects empty and invalid structured model output with stable error codes", async () => {
  const empty = fixture({ contents: ["   ", "   ", "   ", "   "] }).gateways;
  await assert.rejects(
    empty.planningGateway.generatePlan({ request: "x", project: {} }),
    error => error.code === "EMPTY_MODEL_OUTPUT",
  );
  const invalid = fixture({ contents: ["not-json"] }).gateways;
  await assert.rejects(
    invalid.qaGateway.review({ task: {}, artifact: {}, reviewer: {} }),
    error => error.code === "INVALID_MODEL_JSON",
  );
});

test("validates gateway client and all role model configurations up front", () => {
  assert.throws(() => createOpenAiCompatibleGateways({ client: {}, models: {} }),
    /chat completions client/);
  const { gateways } = fixture();
  assert.ok(gateways.planningGateway && gateways.workerModelGateway && gateways.qaGateway);
  assert.throws(() => createOpenAiCompatibleGateways({
    client: { chat: { completions: { create() {} } } },
    models: { planner: "p", worker: "w" },
  }), /models.qa/);
});


test("planner falls back to the free router after a model access error", async () => {
  const proposal = {
    title: "Fallback plan",
    objective: "Keep planning available",
    summary: "Use a compatible free route when the pinned endpoint is unavailable.",
    acceptanceCriteria: ["A valid plan is returned"],
    tasks: [{
      title: "Audit planner reliability",
      description: "Record provider errors and improve recovery.",
      requiredCompetencies: ["architecture"],
      acceptanceCriteria: ["The failure mode is documented"],
    }],
  };
  const calls = [];
  const client = {
    chat: { completions: { create: async request => {
      calls.push(request);
      if (request.model === "google/gemma-4-26b-a4b-it:free") throw Object.assign(new Error("model endpoint forbidden"), { status: 403 });
      return { choices: [{ message: { content: "Plan follows: " + JSON.stringify(proposal) + " End." } }] };
    } } },
  };
  const gateways = createOpenAiCompatibleGateways({
    client,
    models: {
      planner: "google/gemma-4-26b-a4b-it:free",
      worker: "openrouter/free",
      qa: "openrouter/free",
    },
  });
  const result = await gateways.planningGateway.generatePlan({
    request: "Create a self-development plan",
    project: { id: "project-1" },
  });
  assert.equal(result.title, "Fallback plan");
  assert.equal(calls[0].model, "google/gemma-4-26b-a4b-it:free");
  assert.equal(calls[2].model, "openrouter/free");
  assert.equal(result.modelSnapshot.fallbackUsed, true);
});

test("planner extracts a balanced JSON object surrounded by explanatory prose", async () => {
  const proposal = {
    title: "Extracted plan",
    objective: "Parse robustly",
    summary: "Ignore harmless surrounding text.",
    acceptanceCriteria: ["The plan is parsed"],
    tasks: [{
      title: "Test parsing",
      description: "Include braces inside a quoted string: {not a nested object}",
      requiredCompetencies: ["testing"],
      acceptanceCriteria: ["JSON object is recovered"],
    }],
  };
  const { gateways } = fixture({ contents: ["Here is the result:\\n" + JSON.stringify(proposal) + "\\nThat is all."] });
  const result = await gateways.planningGateway.generatePlan({
    request: "Create a plan",
    project: { id: "project-1" },
  });
  assert.equal(result.title, "Extracted plan");
});
