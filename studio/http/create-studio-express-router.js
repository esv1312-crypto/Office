import { createStudioHttpHandlers } from "./studio-http-handlers.js";

/**
 * Express adapter for the isolated Studio owner workflow.
 *
 * Authentication and rate limiting are mandatory injected middleware. The
 * host application remains responsible for JSON body-size limits and a
 * centralized error handler. This router is not mounted by the legacy server.
 */
export function createStudioExpressRouter({
  express,
  runtime,
  authenticate,
  rateLimit,
  loadProject,
  loadPlan,
}) {
  if (!express || typeof express.Router !== "function") {
    throw new TypeError("An Express-compatible Router factory is required");
  }
  if (typeof authenticate !== "function") {
    throw new TypeError("Authenticated actor middleware is required");
  }
  if (typeof rateLimit !== "function") {
    throw new TypeError("Studio rate-limit middleware is required");
  }

  const handlers = createStudioHttpHandlers({ runtime, loadProject, loadPlan });
  const router = express.Router();

  const bind = handler => async (request, response, next) => {
    try {
      const result = await handler(request);
      response.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  };

  router.post("/projects/:projectId/plans", authenticate, rateLimit, bind(handlers.createPlan));
  router.post("/plans/:planId/approve", authenticate, rateLimit, bind(handlers.approvePlan));
  router.post("/plans/:planId/execute", authenticate, rateLimit, bind(handlers.executeApprovedPlan));

  return router;
}
