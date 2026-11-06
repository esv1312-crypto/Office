/**
 * Independent QA Runtime. The reviewer must be distinct from the producer.
 * The QA gateway evaluates the artifact against task acceptance criteria;
 * durable state changes are delegated to the transactional review store.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
}
function snapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("QA gateway must return a modelSnapshot object");
  }
  return value;
}
function normalizeReview(value) {
  if (!value || typeof value !== "object") throw new TypeError("QA gateway returned no review");
  if (!["accepted", "revision_required"].includes(value.verdict)) {
    throw Object.assign(new Error("QA verdict must be accepted or revision_required"), { code: "INVALID_QA_VERDICT" });
  }
  if (!Array.isArray(value.findings) || value.findings.some(item => typeof item !== "string" || !item.trim())) {
    throw new TypeError("QA findings must be an array of non-empty strings");
  }
  return { verdict: value.verdict, findings: value.findings.map(item => item.trim()).slice(0, 100) };
}

export function createQaRuntime({ store, qaGateway, authorize, now = () => new Date().toISOString() }) {
  if (!store || typeof store.recordQaReview !== "function") throw new TypeError("A durable QA review store is required");
  if (!qaGateway || typeof qaGateway.review !== "function") throw new TypeError("qaGateway.review is required");
  if (typeof authorize !== "function") throw new TypeError("QA authorization is required");
  if (typeof now !== "function") throw new TypeError("now must be a function");

  return Object.freeze({
    async review({ task, artifact, reviewer, actor }) {
      if (!task || !artifact || !reviewer) throw new TypeError("Task, artifact, and reviewer are required");
      const taskId = required(task.id, "task.id");
      const artifactId = required(artifact.id, "artifact.id");
      const reviewerId = required(reviewer.id, "reviewer.id");
      const producerId = required(artifact.specialistId || artifact.producerSpecialistId, "artifact.specialistId");
      if (reviewerId === producerId) {
        throw Object.assign(new Error("The producer cannot review their own artifact"), { code: "QA_REVIEWER_MUST_BE_INDEPENDENT" });
      }
      if (reviewer.status !== "active") {
        throw Object.assign(new Error("QA reviewer is not active"), { code: "QA_REVIEWER_NOT_ACTIVE" });
      }
      if (task.status !== "qa") {
        throw Object.assign(new Error("Only tasks awaiting QA can be reviewed"), { code: "TASK_NOT_AWAITING_QA" });
      }
      const permitted = await authorize({ actor, action: "task.qa.review", task, artifact, reviewer });
      if (permitted !== true) throw Object.assign(new Error("QA review is not authorized"), { code: "QA_REVIEW_FORBIDDEN" });

      const generated = await qaGateway.review({
        task: {
          id: taskId, title: task.title, description: task.description || "",
          acceptanceCriteria: task.acceptanceCriteria || [],
        },
        artifact: { id: artifactId, type: artifact.type, name: artifact.name, content: artifact.content },
        reviewer: { id: reviewerId, role: reviewer.role, instructions: reviewer.instructions },
      });
      const verdict = normalizeReview(generated);
      const modelSnapshot = snapshot(generated.modelSnapshot);
      const at = now();
      if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new TypeError("QA clock returned an invalid timestamp");

      const result = await store.recordQaReview({
        taskId, artifactId, reviewerId, producerSpecialistId: producerId,
        verdict: verdict.verdict, findings: verdict.findings,
        modelSnapshot, at, actorId: actor?.id || null,
      });
      const expectedStatus = verdict.verdict === "accepted" ? "completed" : "ready";
      if (!result || result.task?.status !== expectedStatus || !result.reviewId) {
        throw new Error("QA store did not confirm the expected durable task transition");
      }
      return { taskId, artifactId, reviewId: result.reviewId, verdict: verdict.verdict,
        taskStatus: expectedStatus, findings: verdict.findings, modelSnapshot };
    },
  });
}
