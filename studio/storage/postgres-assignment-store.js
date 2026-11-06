import { hasCompetencyCoverage } from "../core/competency-matching.js";
import { insertOutboxEvent } from "./postgres-outbox-store.js";
/**
 * Atomic PostgreSQL assignment adapter for the independent Studio schema.
 * Accepts an injected pg-compatible pool; never connects or migrates by itself.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
}

export function createPostgresAssignmentStore({ pool, createId }) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A pg-compatible pool is required");
  if (typeof createId !== "function") throw new TypeError("createId is required");

  return Object.freeze({
    async assignTask({ taskId, specialistId, expectedVersion, at, actorId = null }) {
      const taskKey = required(taskId, "taskId");
      const specialistKey = required(specialistId, "specialistId");
      const timestamp = required(at, "at");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const taskResult = await client.query(
          `SELECT t.*, p.organization_id
             FROM studio.tasks t JOIN studio.projects p ON p.id = t.project_id
            WHERE t.id = $1 FOR UPDATE OF t`, [taskKey]);
        const task = taskResult.rows[0];
        if (!task) throw Object.assign(new Error("Task not found"), { code: "TASK_NOT_FOUND" });
        if (task.status !== "ready") throw Object.assign(new Error("Only ready tasks can be assigned"), { code: "TASK_NOT_READY" });
        if (expectedVersion !== undefined && Number(task.version) !== expectedVersion) {
          throw Object.assign(new Error("Task version conflict"), { code: "TASK_VERSION_CONFLICT" });
        }

        const specialistResult = await client.query(
          "SELECT id, organization_id, status, payload FROM studio.specialists WHERE id = $1 FOR SHARE",
          [specialistKey]);
        const specialist = specialistResult.rows[0];
        if (!specialist || specialist.status !== "active") {
          throw Object.assign(new Error("Specialist is missing or inactive"), { code: "SPECIALIST_NOT_ACTIVE" });
        }
        if (specialist.organization_id !== task.organization_id) {
          throw Object.assign(new Error("Specialist belongs to another organization"), { code: "ORGANIZATION_SCOPE_MISMATCH" });
        }
        const payload = task.payload || {};
        const specialistPayload = specialist.payload || {};
        const projectIds = Array.isArray(specialistPayload.projectIds) ? specialistPayload.projectIds : [];
        if (projectIds.length && !projectIds.includes(task.project_id)) {
          throw Object.assign(new Error("Specialist is not permitted in this project"), { code: "PROJECT_SCOPE_MISMATCH" });
        }
        if (!hasCompetencyCoverage(payload, specialistPayload)) {
          throw Object.assign(new Error("Specialist does not cover any of the task's required competencies"), {
            code: "SPECIALIST_COMPETENCY_MISMATCH",
          });
        }

        const nextTask = {
          ...payload, status: "assigned", assigneeSpecialistId: specialistKey,
          version: Number(task.version) + 1, updatedAt: timestamp,
        };
        await client.query(
          `UPDATE studio.tasks SET status = 'assigned', assignee_specialist_id = $2,
                  version = $3, payload = $4::jsonb, updated_at = $5 WHERE id = $1`,
          [taskKey, specialistKey, nextTask.version, JSON.stringify(nextTask), timestamp]);
        const eventId = requiredId(createId());
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
           VALUES ($1, $2, $3, 'task', $4, 'task.assigned', $5::jsonb, $6)`,
          [eventId, task.organization_id, task.project_id, taskKey,
            JSON.stringify({ specialistId: specialistKey, actorId }), timestamp]);
        await insertOutboxEvent(client, {
          eventId, organizationId: task.organization_id, projectId: task.project_id,
          aggregateType: "task", aggregateId: taskKey, eventType: "task.assigned",
          payload: { specialistId: specialistKey, actorId }, occurredAt: timestamp,
        });
        await client.query("COMMIT");
        return { task: nextTask, specialistId: specialistKey, eventId };
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
      } finally {
        client.release();
      }
    },
  });
}

function requiredId(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Generated eventId is required");
  return value.trim();
}
