import { assertStudioTask } from "../contracts/task.js";

/**
 * Create a task in the draft state.
 * The caller owns ID generation, persistence, and authorization.
 */
export function createTask({
  id, projectId, title, description = "", requiredCompetencies = [], requiredTools = [], acceptanceCriteria = [], externalArtifact = true, at,
}) {
  if (!Array.isArray(requiredCompetencies) ||
      requiredCompetencies.some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("Task requiredCompetencies must be an array of non-empty strings");
  }
  if (!Array.isArray(requiredTools) || requiredTools.some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("Task requiredTools must be an array of non-empty strings");
  }
  if (!Array.isArray(acceptanceCriteria) ||
      acceptanceCriteria.some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("Task acceptanceCriteria must be an array of non-empty strings");
  }
  if (typeof externalArtifact !== "boolean") {
    throw new TypeError("Task externalArtifact must be a boolean");
  }
  const task = {
    id,
    projectId,
    title: typeof title === "string" ? title.trim() : title,
    description,
    requiredCompetencies: [...requiredCompetencies],
    requiredTools: [...new Set(requiredTools.map(value => value.trim()))],
    acceptanceCriteria: [...acceptanceCriteria],
    ...(externalArtifact === false ? { externalArtifact: false } : {}),
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
