import { createTask } from "../core/create-task.js";

/**
 * Controlled hand-off from Universal AI Studio to the existing Office runtime.
 *
 * Persistence is injected deliberately: this module must not silently fall
 * back to process memory when a durable store is unavailable.
 *
 * Required store contract:
 * - createSubmission({ submissionId, task, project, ownerId, status })
 * - markSubmission(submissionId, patch)
 *
 * The caller must implement these operations transactionally/durably.
 */
export function createOfficeTaskSubmissionService({
  runtimeClient,
  store,
  getProject,
  authorize,
  createId,
  now = () => new Date().toISOString(),
}) {
  if (!runtimeClient || typeof runtimeClient.submitTask !== "function") {
    throw new TypeError("runtimeClient.submitTask is required");
  }
  if (!store || typeof store.createSubmission !== "function" ||
      typeof store.markSubmission !== "function") {
    throw new TypeError("A durable submission store is required");
  }
  if (typeof getProject !== "function" || typeof authorize !== "function" ||
      typeof createId !== "function" || typeof now !== "function") {
    throw new TypeError("getProject, authorize, createId, and now are required");
  }

  return Object.freeze({
    async submit({ actor, projectId, title, description = "" }) {
      if (!actor || typeof actor.id !== "string" || !actor.id.trim()) {
        throw new Error("An authenticated owner is required");
      }
      if (actor.role !== "owner") {
        throw Object.assign(new Error("Only the owner may submit work to the Office runtime"), {
          code: "OWNER_APPROVAL_REQUIRED",
        });
      }

      const allowed = await authorize({
        actor,
        action: "task.submit",
        resource: { type: "project", id: projectId },
      });
      if (allowed !== true) {
        throw Object.assign(new Error("Task submission is not authorized"), {
          code: "POLICY_DENIED",
        });
      }

      const project = await getProject(projectId);
      if (!project || project.status !== "active") {
        throw Object.assign(new Error("An active project is required"), {
          code: "PROJECT_NOT_ACTIVE",
        });
      }
      if (typeof project.id !== "string" || !project.id ||
          typeof project.organizationId !== "string" || !project.organizationId) {
        throw new Error("Project ownership metadata is incomplete");
      }

      const timestamp = now();
      const task = createTask({
        id: createId(),
        projectId: project.id,
        title,
        description,
        at: timestamp,
      });
      const submissionId = createId();

      // Persist intent before crossing the external execution boundary.
      // If the process crashes after this point, reconciliation can inspect it.
      await store.createSubmission({
        submissionId,
        task,
        project: { id: project.id, organizationId: project.organizationId },
        ownerId: actor.id,
        status: "submitting",
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      try {
        const response = await runtimeClient.submitTask({
          task: [task.title, task.description].filter(Boolean).join("\n\n"),
          employeeId: "chief",
          parentTaskId: null,
          kind: "root",
        });
        const runtimeTaskId = response?.task?.id;
        if (typeof runtimeTaskId !== "string" || !runtimeTaskId.trim()) {
          await store.markSubmission(submissionId, {
            status: "unknown",
            errorCode: "MISSING_RUNTIME_TASK_ID",
            updatedAt: now(),
          });
          return {
            submissionId,
            task,
            status: "unknown",
            message: "Runtime response did not include a task ID; do not resubmit automatically.",
          };
        }

        await store.markSubmission(submissionId, {
          status: "accepted",
          runtimeTaskId,
          runtimeStatus: response.task.status || "accepted",
          updatedAt: now(),
        });
        return {
          submissionId,
          task,
          runtimeTaskId,
          runtimeStatus: response.task.status || "accepted",
          status: "accepted",
        };
      } catch (error) {
        // Network/invalid-response failures are ambiguous: the runtime may
        // have accepted the POST even though the client did not receive proof.
        const uncertain = ["RUNTIME_UNREACHABLE", "INVALID_RUNTIME_RESPONSE"].includes(error?.code);
        await store.markSubmission(submissionId, {
          status: uncertain ? "unknown" : "failed",
          errorCode: error?.code || "RUNTIME_SUBMISSION_FAILED",
          errorMessage: String(error?.message || error).slice(0, 500),
          updatedAt: now(),
        });
        if (uncertain) {
          return {
            submissionId,
            task,
            status: "unknown",
            message: "The runtime response was lost or invalid. Check runtime state before retrying.",
          };
        }
        throw error;
      }
    },
  });
}
