import { assertStudioTask, TASK_STATUSES } from "../contracts/task.js";

const TRANSITIONS = Object.freeze({
  draft: ["planned", "cancelled"],
  planned: ["ready", "cancelled"],
  ready: ["assigned", "cancelled"],
  assigned: ["running", "ready", "failed", "cancelled"],
  running: ["qa", "assigned", "failed", "cancelled"],
  qa: ["completed", "ready", "failed"],
  completed: [],
  failed: ["ready", "cancelled"],
  cancelled: [],
});

export function getAllowedTaskTransitions(status) {
  if (!TASK_STATUSES.includes(status)) {
    throw new TypeError(`Unknown task status: ${status}`);
  }
  return [...TRANSITIONS[status]];
}

/**
 * Apply one legal task transition without mutating the input.
 *
 * The caller supplies the timestamp to keep domain behavior deterministic
 * and testable. Persistence, event delivery, authorization, and concurrency
 * control belong to the application layer, not this pure function.
 *
 * @param {import("../contracts/task.js").StudioTask} task
 * @param {import("../contracts/task.js").TaskStatus} nextStatus
 * @param {{ at: string, reason?: string|null }} options
 */
export function transitionTask(task, nextStatus, { at, reason = null } = {}) {
  assertStudioTask(task);

  if (!TASK_STATUSES.includes(nextStatus)) {
    throw new TypeError(`Unknown task status: ${nextStatus}`);
  }
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
    throw new TypeError("A valid ISO-8601 transition timestamp is required");
  }

  const allowed = TRANSITIONS[task.status];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`Invalid task transition: ${task.status} -> ${nextStatus}`);
  }
  if ((nextStatus === "failed" || nextStatus === "cancelled") &&
      (typeof reason !== "string" || !reason.trim())) {
    throw new TypeError(`A reason is required when a task becomes ${nextStatus}`);
  }

  const updatedTask = {
    ...task,
    status: nextStatus,
    version: task.version + 1,
    updatedAt: at,
  };

  return {
    task: updatedTask,
    event: {
      eventType: "task.status_changed",
      aggregateId: task.id,
      aggregateVersion: updatedTask.version,
      from: task.status,
      to: nextStatus,
      occurredAt: at,
      reason,
    },
  };
}
