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

  if (record.status === "accepted" || record.status === "planning" || record.status === "running") {
    record.status = "failed";
    record.error = "SERVICE_RESTART_INTERRUPTED";
    record.failedAt = now;
    record.startedAt = null;
    record.completedAt = null;
    record.restartInterrupted = true;
    return { record, changed: true };
  }

  if (record.status === "waiting") {
    // A parent waiting on in-flight subtasks cannot resume that in-memory work after restart.
    if (record.waitingReason === "subtasks_running") {
      record.status = "failed";
      record.error = "SERVICE_RESTART_INTERRUPTED";
      record.failedAt = now;
      record.startedAt = null;
      record.completedAt = null;
      record.restartInterrupted = true;
      record.waitingReason = null;
      return { record, changed: true };
    }

    // Configuration-blocked tasks are intentionally left waiting for an operator to fix setup.
    record.startedAt = null;
    record.waitingReason = record.waitingReason || "service_restart";
    return { record, changed: true };
  }

  return { record, changed: false };
}


export function validateSubtaskBatch(input, fallback = {}) {
  const items = Array.isArray(input) ? input : [fallback];
  if (items.length === 0) {
    return { ok: false, error: "at least one subtask is required" };
  }
  const normalized = [];
  for (const item of items) {
    const task = String(item?.task || "").trim();
    if (!task) {
      return { ok: false, error: "each subtask requires task" };
    }
    normalized.push({ ...item, task });
  }
  return { ok: true, items: normalized };
}


// Return elapsed milliseconds only when a non-root worker is eligible for watchdog failure.
// Invalid timestamps and already-processed records are deliberately ignored.
export function getWatchdogTimeoutAge(record, nowMs, timeoutMs) {
  if (!record || record.kind === "root") return null;
  if (!["running", "waiting"].includes(record.status)) return null;
  if (!record.startedAt || record.watchdogFailedAt) return null;
  const startedAtMs = Date.parse(record.startedAt);
  if (!Number.isFinite(startedAtMs)) return null;
  const ageMs = nowMs - startedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < timeoutMs) return null;
  return ageMs;
}
