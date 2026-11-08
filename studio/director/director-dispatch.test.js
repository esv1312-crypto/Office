import test from "node:test";
import assert from "node:assert/strict";
import { createDirectorDispatch } from "./director-dispatch.js";

const plan = { id: "plan-1", status: "approved" };
const specialists = [
  { id: "z-dev", organizationId: "org-1", status: "active", competencies: ["lua", "roblox", "ui"] },
  { id: "a-dev", organizationId: "org-1", status: "active", competencies: ["lua", "roblox"] },
  { id: "wrong-org", organizationId: "org-2", status: "active", competencies: ["lua", "roblox"] },
];
function setup(tasks) {
  const calls = [];
  const store = {
    loadApprovedPlanForDispatch: async () => ({ plan, organizationId: "org-1", tasks }),
    listActiveSpecialists: async () => specialists,
    retryFailedTask: async ({ taskId, expectedVersion, maxAttempts }) => {
      calls.push(["retry", taskId, expectedVersion, maxAttempts]);
      const task = tasks.find(item => item.id === taskId);
      return { task: { ...task, status: "assigned" }, attempt: 2 };
    },
    markTaskReady: async ({ taskId, expectedVersion }) => {
      calls.push(["ready", taskId, expectedVersion]);
      const task = tasks.find(item => item.id === taskId);
      return { task: { ...task, status: "ready", version: task.version + 1 } };
    },
  };
  const assignment = {
    assign: async ({ task, specialist, expectedVersion }) => {
      calls.push(["assign", task.id, specialist.id, expectedVersion]);
      return { task: { ...task, status: "assigned" } };
    },
  };
  const dispatch = createDirectorDispatch({
    store, assignment, authorize: async () => true,
    now: () => "2026-11-07T10:00:00.000Z",
  });
  return { dispatch, calls };
}

test("selects the closest compatible specialist and assigns planned tasks", async () => {
  const { dispatch, calls } = setup([{
    id: "task-1", projectId: "project-1", status: "planned", version: 2,
    requiredCompetencies: ["lua", "roblox"],
  }]);
  const result = await dispatch.dispatch({ planId: "plan-1", actor: { id: "owner" } });
  assert.equal(result.status, "dispatched");
  assert.deepEqual(result.assigned, [{ taskId: "task-1", specialistId: "a-dev", taskStatus: "assigned" }]);
  assert.deepEqual(calls[0], ["ready", "task-1", 2]);
  assert.deepEqual(calls[1], ["assign", "task-1", "a-dev", 3]);
});

test("reports tasks with no compatible specialist without assigning them", async () => {
  const { dispatch, calls } = setup([{
    id: "task-2", projectId: "project-1", status: "planned", version: 1,
    requiredCompetencies: ["sound-design"],
  }]);
  const result = await dispatch.dispatch({ planId: "plan-1", actor: { id: "owner" } });
  assert.equal(result.status, "blocked");
  assert.equal(result.blocked[0].taskId, "task-2");
  assert.equal(calls.length, 0);
});

test("does not dispatch without authorization", async () => {
  const { dispatch, calls } = setup([]);
  const secured = createDirectorDispatch({
    store: {
      loadApprovedPlanForDispatch: async () => ({ plan, organizationId: "org-1", tasks: [] }),
      listActiveSpecialists: async () => [],
      markTaskReady: async () => assert.fail("must not prepare"),
    },
    assignment: { assign: async () => assert.fail("must not assign") },
    authorize: async () => false,
  });
  await assert.rejects(
    secured.dispatch({ planId: "plan-1", actor: { id: "guest" } }),
    error => error.code === "PLAN_DISPATCH_FORBIDDEN",
  );
  assert.equal(calls.length, 0);
});

test("resumes assigned tasks and skips tasks already in QA", async () => {
  const { dispatch } = setup([
    { id: "task-3", projectId: "project-1", status: "assigned", version: 4, assigneeSpecialistId: "a-dev" },
    { id: "task-4", status: "qa", version: 5 },
  ]);
  const result = await dispatch.dispatch({ planId: "plan-1", actor: { id: "owner" } });
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].taskId, "task-4");
  assert.equal(result.assigned.length, 1);
  assert.equal(result.assigned[0].taskId, "task-3");
  assert.equal(result.assigned[0].resumed, true);
});

test("resumes already-assigned tasks with their existing active specialist", async () => {
  const { dispatch, calls } = setup([{
    id: "task-resume", projectId: "project-1", status: "assigned", version: 4,
    assigneeSpecialistId: "a-dev", requiredCompetencies: ["lua", "roblox"],
  }]);
  const result = await dispatch.dispatch({ planId: "plan-1", actor: { id: "owner" } });
  assert.equal(result.status, "dispatched");
  assert.deepEqual(result.assigned, [{
    taskId: "task-resume", specialistId: "a-dev", taskStatus: "assigned", resumed: true,
  }]);
  assert.equal(calls.length, 0, "resuming must not reassign or mutate the existing assignment");
});

test("blocks stale assignments whose specialist is no longer active", async () => {
  const { dispatch } = setup([{
    id: "task-stale", projectId: "project-1", status: "assigned", version: 4,
    assigneeSpecialistId: "missing-specialist", requiredCompetencies: ["lua"],
  }]);
  const result = await dispatch.dispatch({ planId: "plan-1", actor: { id: "owner" } });
  assert.equal(result.status, "blocked");
  assert.equal(result.blocked[0].code, "ASSIGNED_SPECIALIST_UNAVAILABLE");
});


test("retries a failed task once through the durable bounded-retry store", async () => {
  const { dispatch, calls } = setup([{
    id: "task-failed", projectId: "project-1", status: "failed", version: 6,
    assigneeSpecialistId: "a-dev", requiredCompetencies: ["lua", "roblox"],
  }]);
  const result = await dispatch.dispatch({ planId: "plan-1", actor: { id: "owner" } });
  assert.equal(result.status, "dispatched");
  assert.deepEqual(result.assigned, [{
    taskId: "task-failed", specialistId: "a-dev", taskStatus: "assigned",
    resumed: true, retry: true, attempt: 2,
  }]);
  assert.deepEqual(calls, [["retry", "task-failed", 6, 3]]);
});

test("limits each dispatch stage and explicitly defers remaining runnable tasks", async () => {
  const tasks = [1, 2, 3, 4].map(number => ({
    id: `task-${number}`, projectId: "project-1", status: "planned", version: 1,
    requiredCompetencies: ["lua", "roblox"],
  }));
  const { dispatch, calls } = setup(tasks);
  const result = await dispatch.dispatch({ planId: "plan-1", actor: { id: "owner" }, maxAssignments: 2 });
  assert.equal(result.status, "partially_dispatched");
  assert.deepEqual(result.assigned.map(item => item.taskId), ["task-1", "task-2"]);
  assert.deepEqual(result.deferred.map(item => item.taskId), ["task-3", "task-4"]);
  assert.ok(result.deferred.every(item => item.code === "EXECUTION_BATCH_LIMIT"));
  assert.equal(calls.filter(item => item[0] === "assign").length, 2);
});

test("rejects invalid dispatch batch limits", async () => {
  const { dispatch } = setup([]);
  await assert.rejects(
    dispatch.dispatch({ planId: "plan-1", actor: { id: "owner" }, maxAssignments: 0 }),
    /maxAssignments must be an integer between 1 and 8/,
  );
});
