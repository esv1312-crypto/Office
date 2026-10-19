export const TASK_STATES = new Set(["accepted","planning","running","waiting","completed","failed","cancelled"]);

const ALLOWED_TRANSITIONS = Object.freeze({
  accepted: new Set(["planning","running","waiting","failed","cancelled"]),
  planning: new Set(["running","waiting","failed","cancelled"]),
  running: new Set(["waiting","completed","failed","cancelled"]),
  waiting: new Set(["running","completed","failed","cancelled"]),
  completed: new Set([]),
  failed: new Set(["planning","running","cancelled"]),
  cancelled: new Set([])
});

export function assertTaskTransitionAllowed(currentStatus, nextStatus) {
  if (!TASK_STATES.has(nextStatus)) {
    throw new Error("Invalid task state: " + nextStatus);
  }
  if (currentStatus !== nextStatus && !ALLOWED_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    throw new Error("Invalid task transition: " + currentStatus + " -> " + nextStatus);
  }
  return true;
}
