import test from "node:test";
import assert from "node:assert/strict";
import { getAllowedTaskTransitions, transitionTask } from "./task-state.js";

const task = () => ({
  id: "task-1",
  projectId: "project-1",
  title: "Create first Roblox prototype",
  status: "draft",
  assigneeSpecialistId: null,
  version: 1,
  createdAt: "2026-11-07T10:00:00.000Z",
  updatedAt: "2026-11-07T10:00:00.000Z",
});

test("allows only explicitly declared lifecycle transitions", () => {
  assert.deepEqual(getAllowedTaskTransitions("draft"), ["planned", "cancelled"]);
  assert.deepEqual(getAllowedTaskTransitions("qa"), ["completed", "ready", "failed"]);
  assert.deepEqual(getAllowedTaskTransitions("completed"), []);
});

test("transitions immutably and emits a versioned domain event", () => {
  const original = task();
  const result = transitionTask(original, "planned", {
    at: "2026-11-07T10:01:00.000Z",
  });

  assert.equal(original.status, "draft");
  assert.equal(original.version, 1);
  assert.equal(result.task.status, "planned");
  assert.equal(result.task.version, 2);
  assert.equal(result.event.eventType, "task.status_changed");
  assert.equal(result.event.aggregateVersion, 2);
  assert.equal(result.event.from, "draft");
  assert.equal(result.event.to, "planned");
});

test("rejects illegal transitions", () => {
  assert.throws(
    () => transitionTask(task(), "completed", { at: "2026-11-07T10:01:00.000Z" }),
    /Invalid task transition/,
  );
});

test("requires a reason for failure and cancellation", () => {
  const running = { ...task(), status: "running" };
  assert.throws(
    () => transitionTask(running, "failed", { at: "2026-11-07T10:01:00.000Z" }),
    /reason is required/,
  );
  assert.equal(
    transitionTask(running, "failed", {
      at: "2026-11-07T10:01:00.000Z",
      reason: "Worker exhausted its retry budget",
    }).task.status,
    "failed",
  );
});

test("rejects invalid task contracts and timestamps", () => {
  assert.throws(
    () => transitionTask({ ...task(), id: "" }, "planned", {
      at: "2026-11-07T10:01:00.000Z",
    }),
    /Task id is required/,
  );
  assert.throws(
    () => transitionTask(task(), "planned", { at: "not-a-date" }),
    /valid ISO-8601/,
  );
});
