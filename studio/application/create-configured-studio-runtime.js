import { createStudioRuntime } from "./create-studio-runtime.js";
import { createOpenAiCompatibleGateways } from "../gateways/openai-compatible-gateways.js";

/**
 * Composes the isolated Studio runtime with configured OpenAI-compatible
 * model gateways. The caller owns credentials, the PostgreSQL pool,
 * authorization policy, and database migrations.
 *
 * Construction is side-effect free: it does not connect, migrate, deploy,
 * create provider clients, or issue model requests.
 */
export function createConfiguredStudioRuntime({
  pool,
  client,
  models,
  provider = "openai-compatible",
  createId,
  createWorkerId,
  authorize,
  artifactWriter = null,
  workerTools = null,
  artifactPathForTask,
  now,
  workerConcurrency,
  modelBudget = null,
  maxToolRounds = 40,
  maxToolCalls = 100,
  modelTimeoutMs = 300_000,
}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("A migrated Studio PostgreSQL pool is required");
  }
  if (typeof createId !== "function" || typeof createWorkerId !== "function") {
    throw new TypeError("createId and createWorkerId are required");
  }
  if (typeof authorize !== "function") {
    throw new TypeError("A governance authorization policy is required");
  }
  const gateways = createOpenAiCompatibleGateways({ client, models, provider, workerTools, modelBudget, maxToolRounds, maxToolCalls });
  const runtime = createStudioRuntime({
    pool,
    createId,
    createWorkerId,
    authorize,
    planningGateway: gateways.planningGateway,
    workerModelGateway: gateways.workerModelGateway,
    qaGateway: gateways.qaGateway,
    artifactWriter,
    ...(artifactPathForTask ? { artifactPathForTask } : {}),
    ...(now ? { now } : {}),
    ...(workerConcurrency !== undefined ? { workerConcurrency } : {}),
    modelTimeoutMs,
  });
  return Object.freeze({ ...runtime, gateways });
}
