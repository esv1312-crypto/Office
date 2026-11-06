import { createPostgresDomainStore } from "../storage/postgres-domain-store.js";
import { createPostgresAssignmentStore } from "../storage/postgres-assignment-store.js";
import { createPostgresExecutionStore } from "../storage/postgres-execution-store.js";
import { createPostgresQaReviewStore } from "../storage/postgres-qa-review-store.js";
import { createDirectorRuntime } from "../director/director-runtime.js";
import { createPlanApproval } from "../governance/approve-plan.js";
import { createTaskAssignment } from "../orchestration/assign-task.js";
import { createDirectorDispatch } from "../director/director-dispatch.js";
import { createWorkerRuntime } from "../agents/worker-runtime.js";
import { createWorkerPool } from "../agents/worker-pool.js";
import { createQaRuntime } from "../agents/qa-runtime.js";
import { createExecutionRecovery } from "../governance/recover-expired-executions.js";
import { createPlanExecutionWorkflow } from "../orchestration/run-approved-plan.js";

/**
 * Composition root for the new Studio vertical slice.
 *
 * The caller must inject a dedicated migrated PostgreSQL pool, stable ID
 * generator, authorization policy, and provider-neutral gateways. Nothing
 * connects, migrates, deploys, or invokes a provider during construction.
 */
export function createStudioRuntime({
  pool, createId, createWorkerId, authorize,
  planningGateway, workerModelGateway, qaGateway,
  now = () => new Date().toISOString(),
  workerConcurrency = 2,
}) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A migrated Studio PostgreSQL pool is required");
  if (typeof createId !== "function" || typeof createWorkerId !== "function") {
    throw new TypeError("createId and createWorkerId are required");
  }
  if (typeof authorize !== "function") throw new TypeError("A governance authorization policy is required");
  if (!planningGateway || typeof planningGateway.generatePlan !== "function") throw new TypeError("planningGateway.generatePlan is required");
  if (!workerModelGateway || typeof workerModelGateway.generate !== "function") throw new TypeError("workerModelGateway.generate is required");
  if (!qaGateway || typeof qaGateway.review !== "function") throw new TypeError("qaGateway.review is required");

  const domainStore = createPostgresDomainStore({ pool, createId });
  const assignmentStore = createPostgresAssignmentStore({ pool, createId });
  const executionStore = createPostgresExecutionStore({ pool, createId });
  const qaStore = createPostgresQaReviewStore({ pool, createId });

  const director = createDirectorRuntime({
    planningGateway, store: domainStore, authorize, createId, now,
  });
  const approval = createPlanApproval({ store: domainStore, authorize, now });
  const assignment = createTaskAssignment({ store: assignmentStore, authorize, now });
  const dispatch = createDirectorDispatch({
    store: domainStore, assignment, authorize, now,
  });
  const worker = createWorkerRuntime({
    store: executionStore, modelGateway: workerModelGateway, now,
  });
  const workerPool = createWorkerPool({
    worker, directory: domainStore, createWorkerId, concurrency: workerConcurrency,
  });
  const qa = createQaRuntime({
    store: qaStore, qaGateway, authorize, now,
  });
  const recovery = createExecutionRecovery({ store: executionStore, authorize, now });
  const workflow = createPlanExecutionWorkflow({
    dispatch, workerPool, qa, directory: domainStore,
  });

  return Object.freeze({
    director,
    approval,
    dispatch,
    worker,
    workerPool,
    qa,
    recovery,
    workflow,
    stores: Object.freeze({
      domain: domainStore,
      assignment: assignmentStore,
      execution: executionStore,
      qa: qaStore,
    }),
  });
}
