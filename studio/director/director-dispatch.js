import { competencyCoverage, hasRequiredToolCoverage } from "../core/competency-matching.js";
/**
 * Dispatch approved plan tasks to compatible active specialists.
 * Assignment is deterministic; PostgreSQL remains the final authorization/scope gate.
 *
 * Director models may describe competencies in natural language while the
 * specialist directory stores canonical capability IDs. This adapter maps
 * natural-language competencies and separately enforces every explicitly
 * required worker tool before a specialist can be selected or resumed.
 */
function chooseSpecialist(task, specialists, organizationId) {
  return specialists
    .filter(specialist => specialist.status === "active" &&
      specialist.organizationId === organizationId &&
      (!specialist.projectIds?.length || specialist.projectIds.includes(task.projectId)) &&
      competencyCoverage(task, specialist) > 0 &&
      hasRequiredToolCoverage(task, specialist))
    .sort((a, b) => competencyCoverage(task, b) - competencyCoverage(task, a) || a.id.localeCompare(b.id))[0] || null;
}

export function createDirectorDispatch({
  store, assignment, authorize, now = () => new Date().toISOString(),
}) {
  if (!store || typeof store.loadApprovedPlanForDispatch !== "function" ||
      typeof store.listActiveSpecialists !== "function" ||
      typeof store.markTaskReady !== "function") {
    throw new TypeError("Dispatch requires approved-plan, specialist-list, and task-readiness store methods");
  }
  if (!assignment || typeof assignment.assign !== "function") {
    throw new TypeError("A governed task assignment service is required");
  }
  if (typeof authorize !== "function") throw new TypeError("Dispatch authorization is required");

  return Object.freeze({
    async dispatch({ planId, actor, maxAssignments = 3 }) {
      if (typeof planId !== "string" || !planId.trim()) throw new TypeError("planId is required");
      if (!Number.isInteger(maxAssignments) || maxAssignments < 1 || maxAssignments > 8) {
        throw new TypeError("maxAssignments must be an integer between 1 and 8");
      }
      const loaded = await store.loadApprovedPlanForDispatch({ planId: planId.trim() });
      const allowed = await authorize({ actor, action: "director.plan.dispatch", plan: loaded.plan });
      if (allowed !== true) throw Object.assign(new Error("Plan dispatch is not authorized"), { code: "PLAN_DISPATCH_FORBIDDEN" });

      const specialists = await store.listActiveSpecialists({ organizationId: loaded.organizationId });
      const report = { planId: loaded.plan.id, status: "dispatched", assigned: [], blocked: [], skipped: [], deferred: [] };

      for (const task of loaded.tasks) {
        if (task.status === "running" || task.status === "qa" || task.status === "completed") {
          report.skipped.push({ taskId: task.id, status: task.status });
          continue;
        }
        if (["failed", "assigned", "planned", "ready"].includes(task.status) &&
            report.assigned.length >= maxAssignments) {
          report.deferred.push({ taskId: task.id, status: task.status, code: "EXECUTION_BATCH_LIMIT" });
          continue;
        }
        if (task.status === "failed") {
          if (typeof store.retryFailedTask !== "function") {
            report.blocked.push({
              taskId: task.id,
              code: "TASK_RETRY_UNAVAILABLE",
              reason: "The durable task store does not support bounded retries",
            });
            continue;
          }
          try {
            const retried = await store.retryFailedTask({
              taskId: task.id,
              expectedVersion: task.version,
              maxAttempts: 3,
              at: now(),
              actorId: actor?.id || null,
            });
            report.assigned.push({
              taskId: task.id,
              specialistId: retried.task?.assigneeSpecialistId || task.assigneeSpecialistId,
              taskStatus: retried.task?.status || "assigned",
              resumed: true,
              retry: true,
              attempt: retried.attempt || null,
            });
          } catch (error) {
            report.blocked.push({
              taskId: task.id,
              code: error?.code || "TASK_RETRY_FAILED",
              reason: String(error?.message || error).slice(0, 500),
            });
          }
          continue;
        }
        if (task.status === "assigned") {
          // An assigned task may have a failed/expired execution while the task
          // remains assigned. Re-submit the existing assignment to the Worker
          // Pool so its durable execution store can start a fresh attempt.
          const existingAssignee = specialists.find(specialist =>
            specialist.id === task.assigneeSpecialistId &&
            specialist.status === "active" &&
            specialist.organizationId === loaded.organizationId &&
            (!specialist.projectIds?.length || specialist.projectIds.includes(task.projectId)));
          if (existingAssignee && !hasRequiredToolCoverage(task, existingAssignee)) {
            report.blocked.push({
              taskId: task.id, code: "ASSIGNED_SPECIALIST_CAPABILITY_MISMATCH",
              reason: "Assigned specialist does not have every worker tool required to resume this task",
              requiredTools: task.requiredTools || [],
            });
          } else if (existingAssignee && (
            !Array.isArray(task.requiredCompetencies) ||
            task.requiredCompetencies.length === 0 ||
            competencyCoverage(task, existingAssignee) > 0
          )) {
            report.assigned.push({
              taskId: task.id, specialistId: existingAssignee.id,
              taskStatus: "assigned", resumed: true,
            });
          } else {
            report.blocked.push({
              taskId: task.id, code: "ASSIGNED_SPECIALIST_UNAVAILABLE",
              reason: "Assigned task cannot be resumed because its specialist is inactive, outside project scope, or no longer covers the task",
            });
          }
          continue;
        }
        if (task.status !== "planned" && task.status !== "ready") {
          report.blocked.push({ taskId: task.id, reason: `Unexpected task status: ${task.status}` });
          continue;
        }
        const specialist = chooseSpecialist(task, specialists, loaded.organizationId);
        if (!specialist) {
          report.blocked.push({
            taskId: task.id, code: "NO_SPECIALIST_WITH_REQUIRED_CAPABILITIES",
            reason: "No active, in-scope specialist covers the task competencies and every required worker tool",
            requiredCompetencies: task.requiredCompetencies || [],
            requiredTools: task.requiredTools || [],
          });
          continue;
        }
        try {
          const ready = task.status === "ready"
            ? { task }
            : await store.markTaskReady({
                taskId: task.id, expectedVersion: task.version, at: now(), actorId: actor?.id || null,
              });
          const result = await assignment.assign({
            task: { ...ready.task, organizationId: loaded.organizationId },
            specialist, actor, expectedVersion: ready.task.version,
          });
          report.assigned.push({
            taskId: task.id, specialistId: specialist.id,
            taskStatus: result.task?.status || "assigned",
          });
        } catch (error) {
          report.blocked.push({ taskId: task.id, code: error?.code || "DISPATCH_FAILED", reason: String(error?.message || error).slice(0, 500) });
        }
      }

      if (report.blocked.length || report.deferred.length) {
        report.status = report.assigned.length ? "partially_dispatched" : "blocked";
      }
      return report;
    },
  });
}
