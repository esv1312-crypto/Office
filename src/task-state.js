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

export function normalizeTaskSnapshotAfterRestart(snapshot, now = new Date().toISOString()) {
  const record = { ...snapshot };
  delete record.children;

  if (record.status === "planning" || record.status === "running") {
    record.status = "failed";
    record.error = "SERVICE_RESTART_INTERRUPTED";
    record.failedAt = now;
    record.startedAt = null;
    record.completedAt = null;
    record.restartInterrupted = true;
    return { record, changed: true };
  }

  if (record.status === "waiting") {
    record.startedAt = null;
    record.waitingReason = record.waitingReason || "service_restart";
    return { record, changed: true };
  }

  return { record, changed: false };
}
