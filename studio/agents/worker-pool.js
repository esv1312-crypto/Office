/**
 * Bounded in-process Worker Pool.
 *
 * It consumes already-governed Director assignments. Durable claiming and
 * fencing remain the responsibility of Worker Runtime + PostgreSQL.
 */
export function createWorkerPool({ worker, directory, createWorkerId, concurrency = 2 }) {
  if (!worker || typeof worker.execute !== "function") throw new TypeError("worker.execute is required");
  if (!directory || typeof directory.getTask !== "function" ||
      typeof directory.getSpecialist !== "function") {
    throw new TypeError("Worker Pool requires task and specialist directory methods");
  }
  if (typeof createWorkerId !== "function") throw new TypeError("createWorkerId is required");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new TypeError("concurrency must be an integer between 1 and 32");
  }

  let activeWorkers = 0;
  const waitingWorkers = [];
  async function acquireWorkerSlot() {
    if (activeWorkers < concurrency) {
      activeWorkers += 1;
      return;
    }
    await new Promise(resolve => waitingWorkers.push(resolve));
  }
  function releaseWorkerSlot() {
    const next = waitingWorkers.shift();
    if (next) next();
    else activeWorkers -= 1;
  }

  return Object.freeze({
    concurrency,
    async executeAssignments(assignments) {
      if (!Array.isArray(assignments)) throw new TypeError("assignments must be an array");
      const results = new Array(assignments.length);
      let cursor = 0;
      const runWorker = async () => {
        while (true) {
          const index = cursor++;
          if (index >= assignments.length) return;
          const assignment = assignments[index];
          try {
            if (!assignment || typeof assignment.taskId !== "string" ||
                typeof assignment.specialistId !== "string") {
              throw Object.assign(new Error("Invalid dispatch assignment"), { code: "INVALID_ASSIGNMENT" });
            }
            const [task, specialist] = await Promise.all([
              directory.getTask({ taskId: assignment.taskId }),
              directory.getSpecialist({ specialistId: assignment.specialistId }),
            ]);
            if (!task || !specialist) {
              throw Object.assign(new Error("Assigned task or specialist no longer exists"), {
                code: "DISPATCH_DIRECTORY_LOOKUP_FAILED",
              });
            }
            if (task.status !== "assigned" || task.assigneeSpecialistId !== specialist.id) {
              throw Object.assign(new Error("Task assignment changed before Worker claim"), {
                code: "ASSIGNMENT_STALE",
              });
            }
            await acquireWorkerSlot();
            try {
              const result = await worker.execute({
                taskId: task.id, specialist, workerId: createWorkerId(),
              });
              results[index] = {
                taskId: task.id, specialistId: specialist.id,
                executionId: result?.executionId || null,
                status: result?.status || "invalid_worker_result",
                artifactId: result?.artifactId || null,
                output: result?.output,
                errorCode: result?.errorCode || null,
                error: result?.error || null,
              };
            } finally {
              releaseWorkerSlot();
            }
          } catch (error) {
            results[index] = {
              taskId: assignment?.taskId || null,
              specialistId: assignment?.specialistId || null,
              status: "failed",
              errorCode: error?.code || "WORKER_POOL_EXECUTION_FAILED",
              error: String(error?.message || error).slice(0, 1000),
            };
          }
        }
      };
      await Promise.all(Array.from(
        { length: Math.min(concurrency, assignments.length) },
        () => runWorker(),
      ));
      return results;
    },
  });
}
