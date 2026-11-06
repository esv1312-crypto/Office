import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./create-project.js";
import { createTask } from "./create-task.js";

const at = "2026-11-07T10:00:00.000Z";

test("creates a project with explicit organization and product profile", () => {
  const project = createProject({
    id: "project-1",
    organizationId: "org-1",
    name: "Roblox Football Fans",
    productProfileId: "roblox",
    at,
  });

  assert.equal(project.id, "project-1");
  assert.equal(project.organizationId, "org-1");
  assert.equal(project.productProfileId, "roblox");
  assert.equal(project.status, "active");
  assert.equal(project.version, 1);
});

test("rejects a project without its organization or product profile", () => {
  assert.throws(() => createProject({
    id: "project-1",
    organizationId: "",
    name: "Test",
    productProfileId: "roblox",
    at,
  }), /organizationId is required/);
});

test("creates tasks in draft state without assigning a worker prematurely", () => {
  const task = createTask({
    id: "task-1",
    projectId: "project-1",
    title: "Build the first playable lobby",
    description: "Create a small prototype lobby.",
    at,
  });

  assert.equal(task.status, "draft");
  assert.equal(task.assigneeSpecialistId, null);
  assert.equal(task.version, 1);
});

test("rejects tasks with missing project or invalid timestamp", () => {
  assert.throws(() => createTask({
    id: "task-1",
    projectId: "",
    title: "Test",
    at,
  }), /projectId is required/);

  assert.throws(() => createTask({
    id: "task-1",
    projectId: "project-1",
    title: "Test",
    at: "invalid",
  }), /valid ISO-8601/);
});
