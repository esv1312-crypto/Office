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


test("planner does not switch models after a configured model access error", async () => {
  const calls = [];
  const client = {
    chat: { completions: { create: async request => {
      calls.push(request);
      throw Object.assign(new Error("configured model endpoint forbidden"), { status: 403 });
    } } },
  };
  const gateways = createOpenAiCompatibleGateways({
    client,
    models: {
      planner: "deepseek/deepseek-v4.1-flash-1017",
      worker: "openrouter/free",
      qa: "openrouter/free",
    },
  });
  await assert.rejects(
    gateways.planningGateway.generatePlan({
      request: "Create a self-development plan",
      project: { id: "project-1" },
    }),
    error => error.status === 403,
  );
  assert.equal(calls.length, 2, "the planner may retry the same configured model without JSON mode");
  assert.ok(calls.every(call => call.model === "deepseek/deepseek-v4.1-flash-1017"));
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


test("QA retries an empty structured response without JSON mode", async () => {
  const review = { verdict: "revision_required", findings: ["The evidence needs one correction."] };
  const { gateways, calls } = fixture({
    contents: ["", JSON.stringify(review)],
  });
  const result = await gateways.qaGateway.review({
    task: { id: "task-qa-retry", acceptanceCriteria: ["Evidence is verifiable"] },
    artifact: { id: "artifact-qa-retry", content: "Evidence with runtime tool trace" },
    reviewer: { id: "qa-reviewer" },
  });
  assert.equal(result.verdict, "revision_required");
  assert.deepEqual(result.findings, review.findings);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].request.response_format, { type: "json_object" });
  assert.equal("response_format" in calls[1].request, false);
  assert.equal(result.modelSnapshot.retryUsed, true);
  assert.equal(result.modelSnapshot.jsonMode, false);
});


test("QA fails closed after both response modes from the configured model are empty", async () => {
  const { gateways, calls } = fixture({ contents: ["", "", JSON.stringify({ verdict: "accepted", findings: [] })] });
  await assert.rejects(
    gateways.qaGateway.review({
      task: { id: "task-qa-no-fallback", acceptanceCriteria: ["Source claims match inspected lines"] },
      artifact: { id: "artifact-qa-no-fallback", content: "Runtime-verified tool evidence" },
      reviewer: { id: "qa-reviewer" },
    }),
    error => error.code === "EMPTY_MODEL_OUTPUT",
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.request.model === "qa-model"));
});


test("QA never cascades through unapproved free models after empty output", async () => {
  const { gateways, calls } = fixture({ contents: ["", "", "", ""] });
  await assert.rejects(
    gateways.qaGateway.review({
      task: { id: "task-qa-no-cascade", acceptanceCriteria: ["Claims match source snippets"] },
      artifact: { id: "artifact-qa-no-cascade", content: "Runtime-verified tool evidence" },
      reviewer: { id: "qa-reviewer" },
    }),
    error => error.code === "EMPTY_MODEL_OUTPUT",
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.request.model === "qa-model"));
});


test("settles a failed planner request conservatively so its reservation cannot remain pending", async () => {
  const events = [];
  const client = {
    chat: { completions: { create: async () => {
      throw Object.assign(new Error("provider unavailable"), { status: 400 });
    } } },
  };
  const modelBudget = {
    reserve: async () => ({ id: "planner-reservation", amountUsd: 0.01 }),
    settleFailure: async reservation => events.push(reservation.id),
    settle: async () => {},
  };
  const gateways = createOpenAiCompatibleGateways({
    client, modelBudget,
    models: { planner: "planner", worker: "worker", qa: "qa" },
  });
  await assert.rejects(
    gateways.planningGateway.generatePlan({ request: "Plan", project: {} }),
    error => error.status === 400,
  );
  assert.deepEqual(events, ["planner-reservation"]);
});
