import { hasCompetencyCoverage } from "../core/competency-matching.js";
/**
 * Governed deterministic assignment.
 * AI may recommend a specialist later; this policy remains the final gate.
 */
export function createTaskAssignment({ store, authorize, now = () => new Date().toISOString() }) {
  if (!store || typeof store.assignTask !== "function") throw new TypeError("A durable assignment store is required");
  if (typeof authorize !== "function") throw new TypeError("An authorization function is required");

  return Object.freeze({
    async assign({ task, specialist, actor, expectedVersion }) {
      if (!task || !specialist) throw new TypeError("Task and specialist are required");
      if (specialist.status !== "active") throw Object.assign(new Error("Specialist is not active"), { code: "SPECIALIST_NOT_ACTIVE" });
      if (task.organizationId && task.organizationId !== specialist.organizationId) {
        throw Object.assign(new Error("Task and specialist belong to different organizations"), { code: "ORGANIZATION_SCOPE_MISMATCH" });
      }
      if (task.projectId && specialist.projectIds?.length &&
          !specialist.projectIds.includes(task.projectId)) {
        throw Object.assign(new Error("Specialist is not permitted in this project"), { code: "PROJECT_SCOPE_MISMATCH" });
      }
      const requiredCompetencies = task.requiredCompetencies || [];
      const coversEveryRequirement = requiredCompetencies.length > 0 &&
        requiredCompetencies.every(requirement =>
          hasCompetencyCoverage({ requiredCompetencies: [requirement] }, specialist));
      if (!coversEveryRequirement) {
        throw Object.assign(new Error("Specialist does not cover all of the task's required competencies"), {
          code: "SPECIALIST_COMPETENCY_MISMATCH",
        });
      }
      const permitted = await authorize({ actor, action: "task.assign", task, specialist });
      if (permitted !== true) throw Object.assign(new Error("Task assignment is not authorized"), { code: "ASSIGNMENT_FORBIDDEN" });
      return store.assignTask({
        taskId: task.id,
        specialistId: specialist.id,
        expectedVersion,
        at: now(),
        actorId: actor?.id || null,
      });
    },
  });
}
