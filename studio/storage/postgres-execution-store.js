import { insertOutboxEvent } from "./postgres-outbox-store.js";
/**
 * PostgreSQL adapter for the independent Studio Worker Runtime.
 *
 * This adapter accepts a pg-compatible Pool. It never creates a connection,
 * reads environment variables, applies migrations, or falls back to memory.
 * The caller must provide a dedicated Studio database with migration 001
 * already applied.
 */

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}

function asObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function taskFromRow(row) {
  if (!row) return null;
  return row.payload;
}

export function createPostgresExecutionStore({ pool, createId }) {
  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("A pg-compatible pool is required");
  }
  if (typeof createId !== "function") {
    throw new TypeError("createId is required");
  }

  return Object.freeze({
    async startExecution({ taskId, specialistId, workerId, at }) {
      const id = required(taskId, "taskId");
      const specialist = required(specialistId, "specialistId");
      const worker = required(workerId, "workerId");
      const timestamp = required(at, "at");

      return inTransaction(pool, async client => {
        const selected = await client.query(
          `SELECT t.id, t.status, t.assignee_specialist_id, t.version, t.payload,
                  p.organization_id
             FROM studio.tasks t
             JOIN studio.projects p ON p.id = t.project_id
            WHERE t.id = $1
            FOR UPDATE OF t`,
          [id],
        );
        const row = selected.rows[0];
        if (!row) throw Object.assign(new Error("Task not found"), { code: "TASK_NOT_FOUND" });
        if (row.status !== "assigned") {
          throw Object.assign(new Error("Task is not ready for execution"), { code: "TASK_NOT_ASSIGNED" });
        }
        if (row.assignee_specialist_id !== specialist) {
          throw Object.assign(new Error("Task is assigned to a different specialist"), {
            code: "SPECIALIST_ASSIGNMENT_MISMATCH",
          });
        }

        const specialistResult = await client.query(
          "SELECT id FROM studio.specialists WHERE id = $1 AND status = 'active' FOR SHARE",
          [specialist],
        );
        if (!specialistResult.rows[0]) {
          throw Object.assign(new Error("Assigned specialist is not active"), {
            code: "SPECIALIST_NOT_ACTIVE",
          });
        }

        const attemptResult = await client.query(
          "SELECT COALESCE(MAX(attempt), 0) + 1 AS next_attempt FROM studio.executions WHERE task_id = $1",
          [id],
        );
        const attempt = Number(attemptResult.rows[0]?.next_attempt || 1);
        const executionId = required(createId(), "generated executionId");
        const nextTask = {
          ...taskFromRow(row),
          status: "running",
          version: Number(row.version) + 1,
          updatedAt: timestamp,
        };

        await client.query(
          `UPDATE studio.tasks
              SET status = 'running', version = $2, payload = $3::jsonb, updated_at = $4
            WHERE id = $1`,
          [id, nextTask.version, JSON.stringify(nextTask), timestamp],
        );
        await client.query(
          `INSERT INTO studio.executions
             (id, task_id, specialist_id, worker_id, status, attempt, started_at)
           VALUES ($1, $2, $3, $4, 'running', $5, $6)`,
          [executionId, id, specialist, worker, attempt, timestamp],
        );
        const startedEventId = required(createId(), "generated eventId");
        const startedPayload = { executionId, specialistId: specialist, workerId: worker, attempt };
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, project_id, aggregate_type, aggregate_id,
              event_type, payload, occurred_at)
           SELECT $1, p.organization_id, t.project_id, 'task', t.id,
                  'execution.started', $2::jsonb, $3
             FROM studio.tasks t
             JOIN studio.projects p ON p.id = t.project_id
            WHERE t.id = $4`,
          [startedEventId, JSON.stringify(startedPayload), timestamp, id],
        );
        const startedScope = await client.query(
          "SELECT p.organization_id, t.project_id FROM studio.tasks t JOIN studio.projects p ON p.id = t.project_id WHERE t.id = $1",
          [id],
        );
        await insertOutboxEvent(client, { eventId: startedEventId, organizationId: startedScope.rows[0].organization_id, projectId: startedScope.rows[0].project_id, aggregateType: "task", aggregateId: id, eventType: "execution.started", payload: startedPayload, occurredAt: timestamp });

        return {
          executionId,
          task: nextTask,
          execution: { id: executionId, attempt, workerId: worker, startedAt: timestamp },
        };
      });
    },

    async completeExecution({ executionId, output, modelSnapshot, artifact, at }) {
      const id = required(executionId, "executionId");
      const text = required(output, "output");
      const snapshot = asObject(modelSnapshot, "modelSnapshot");
      const artifactInput = asObject(artifact, "artifact");
      const timestamp = required(at, "at");

      return inTransaction(pool, async client => {
        const executionResult = await client.query(
          "SELECT * FROM studio.executions WHERE id = $1 FOR UPDATE",
          [id],
        );
        const execution = executionResult.rows[0];
        if (!execution) throw Object.assign(new Error("Execution not found"), { code: "EXECUTION_NOT_FOUND" });

        const existingArtifact = await client.query(
          "SELECT id FROM studio.artifacts WHERE execution_id = $1",
          [id],
        );
        if (execution.status === "qa" && existingArtifact.rows[0]) {
          const taskResult = await client.query("SELECT payload FROM studio.tasks WHERE id = $1", [execution.task_id]);
          return { task: taskResult.rows[0]?.payload || null, artifactId: existingArtifact.rows[0].id };
        }
        if (execution.status !== "running") {
          throw Object.assign(new Error("Execution is not running"), { code: "EXECUTION_NOT_RUNNING" });
        }

        const taskResult = await client.query(
          "SELECT id, status, version, payload FROM studio.tasks WHERE id = $1 FOR UPDATE",
          [execution.task_id],
        );
        const taskRow = taskResult.rows[0];
        if (!taskRow || taskRow.status !== "running") {
          throw Object.assign(new Error("Task is not running"), { code: "TASK_NOT_RUNNING" });
        }

        const artifactId = required(createId(), "generated artifactId");
        const eventId = required(createId(), "generated eventId");
        const nextTask = {
          ...taskFromRow(taskRow),
          status: "qa",
          version: Number(taskRow.version) + 1,
          updatedAt: timestamp,
        };
        await client.query(
          `INSERT INTO studio.artifacts
             (id, task_id, execution_id, artifact_type, name, content,
              created_by_worker_id, specialist_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
          [artifactId, execution.task_id, id,
            required(artifactInput.type, "artifact.type"),
            required(artifactInput.name, "artifact.name"),
            JSON.stringify({ content: text, modelSnapshot: snapshot }),
            required(artifactInput.createdByWorkerId, "artifact.createdByWorkerId"),
            required(artifactInput.specialistId, "artifact.specialistId"),
            timestamp],
        );
        await client.query(
          `UPDATE studio.executions
              SET status = 'qa', output = $2, model_snapshot = $3::jsonb, finished_at = $4
            WHERE id = $1`,
          [id, text, JSON.stringify(snapshot), timestamp],
        );
        await client.query(
          `UPDATE studio.tasks
              SET status = 'qa', version = $2, payload = $3::jsonb, updated_at = $4
            WHERE id = $1`,
          [taskRow.id, nextTask.version, JSON.stringify(nextTask), timestamp],
        );
        const artifactPayload = { executionId: id, artifactId, specialistId: execution.specialist_id };
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, project_id, aggregate_type, aggregate_id,
              event_type, payload, occurred_at)
           SELECT $1, p.organization_id, t.project_id, 'task', t.id,
                  'artifact.created', $2::jsonb, $3
             FROM studio.tasks t
             JOIN studio.projects p ON p.id = t.project_id
            WHERE t.id = $4`,
          [eventId, JSON.stringify(artifactPayload), timestamp, taskRow.id],
        );
        const artifactScope = await client.query(
          "SELECT p.organization_id, t.project_id FROM studio.tasks t JOIN studio.projects p ON p.id = t.project_id WHERE t.id = $1",
          [taskRow.id],
        );
        await insertOutboxEvent(client, { eventId, organizationId: artifactScope.rows[0].organization_id, projectId: artifactScope.rows[0].project_id, aggregateType: "task", aggregateId: taskRow.id, eventType: "artifact.created", payload: artifactPayload, occurredAt: timestamp });

        return { task: nextTask, artifactId };
      });
    },

    async failExecution({ executionId, reason, at }) {
      const id = required(executionId, "executionId");
      const failureReason = required(reason, "reason").slice(0, 1000);
      const timestamp = required(at, "at");

      return inTransaction(pool, async client => {
        const executionResult = await client.query(
          "SELECT * FROM studio.executions WHERE id = $1 FOR UPDATE",
          [id],
        );
        const execution = executionResult.rows[0];
        if (!execution) throw Object.assign(new Error("Execution not found"), { code: "EXECUTION_NOT_FOUND" });
        if (execution.status === "failed") {
          const taskResult = await client.query("SELECT payload FROM studio.tasks WHERE id = $1", [execution.task_id]);
          return { task: taskResult.rows[0]?.payload || null, alreadyFailed: true };
        }
        if (execution.status !== "running") {
          throw Object.assign(new Error("Execution is not running"), { code: "EXECUTION_NOT_RUNNING" });
        }

        const taskResult = await client.query(
          "SELECT id, status, version, payload FROM studio.tasks WHERE id = $1 FOR UPDATE",
          [execution.task_id],
        );
        const taskRow = taskResult.rows[0];
        if (!taskRow || taskRow.status !== "running") {
          throw Object.assign(new Error("Task is not running"), { code: "TASK_NOT_RUNNING" });
        }
        const nextTask = {
          ...taskFromRow(taskRow),
          status: "failed",
          version: Number(taskRow.version) + 1,
          updatedAt: timestamp,
          failureReason,
        };
        await client.query(
          "UPDATE studio.executions SET status = 'failed', error = $2, finished_at = $3 WHERE id = $1",
          [id, failureReason, timestamp],
        );
        await client.query(
          "UPDATE studio.tasks SET status = 'failed', version = $2, payload = $3::jsonb, updated_at = $4 WHERE id = $1",
          [taskRow.id, nextTask.version, JSON.stringify(nextTask), timestamp],
        );
        const failedEventId = required(createId(), "generated eventId");
        const failedPayload = { executionId: id, reason: failureReason };
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, project_id, aggregate_type, aggregate_id,
              event_type, payload, occurred_at)
           SELECT $1, p.organization_id, t.project_id, 'task', t.id,
                  'execution.failed', $2::jsonb, $3
             FROM studio.tasks t
             JOIN studio.projects p ON p.id = t.project_id
            WHERE t.id = $4`,
          [failedEventId, JSON.stringify(failedPayload), timestamp, taskRow.id],
        );
        const failedScope = await client.query(
          "SELECT p.organization_id, t.project_id FROM studio.tasks t JOIN studio.projects p ON p.id = t.project_id WHERE t.id = $1",
          [taskRow.id],
        );
        await insertOutboxEvent(client, { eventId: failedEventId, organizationId: failedScope.rows[0].organization_id, projectId: failedScope.rows[0].project_id, aggregateType: "task", aggregateId: taskRow.id, eventType: "execution.failed", payload: failedPayload, occurredAt: timestamp });
        return { task: nextTask, alreadyFailed: false };
      });
    },
  });
}
