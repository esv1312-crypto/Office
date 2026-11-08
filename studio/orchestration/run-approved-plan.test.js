import test from "node:test";
import assert from "node:assert/strict";
import { createPlanExecutionWorkflow } from "./run-approved-plan.js";

const task = {
  id: "task-1", projectId: "project-1", organizationId: "org-1",
  title: "Build fan plaza", status: "assigned", acceptanceCriteria: ["Spawn points work"],
};
const builder = { id: "builder-1", organizationId: "org-1", status: "active",
  role: "Roblox Developer", instructions: "Build the feature.", competencies: ["lua"] };
const qaSpecialist = { id: "qa-1", organizationId: "org-1", status: "active",
  role: "QA Engineer", instructions: "Check acceptance criteria.", competencies: ["qa.review"] };

function fixture({ workerStatus = "qa", verdict = "accepted", reviewerList = [builder, qaSpecialist] } = {}) {
  const calls = { worker: [], qa: [] };
  const dispatch = { dispatch: async () => ({
    planId: "plan-1", status: "dispatched", assigned: [{ taskId: task.id, specialistId: builder.id }],
    blocked: [], skipped: [],
  }) };
  const workerPool = { executeAssignments: async assignments => {
    const input = assignments[0];
    calls.worker.push(input);
    return [{ executionId: "exec-1", taskId: task.id, specialistId: builder.id, status: workerStatus,
      artifactId: workerStatus === "qa" ? "artifact-1" : undefined,
      output: workerStatus === "qa" ? "Build result" : undefined,
      errorCode: workerStatus === "failed" ? "MODEL_FAILED" : undefined }];
  } };
  const qa = { review: async input => {
    calls.qa.push(input);
    return { taskId: task.id, verdict, taskStatus: verdict === "accepted" ? "completed" : "ready" };
  } };
  const directory = {
    getTask: async () => ({ ...task, status: "assigned", assigneeSpecialistId: builder.id }),
    getSpecialist: async () => builder,
    getLatestArtifactForTask: async () => null,
    listActiveSpecialists: async () => reviewerList,
  };
  const workflow = createPlanExecutionWorkflow({
    dispatch, workerPool, qa, directory,
  });
  return { workflow, calls };
}

test("runs an assigned task through Worker and independent QA", async () => {
  const { workflow, calls } = fixture();
  const result = await workflow.run({ planId: "plan-1", actor: { id: "owner" } });
  assert.equal(result.status, "completed");
  assert.equal(result.executions[0].status, "qa");
  assert.equal(result.qaReviews[0].verdict, "accepted");
  assert.equal(calls.worker[0].specialistId, builder.id);
  assert.equal(calls.qa[0].reviewer.id, qaSpecialist.id);
  assert.equal(calls.qa[0].artifact.specialistId, builder.id);
});

test("does not invoke QA when Worker fails", async () => {
  const { workflow, calls } = fixture({ workerStatus: "failed" });
  const result = await workflow.run({ planId: "plan-1", actor: { id: "owner" } });
  assert.equal(result.status, "needs_attention");
  assert.equal(result.qaReviews.length, 0);
  assert.equal(calls.qa.length, 0);
});

test("blocks QA handoff if no independent QA specialist exists", async () => {
  const { workflow, calls } = fixture({ reviewerList: [builder] });
  const result = await workflow.run({ planId: "plan-1", actor: { id: "owner" } });
  assert.equal(result.status, "needs_attention");
  assert.equal(result.blocked[0].code, "QA_REVIEWER_UNAVAILABLE");
  assert.equal(calls.qa.length, 0);
});

test("reports revision-required QA verdict as needing attention", async () => {
  const { workflow } = fixture({ verdict: "revision_required" });
  const result = await workflow.run({ planId: "plan-1", actor: { id: "owner" } });
  assert.equal(result.status, "needs_attention");
  assert.equal(result.qaReviews[0].taskStatus, "ready");
});


test("does not mark a zero-task, zero-dispatch plan as completed", async () => {
  const calls = { worker: [], qa: [] };
  const workflow = createPlanExecutionWorkflow({
    dispatch: { dispatch: async () => ({
      planId: "empty-plan", status: "dispatched", assigned: [], blocked: [], skipped: [],
    }) },
    workerPool: { executeAssignments: async assignments => {
      calls.worker.push(assignments);
      return [];
    } },
    qa: { review: async input => { calls.qa.push(input); return { verdict: "accepted" }; } },
    directory: {
      getTask: async () => null,
      getSpecialist: async () => null,
      getLatestArtifactForTask: async () => null,
      listActiveSpecialists: async () => [],
    },
  });
  const result = await workflow.run({ planId: "empty-plan", actor: { id: "owner" } });
  assert.equal(result.status, "needs_attention");
  assert.equal(result.executions.length, 0);
  assert.equal(result.qaReviews.length, 0);
  assert.equal(result.blocked[0].code, "NO_RUNNABLE_TASKS");
  assert.deepEqual(calls.worker, [[]]);
  assert.equal(calls.qa.length, 0);
});
