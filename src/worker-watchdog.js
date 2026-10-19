import { getWatchdogTimeoutAge } from "./task-state.js";

export async function runWorkerWatchdogPass({
  tasks,
  nowMs = Date.now(),
  timeoutMs,
  transitionTask,
  emit,
  recoverFailedWorker,
  onRecoveryError = () => {}
}) {
  for (const record of tasks.values()) {
    const age = getWatchdogTimeoutAge(record, nowMs, timeoutMs);
    if (age === null) continue;

    const watchdogFailedAt = new Date(nowMs).toISOString();
    await transitionTask(record, "failed", {
      error: "WORKER_WATCHDOG_TIMEOUT",
      failedAt: watchdogFailedAt,
      watchdogFailedAt
    });
    emit("worker.watchdog_timeout", {
      taskId: record.id,
      parentTaskId: record.parentTaskId || null,
      employeeId: record.employeeId,
      ageMs: age,
      timeoutMs
    });

    const parent = record.parentTaskId ? tasks.get(record.parentTaskId) : null;
    if (parent && ["waiting", "running"].includes(parent.status)) {
      try {
        void Promise.resolve(recoverFailedWorker(parent, record)).catch(onRecoveryError);
      } catch (error) {
        onRecoveryError(error);
      }
    }
  }
}
