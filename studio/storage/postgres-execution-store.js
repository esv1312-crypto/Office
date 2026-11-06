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
    async startExecution({ taskId, specialistId, workerId, at, leaseMs = 300_000 }) {
      const id = required(taskId, "taskId");
      const specialist = required(specialistId, "specialistId");
      const worker = required(workerId, "workerId");
      const timestamp = required(at, "at");
      if (!Number.isInteger(leaseMs) || leaseMs < 1_000) throw new TypeError("leaseMs must be an integer of at least 1000");

      return inTransaction(pool, async client => {
        const selected = await client.query(
          `SELECT t.id, t.project_id, t.status, t.assignee_specialist_id, t.version, t.fencing_token, t.payload,
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
        const leaseToken = required(createId(), "generated leaseToken");
        const fencingToken = Number(row.fencing_token || 0) + 1;
        const leaseExpiresAt = new Date(Date.parse(timestamp) + leaseMs).toISOString();
        const nextTask = {
          ...taskFromRow(row),
          status: "running",
          version: Number(row.version) + 1,
          updatedAt: timestamp,
        };

        await client.query(
          `UPDATE studio.tasks
              SET status = 'running', version = $2, payload = $3::jsonb, updated_at = $4,
                  fencing_token = $5
            WHERE id = $1`,
          [id, nextTask.version, JSON.stringify(nextTask), timestamp, fencingToken],
        );
        await client.query(
          `INSERT INTO studio.executions
             (id, task_id, specialist_id, worker_id, status, attempt, started_at,
              fencing_token, lease_token, lease_expires_at, heartbeat_at)
           VALUES ($1, $2, $3, $4, 'running', $5, $6, $7, $8, $9, $6)`,
          [executionId, id, specialist, worker, attempt, timestamp, fencingToken, leaseToken, leaseExpiresAt],
        );
        const startedEventId = required(createId(), "generated eventId");
        const startedPayload = { executionId, specialistId: specialist, workerId: worker, attempt, fencingToken };
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
        await insertOutboxEvent(client, { eventId: startedEventId, organizationId: row.organization_id, projectId: row.project_id, aggregateType: "task", aggregateId: id, eventType: "execution.started", payload: startedPayload, occurredAt: timestamp });

        return {
          executionId,
          task: nextTask,
          execution: { id: executionId, attempt, workerId: worker, startedAt: timestamp, fencingToken, leaseToken, leaseExpiresAt },
        };
      });
    },

    async completeExecution({ executionId, output, modelSnapshot, artifact, at, fencingToken, leaseToken }) {
      const id = required(executionId, "executionId");
      const text = required(output, "output");
      const snapshot = asObject(modelSnapshot, "modelSnapshot");
      const artifactInput = asObject(artifact, "artifact");
      const timestamp = required(at, "at");
      if (!Number.isInteger(fencingToken) || fencingToken < 1) throw new TypeError("fencingToken is required");
      const lease = required(leaseToken, "leaseToken");

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
        if (Number(execution.fencing_token) !== fencingToken || execution.lease_token !== lease ||
            !execution.lease_expires_at || Date.parse(execution.lease_expires_at) <= Date.parse(timestamp)) {
          throw Object.assign(new Error("Execution lease expired or fencing token is stale"), { code: "EXECUTION_LEASE_LOST" });
        }

        const taskResult = await client.query(
          `SELECT t.id, t.project_id, t.status, t.version, t.fencing_token, t.payload, p.organization_id
             FROM studio.tasks t JOIN studio.projects p ON p.id = t.project_id
            WHERE t.id = $1 FOR UPDATE OF t`,
          [execution.task_id],
        );
        const taskRow = taskResult.rows[0];
        if (!taskRow || taskRow.status !== "running" || Number(taskRow.fencing_token) !== fencingToken) {
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
            JSON.stringify({ content: text, modelSnapshot: snapshot, ...(artifactInput.external ? { external: artifactInput.external } : {}) }),
            required(artifactInput.createdByWorkerId, "artifact.createdByWorkerId"),
            required(artifactInput.specialistId, "artifact.specialistId"),
            timestamp],
        );
        await client.query(
          `UPDATE studio.executions
              SET status = 'qa', output = $2, model_snapshot = $3::jsonb, finished_at = $4,
                  lease_token = NULL, lease_expires_at = NULL
            WHERE id = $1`,
          [id, text, JSON.stringify(snapshot), timestamp],
        );
        await client.query(
          `UPDATE studio.tasks
              SET status = 'qa', version = $2, payload = $3::jsonb, updated_at = $4
            WHERE id = $1`,
          [taskRow.id, nextTask.version, JSON.stringify(nextTask), timestamp],
        );
        const artifactPayload = { executionId: id, artifactId, specialistId: execution.specialist_id, ...(artifactInput.external ? { external: artifactInput.external } : {}) };
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
        await insertOutboxEvent(client, { eventId, organizationId: taskRow.organization_id, projectId: taskRow.project_id, aggregateType: "task", aggregateId: taskRow.id, eventType: "artifact.created", payload: artifactPayload, occurredAt: timestamp });

        return { task: nextTask, artifactId };
      });
    },

    async failExecution({ executionId, reason, at, fencingToken, leaseToken }) {
      const id = required(executionId, "executionId");
      const failureReason = required(reason, "reason").slice(0, 1000);
      const timestamp = required(at, "at");
      if (!Number.isInteger(fencingToken) || fencingToken < 1) throw new TypeError("fencingToken is required");
      const lease = required(leaseToken, "leaseToken");

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
        if (Number(execution.fencing_token) !== fencingToken || execution.lease_token !== lease ||
            !execution.lease_expires_at || Date.parse(execution.lease_expires_at) <= Date.parse(timestamp)) {
          throw Object.assign(new Error("Execution lease expired or fencing token is stale"), { code: "EXECUTION_LEASE_LOST" });
        }

        const taskResult = await client.query(
          `SELECT t.id, t.project_id, t.status, t.version, t.payload, p.organization_id
             FROM studio.tasks t JOIN studio.projects p ON p.id = t.project_id
            WHERE t.id = $1 FOR UPDATE OF t`,
          [execution.task_id],
        );
        const taskRow = taskResult.rows[0];
        if (!taskRow || taskRow.status !== "running" || Number(taskRow.fencing_token) !== fencingToken) {
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
          `UPDATE studio.executions SET status = 'failed', error = $2, finished_at = $3,
                  lease_token = NULL, lease_expires_at = NULL WHERE id = $1`,
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
        await insertOutboxEvent(client, { eventId: failedEventId, organizationId: taskRow.organization_id, projectId: taskRow.project_id, aggregateType: "task", aggregateId: taskRow.id, eventType: "execution.failed", payload: failedPayload, occurredAt: timestamp });
        return { task: nextTask, alreadyFailed: false };
      });

    },

    async heartbeatExecution({ executionId, fencingToken, leaseToken, at, leaseMs = 300_000 }) {
      const id = required(executionId, "executionId");
      const lease = required(leaseToken, "leaseToken");
      const timestamp = required(at, "at");
      if (!Number.isInteger(fencingToken) || fencingToken < 1) throw new TypeError("fencingToken is required");
      if (!Number.isInteger(leaseMs) || leaseMs < 1_000) throw new TypeError("leaseMs must be an integer of at least 1000");
      const expiresAt = new Date(Date.parse(timestamp) + leaseMs).toISOString();
      const result = await pool.query(
        `UPDATE studio.executions
            SET heartbeat_at = $4, lease_expires_at = $5
          WHERE id = $1 AND fencing_token = $2 AND lease_token = $3
            AND status = 'running' AND lease_expires_at > $4
          RETURNING id`,
        [id, fencingToken, lease, timestamp, expiresAt],
      );
      if (!result.rowCount) throw Object.assign(new Error("Execution lease expired or fencing token is stale"), { code: "EXECUTION_LEASE_LOST" });
      return { executionId: id, leaseExpiresAt: expiresAt };
    },

    async recoverExpiredExecutions({ at, limit = 20 }) {
      const timestamp = required(at, "at");
      if (!Number.isInteger(limit) || limit < 1) throw new TypeError("limit must be a positive integer");
      return inTransaction(pool, async client => {
        const expired = await client.query(
          `SELECT e.id AS execution_id, e.task_id, e.fencing_token,
                  t.project_id, t.status AS task_status, t.version, t.payload,
                  t.fencing_token AS task_fencing_token, t.assignee_specialist_id,
                  p.organization_id
             FROM studio.executions e
             JOIN studio.tasks t ON t.id = e.task_id
             JOIN studio.projects p ON p.id = t.project_id
            WHERE e.status = 'running' AND e.lease_expires_at <= $1
              AND t.status = 'running' AND t.fencing_token = e.fencing_token
            ORDER BY e.lease_expires_at, e.started_at
            LIMIT $2
            FOR UPDATE OF e, t SKIP LOCKED`,
          [timestamp, limit],
        );
        const recovered = [];
        for (const row of expired.rows) {
          const nextTask = { ...taskFromRow(row), status: "assigned",
            version: Number(row.version) + 1, updatedAt: timestamp };
          await client.query(
            `UPDATE studio.executions SET status = 'failed', error = $2, finished_at = $3,
                  lease_token = NULL, lease_expires_at = NULL WHERE id = $1 AND status = 'running'`,
            [row.execution_id, "Worker lease expired; execution recovered", timestamp],
          );
          await client.query(
            "UPDATE studio.tasks SET status = 'assigned', version = $2, payload = $3::jsonb, updated_at = $4 WHERE id = $1",
            [row.task_id, nextTask.version, JSON.stringify(nextTask), timestamp],
          );
          const eventId = required(createId(), "generated eventId");
          const payload = { executionId: row.execution_id, reason: "lease_expired", fromStatus: "running", toStatus: "assigned", previousFencingToken: Number(row.fencing_token) };
          await client.query(
            `INSERT INTO studio.events
               (id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
             VALUES ($1,$2,$3,'task',$4,'execution.lease_expired',$5::jsonb,$6)`,
            [eventId, row.organization_id, row.project_id, row.task_id, JSON.stringify(payload), timestamp],
          );
          await insertOutboxEvent(client, { eventId, organizationId: row.organization_id,
            projectId: row.project_id, aggregateType: "task", aggregateId: row.task_id,
            eventType: "execution.lease_expired", payload, occurredAt: timestamp });
          recovered.push({ taskId: row.task_id, executionId: row.execution_id, status: "assigned" });
        }
        return { recovered: recovered.length, tasks: recovered };
      });
    },
  });
}
