import test from "node:test";
import assert from "node:assert/strict";
import { createTask } from "./create-task.js";

test("creates a draft task with explicit required worker tools", () => {
  const task = createTask({
    id: "task-1", projectId: "project-1", title: "Implement source patch",
    requiredCompetencies: ["implementation"],
    requiredTools: ["write_repo_file", "read_repo_file"],
    acceptanceCriteria: ["The saved file is read back"],
    at: "2026-11-10T00:00:00.000Z",
  });
  assert.deepEqual(task.requiredTools, ["write_repo_file", "read_repo_file"]);
  assert.equal(task.status, "draft");
});

test("rejects malformed required tool declarations", () => {
  assert.throws(() => createTask({
    id: "task-2", projectId: "project-1", title: "Bad task",
    requiredTools: ["write_repo_file", " "],
    at: "2026-11-10T00:00:00.000Z",
  }), /requiredTools/);
});
