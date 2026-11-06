import { insertOutboxEvent } from "./postgres-outbox-store.js";
/**
 * Transactional persistence for independent QA decisions.
 * Requires migrations 001, 002, and 003. No connection or migration side effects.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
}
function asObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  return value;
}
export function createPostgresQaReviewStore({ pool, createId }) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A pg-compatible pool is required");
  if (typeof createId !== "function") throw new TypeError("createId is required");

  return Object.freeze({
    async recordQaReview(input) {
      const taskId = required(input.taskId, "taskId");
      const artifactId = required(input.artifactId, "artifactId");
      const reviewerId = required(input.reviewerId, "reviewerId");
      const producerId = required(input.producerSpecialistId, "producerSpecialistId");
      const at = required(input.at, "at");
      const verdict = input.verdict;
      if (!["accepted", "revision_required"].includes(verdict)) throw new TypeError("Invalid QA verdict");
      if (reviewerId === producerId) throw Object.assign(new Error("Reviewer must be independent"), { code: "QA_REVIEWER_MUST_BE_INDEPENDENT" });
      if (!Array.isArray(input.findings)) throw new TypeError("findings must be an array");
      const modelSnapshot = asObject(input.modelSnapshot, "modelSnapshot");

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const taskResult = await client.query(
          `SELECT t.id, t.project_id, t.status, t.assignee_specialist_id, t.version, t.payload, p.organization_id
             FROM studio.tasks t JOIN studio.projects p ON p.id = t.project_id
            WHERE t.id = $1 FOR UPDATE OF t`, [taskId]);
        const task = taskResult.rows[0];
        if (!task) throw Object.assign(new Error("Task not found"), { code: "TASK_NOT_FOUND" });
        if (task.status !== "qa") throw Object.assign(new Error("Task is not awaiting QA"), { code: "TASK_NOT_AWAITING_QA" });

        const artifactResult = await client.query(
          "SELECT id, task_id, specialist_id FROM studio.artifacts WHERE id = $1 FOR SHARE", [artifactId]);
        const artifact = artifactResult.rows[0];
        if (!artifact || artifact.task_id !== taskId) {
          throw Object.assign(new Error("Artifact does not belong to this task"), { code: "QA_ARTIFACT_MISMATCH" });
        }
        if (artifact.specialist_id !== producerId || producerId === reviewerId) {
          throw Object.assign(new Error("QA reviewer must differ from the artifact producer"), { code: "QA_REVIEWER_MUST_BE_INDEPENDENT" });
        }

        const reviewerResult = await client.query(
          "SELECT id, organization_id, status, payload FROM studio.specialists WHERE id = $1 FOR SHARE", [reviewerId]);
        const reviewer = reviewerResult.rows[0];
        if (!reviewer || reviewer.status !== "active") {
          throw Object.assign(new Error("QA reviewer is missing or inactive"), { code: "QA_REVIEWER_NOT_ACTIVE" });
        }
        if (reviewer.organization_id !== task.organization_id) {
          throw Object.assign(new Error("QA reviewer belongs to another organization"), { code: "ORGANIZATION_SCOPE_MISMATCH" });
        }
        const reviewerPayload = reviewer.payload || {};
        const competencies = Array.isArray(reviewerPayload.competencies) ? reviewerPayload.competencies : [];
        if (!competencies.includes("qa.review")) {
          throw Object.assign(new Error("Specialist lacks qa.review competency"), { code: "QA_COMPETENCY_REQUIRED" });
        }

        const reviewId = required(createId(), "generated reviewId");
        const eventId = required(createId(), "generated eventId");
        const fromStatus = "qa";
        const toStatus = verdict === "accepted" ? "completed" : "ready";
        const nextTask = {
          ...(task.payload || {}),
          status: toStatus,
          version: Number(task.version) + 1,
          updatedAt: at,
          lastQaReviewId: reviewId,
          lastQaVerdict: verdict,
          qaFindings: input.findings,
        };
        if (verdict === "revision_required") {
          nextTask.assigneeSpecialistId = null;
          nextTask.revisionRequestedAt = at;
        }
        await client.query(
          `INSERT INTO studio.qa_reviews
             (id, task_id, artifact_id, reviewer_specialist_id, producer_specialist_id,
              verdict, findings, model_snapshot, actor_id, reviewed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,
          [reviewId, taskId, artifactId, reviewerId, producerId, verdict,
            JSON.stringify(input.findings), JSON.stringify(modelSnapshot), input.actorId || null, at]);
        await client.query(
          `UPDATE studio.tasks
              SET status = $2, assignee_specialist_id = $3, version = $4,
                  payload = $5::jsonb, updated_at = $6
            WHERE id = $1`,
          [taskId, toStatus, verdict === "accepted" ? task.assignee_specialist_id : null,
            nextTask.version, JSON.stringify(nextTask), at]);
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
           VALUES ($1,$2,$3,'task',$4,$5,$6::jsonb,$7)`,
          [eventId, task.organization_id, task.project_id, taskId,
            verdict === "accepted" ? "qa.passed" : "qa.revision_requested",
            JSON.stringify({ reviewId, artifactId, reviewerId, producerId, verdict, findings: input.findings }),
            at]);
        await insertOutboxEvent(client, {
          eventId, organizationId: task.organization_id, projectId: task.project_id,
          aggregateType: "task", aggregateId: taskId,
          eventType: verdict === "accepted" ? "qa.passed" : "qa.revision_requested",
          payload: { reviewId, artifactId, reviewerId, producerId, verdict, findings: input.findings }, occurredAt: at,
        });
        await client.query("COMMIT");
        return { task: nextTask, reviewId, eventId };
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
      } finally {
        client.release();
      }
    },
  });
}
