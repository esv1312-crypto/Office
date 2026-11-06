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
  const empty = fixture({ contents: ["   "] }).gateways;
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
