import { createConfiguredStudioRuntime } from "./create-configured-studio-runtime.js";
import { createPostgresStudioAccessControl } from "../governance/postgres-access-control.js";
import { createStudioExpressRouter } from "../http/create-studio-express-router.js";

/**
 * Builds the isolated Studio control plane from explicit host dependencies.
 *
 * The host still mounts the returned router and supplies a real identity
 * provider, rate limiter, migrated dedicated database pool, and configured
 * model client. This factory performs no queries, migrations, network calls,
 * or server mounting.
 */
export function createStudioControlPlane({
  express,
  pool,
  client,
  models,
  provider,
  createId,
  createWorkerId,
  authenticate,
  rateLimit,
  artifactWriter,
  now,
  workerConcurrency,
}) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new TypeError("A dedicated migrated Studio PostgreSQL pool is required");
  }
  if (typeof authenticate !== "function") {
    throw new TypeError("A verified identity-provider middleware is required");
  }
  if (typeof rateLimit !== "function") {
    throw new TypeError("A Studio rate-limit middleware is required");
  }
  if (typeof artifactWriter?.writeTextArtifact !== "function") {
    throw new TypeError("A scoped repository artifact writer is required");
  }

  const access = createPostgresStudioAccessControl({ pool });
  const runtime = createConfiguredStudioRuntime({
    pool,
    client,
    models,
    ...(provider ? { provider } : {}),
    createId,
    createWorkerId,
    authorize: access.authorize,
    artifactWriter,
    ...(now ? { now } : {}),
    ...(workerConcurrency !== undefined ? { workerConcurrency } : {}),
  });
  const router = createStudioExpressRouter({
    express,
    runtime,
    authenticate,
    rateLimit,
    loadProject: access.loadProject,
    loadPlan: access.loadPlan,
  });

  return Object.freeze({ runtime, router, access });
}
