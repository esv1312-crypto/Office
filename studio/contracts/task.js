/**
 * Universal AI Studio task contract (v1).
 *
 * Kept as plain ESM/JSDoc during the first compatibility phase so the
 * existing Node.js runtime can consume it without a TypeScript build step.
 *
 * @typedef {
 *   "draft" | "planned" | "ready" | "assigned" | "running" |
 *   "qa" | "completed" | "failed" | "cancelled"
 * } TaskStatus
 *
 * @typedef {Object} StudioTask
 * @property {string} id
 * @property {string} projectId
 * @property {string} title
 * @property {string} [description]
 * @property {TaskStatus} status
 * @property {string|null} [assigneeSpecialistId]
 * @property {number} version Monotonically increasing aggregate version.
 * @property {string} createdAt ISO-8601 timestamp.
 * @property {string} updatedAt ISO-8601 timestamp.
 *
 * @typedef {Object} TaskStatusChangedEvent
 * @property {string} eventType Always "task.status_changed" for this contract.
 * @property {string} aggregateId Task identifier.
 * @property {number} aggregateVersion Version after the transition.
 * @property {TaskStatus} from
 * @property {TaskStatus} to
 * @property {string} occurredAt ISO-8601 timestamp.
 * @property {string|null} reason
 */

export const TASK_STATUSES = Object.freeze([
  "draft",
  "planned",
  "ready",
  "assigned",
  "running",
  "qa",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Validate the minimum stable shape required by the task state machine.
 * @param {unknown} task
 * @returns {asserts task is import("./task.js").StudioTask}
 */
export function assertStudioTask(task) {
  if (!task || typeof task !== "object") {
    throw new TypeError("Task must be an object");
  }

  const candidate = /** @type {Record<string, unknown>} */ (task);
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    throw new TypeError("Task id is required");
  }
  if (typeof candidate.projectId !== "string" || !candidate.projectId.trim()) {
    throw new TypeError("Task projectId is required");
  }
  if (typeof candidate.title !== "string" || !candidate.title.trim()) {
    throw new TypeError("Task title is required");
  }
  if (!TASK_STATUSES.includes(/** @type {string} */ (candidate.status))) {
    throw new TypeError("Task status is invalid");
  }
  if (!Number.isInteger(candidate.version) || candidate.version < 1) {
    throw new TypeError("Task version must be a positive integer");
  }
}
