import test from "node:test";
import assert from "node:assert/strict";
import { createQaRuntime } from "./qa-runtime.js";

const task = { id: "task-1", title: "Build lobby", status: "qa",
  acceptanceCriteria: ["Spawn works", "No output errors"] };
const artifact = { id: "artifact-1", type: "text", name: "Lobby result",
  content: "Implementation evidence", specialistId: "builder-1" };
const reviewer = { id: "qa-1", role: "QA Engineer", status: "active",
  instructions: "Independently verify every acceptance criterion." };
function fixture({ verdict = "accepted", findings = [], allowed = true, reviewerOverride } = {}) {
  const calls = { gateway: [], stored: [] };
  const store = { recordQaReview: async value => {
    calls.stored.push(value);
    return { reviewId: "review-1", task: { status: value.verdict === "accepted" ? "completed" : "ready" } };
  } };
  const qaGateway = { review: async value => {
    calls.gateway.push(value);
    return { verdict, findings, modelSnapshot: { provider: "test", model: "qa-model", instructionVersion: 1 } };
  } };
  const runtime = createQaRuntime({ store, qaGateway, authorize: async () => allowed,
    now: () => "2026-11-07T12:00:00.000Z" });
  return { runtime, calls, reviewer: reviewerOverride || reviewer };
}
test("independent QA accepts a result and durably completes the task", async () => {
  const { runtime, calls } = fixture();
  const result = await runtime.review({ task, artifact, reviewer, actor: { id: "owner" } });
  assert.equal(result.verdict, "accepted");
  assert.equal(result.taskStatus, "completed");
  assert.equal(calls.gateway.length, 1);
  assert.deepEqual(calls.gateway[0].task.acceptanceCriteria, task.acceptanceCriteria);
  assert.equal(calls.stored[0].reviewerId, reviewer.id);
  assert.equal(calls.stored[0].producerSpecialistId, artifact.specialistId);
});
test("revision-required verdict returns task to ready for rework", async () => {
  const { runtime, calls } = fixture({ verdict: "revision_required", findings: ["Spawn fails on mobile"] });
  const result = await runtime.review({ task, artifact, reviewer, actor: { id: "owner" } });
  assert.equal(result.taskStatus, "ready");
  assert.deepEqual(calls.stored[0].findings, ["Spawn fails on mobile"]);
});
test("producer cannot review their own artifact", async () => {
  const { runtime, calls } = fixture({ reviewerOverride: { ...reviewer, id: artifact.specialistId } });
  await assert.rejects(
    runtime.review({ task, artifact, reviewer: calls.reviewer || { ...reviewer, id: artifact.specialistId } }),
    error => error.code === "QA_REVIEWER_MUST_BE_INDEPENDENT",
  );
  assert.equal(calls.gateway.length, 0);
});
test("authorization denial prevents model review and persistence", async () => {
  const { runtime, calls } = fixture({ allowed: false });
  await assert.rejects(
    runtime.review({ task, artifact, reviewer }),
    error => error.code === "QA_REVIEW_FORBIDDEN",
  );
  assert.equal(calls.gateway.length, 0);
  assert.equal(calls.stored.length, 0);
});
test("rejects invalid QA verdicts", async () => {
  const { runtime, calls } = fixture();
  calls.gateway.length = 0;
  const invalid = createQaRuntime({
    store: { recordQaReview: async () => assert.fail("must not persist") },
    qaGateway: { review: async () => ({ verdict: "maybe", findings: [], modelSnapshot: { provider: "test" } }) },
    authorize: async () => true,
  });
  await assert.rejects(invalid.review({ task, artifact, reviewer }), error => error.code === "INVALID_QA_VERDICT");
});
