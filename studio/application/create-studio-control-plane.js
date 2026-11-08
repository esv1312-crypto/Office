import { createConfiguredStudioRuntime } from "./create-configured-studio-runtime.js";
import { createPostgresStudioAccessControl } from "../governance/postgres-access-control.js";
import { createStudioExpressRouter } from "../http/create-studio-express-router.js";
import { createPostgresWorkspaceBootstrapStore } from "../storage/postgres-workspace-bootstrap-store.js";
import { createStudioBootstrap } from "./create-studio-bootstrap.js";

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
  workerTools,
  createSpecialistsForProfile,
  now,
  workerConcurrency,
  modelBudget = null,
  maxToolRounds = 20,
  maxToolCalls = 100,
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
  if (typeof createSpecialistsForProfile !== "function") {
    throw new TypeError("A dynamic product-profile specialist factory is required");
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
    workerTools,
    modelBudget,
    maxToolRounds,
    maxToolCalls,
    ...(now ? { now } : {}),
    ...(workerConcurrency !== undefined ? { workerConcurrency } : {}),
  });
  const bootstrapStore = createPostgresWorkspaceBootstrapStore({ pool, createId });
  const bootstrap = createStudioBootstrap({
    store: bootstrapStore,
    director: runtime.director,
    createId,
    createSpecialistsForProfile,
    ...(now ? { now } : {}),
  });
  const composedRuntime = Object.freeze({ ...runtime, bootstrap });
  const router = createStudioExpressRouter({
    express,
    runtime: composedRuntime,
    authenticate,
    rateLimit,
    loadProject: access.loadProject,
    loadPlan: access.loadPlan,
  });

  return Object.freeze({ runtime: composedRuntime, router, access });
}
