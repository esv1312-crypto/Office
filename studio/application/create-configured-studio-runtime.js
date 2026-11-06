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
  now,
  workerConcurrency,
}) {
  const gateways = createOpenAiCompatibleGateways({ client, models, provider });
  const runtime = createStudioRuntime({
    pool,
    createId,
    createWorkerId,
    authorize,
    planningGateway: gateways.planningGateway,
    workerModelGateway: gateways.workerModelGateway,
    qaGateway: gateways.qaGateway,
    ...(now ? { now } : {}),
    ...(workerConcurrency !== undefined ? { workerConcurrency } : {}),
  });
  return Object.freeze({ ...runtime, gateways });
}
