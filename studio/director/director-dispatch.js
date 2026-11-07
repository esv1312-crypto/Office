import { competencyCoverage } from "../core/competency-matching.js";
/**
 * Dispatch approved plan tasks to compatible active specialists.
 * Assignment is deterministic; PostgreSQL remains the final authorization/scope gate.
 *
 * Director models may describe competencies in natural language while the
 * specialist directory stores canonical capability IDs. This adapter maps
 * the known Roblox pilot vocabulary to those IDs and scores partial coverage:
 * cross-functional tasks still get a primary owner instead of being stranded
 * because one specialist cannot possess every skill in the task brief.
 */
function chooseSpecialist(task, specialists, organizationId) {
  return specialists
    .filter(specialist => specialist.status === "active" &&
      specialist.organizationId === organizationId &&
      (!specialist.projectIds?.length || specialist.projectIds.includes(task.projectId)) &&
      competencyCoverage(task, specialist) > 0)
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
    async dispatch({ planId, actor }) {
      if (typeof planId !== "string" || !planId.trim()) throw new TypeError("planId is required");
      const loaded = await store.loadApprovedPlanForDispatch({ planId: planId.trim() });
      const allowed = await authorize({ actor, action: "director.plan.dispatch", plan: loaded.plan });
      if (allowed !== true) throw Object.assign(new Error("Plan dispatch is not authorized"), { code: "PLAN_DISPATCH_FORBIDDEN" });

      const specialists = await store.listActiveSpecialists({ organizationId: loaded.organizationId });
      const report = { planId: loaded.plan.id, status: "dispatched", assigned: [], blocked: [], skipped: [] };

      for (const task of loaded.tasks) {
        if (task.status === "assigned") {
          // An assigned task has no active execution lease. Requeue it so a
          // restarted Director can resume work after an expired worker lease.
          const assignee = specialists.find(candidate =>
            candidate.id === task.assigneeSpecialistId &&
            candidate.status === "active" &&
            candidate.organizationId === loaded.organizationId
          );
          if (!assignee) {
            report.blocked.push({
              taskId: task.id,
              code: "ASSIGNED_SPECIALIST_UNAVAILABLE",
              reason: "The task's assigned specialist is not active in this organization",
            });
          } else {
            report.assigned.push({
              taskId: task.id,
              specialistId: assignee.id,
              taskStatus: "assigned",
              resumed: true,
            });
          }
          continue;
        }
        if (task.status === "running" || task.status === "qa" || task.status === "completed") {
          report.skipped.push({ taskId: task.id, status: task.status });
          continue;
        }
        if (task.status !== "planned" && task.status !== "ready") {
          report.blocked.push({ taskId: task.id, reason: `Unexpected task status: ${task.status}` });
          continue;
        }
        const specialist = chooseSpecialist(task, specialists, loaded.organizationId);
        if (!specialist) {
          report.blocked.push({
            taskId: task.id, reason: "No active specialist has a matching competency and project access",
            requiredCompetencies: task.requiredCompetencies || [],
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

      if (report.blocked.length) report.status = report.assigned.length ? "partially_dispatched" : "blocked";
      return report;
    },
  });
}
