import test from "node:test";
import assert from "node:assert/strict";
import { createTaskAssignment } from "./assign-task.js";

const task = { id: "task-1", projectId: "project-1", requiredCompetencies: ["roblox", "lua"] };
const specialist = {
  id: "spec-1", organizationId: "org-1", status: "active",
  competencies: ["roblox", "lua"], projectIds: ["project-1"],
};
const actor = { id: "owner-1" };

test("authorizes and persists a compatible assignment", async () => {
  let saved;
  const assignment = createTaskAssignment({
    store: { assignTask: async input => (saved = input) },
    authorize: async input => input.action === "task.assign",
    now: () => "2026-11-07T10:00:00.000Z",
  });
  const result = await assignment.assign({ task, specialist, actor, expectedVersion: 2 });
  assert.equal(result.taskId, "task-1");
  assert.equal(saved.specialistId, "spec-1");
  assert.equal(saved.expectedVersion, 2);
});

test("allows a primary specialist with partial competency coverage", async () => {
  let saved;
  const assignment = createTaskAssignment({
    store: { assignTask: async input => (saved = input) },
    authorize: async () => true,
    now: () => "2026-11-07T10:00:00.000Z",
  });
  const result = await assignment.assign({
    task,
    specialist: { ...specialist, competencies: ["roblox"] },
    actor,
    expectedVersion: 3,
  });
  assert.equal(result.taskId, "task-1");
  assert.equal(saved.specialistId, "spec-1");
  assert.equal(saved.expectedVersion, 3);
});

test("rejects assignments with zero competency coverage before persistence", async () => {
  const assignment = createTaskAssignment({
    store: { assignTask: async () => assert.fail("must not persist") },
    authorize: async () => true,
  });
  await assert.rejects(
    assignment.assign({ task, specialist: { ...specialist, competencies: ["javascript"] }, actor }),
    error => error.code === "SPECIALIST_COMPETENCY_MISMATCH",
  );
});

test("rejects unauthorized assignment", async () => {
  const assignment = createTaskAssignment({
    store: { assignTask: async () => assert.fail("must not persist") },
    authorize: async () => false,
  });
  await assert.rejects(
    assignment.assign({ task, specialist, actor }),
    error => error.code === "ASSIGNMENT_FORBIDDEN",
  );
});
