import { assertStudioTask } from "../contracts/task.js";

/**
 * Create a task in the draft state.
 * The caller owns ID generation, persistence, and authorization.
 */
export function createTask({ id, projectId, title, description = "", at }) {
  const task = {
    id,
    projectId,
    title: typeof title === "string" ? title.trim() : title,
    description,
    status: "draft",
    assigneeSpecialistId: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };

  assertStudioTask(task);
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
    throw new TypeError("Task timestamp must be a valid ISO-8601 date");
  }
  if (typeof description !== "string") {
    throw new TypeError("Task description must be a string");
  }

  return task;
}
