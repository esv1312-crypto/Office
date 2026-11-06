/**
 * HTTP-neutral application handlers for the Studio owner workflow.
 *
 * Authentication and project/plan lookup are deliberately injected by the
 * host application. This module never trusts project or plan objects supplied
 * by the request body and never starts work before a persisted plan is approved.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new TypeError(`${field} is required`), { status: 400, code: "INVALID_REQUEST" });
  }
  return value.trim();
}

function actorFrom(request) {
  const actor = request?.auth?.actor;
  if (!actor || typeof actor.id !== "string" || !actor.id.trim()) {
    throw Object.assign(new Error("Authenticated owner context is required"), {
      status: 401, code: "AUTHENTICATION_REQUIRED",
    });
  }
  return actor;
}

export function createStudioHttpHandlers({ runtime, loadProject, loadPlan }) {
  if (!runtime?.director || !runtime?.approval || !runtime?.workflow) {
    throw new TypeError("A composed Studio runtime is required");
  }
  if (typeof loadProject !== "function" || typeof loadPlan !== "function") {
    throw new TypeError("Secure project and plan lookup functions are required");
  }

  return Object.freeze({
    async bootstrapWorkspace(request) {
      if (typeof runtime.bootstrap?.bootstrap !== "function") {
        throw Object.assign(new Error("Workspace bootstrap is not configured"), {
          status: 503, code: "BOOTSTRAP_UNAVAILABLE",
        });
      }
      const actor = actorFrom(request);
      const body = request?.body && typeof request.body === "object" ? request.body : {};
      const result = await runtime.bootstrap.bootstrap({
        organizationName: required(body.organizationName, "organizationName"),
        projectName: required(body.projectName, "projectName"),
        productProfileId: required(body.productProfileId, "productProfileId"),
        brief: required(body.brief, "brief"),
        actor,
      });
      return { status: 201, body: result };
    },

    async createPlan(request) {
      const actor = actorFrom(request);
      const projectId = required(request?.params?.projectId, "projectId");
      const body = request?.body && typeof request.body === "object" ? request.body : {};
      const userRequest = required(body.request, "request");
      const project = await loadProject({ projectId, actor });
      if (!project || project.id !== projectId) {
        throw Object.assign(new Error("Project not found"), { status: 404, code: "PROJECT_NOT_FOUND" });
      }
      const result = await runtime.director.plan({
        request: userRequest, project, actor,
        constraints: body.constraints && typeof body.constraints === "object" ? body.constraints : {},
      });
      return { status: 201, body: result };
    },

    async approvePlan(request) {
      const actor = actorFrom(request);
      const planId = required(request?.params?.planId, "planId");
      const plan = await loadPlan({ planId, actor });
      if (!plan || plan.id !== planId) {
        throw Object.assign(new Error("Plan not found"), { status: 404, code: "PLAN_NOT_FOUND" });
      }
      const result = await runtime.approval.approve({ plan, actor });
      return { status: 200, body: result };
    },

    async executeApprovedPlan(request) {
      const actor = actorFrom(request);
      const planId = required(request?.params?.planId, "planId");
      const plan = await loadPlan({ planId, actor });
      if (!plan || plan.id !== planId) {
        throw Object.assign(new Error("Plan not found"), { status: 404, code: "PLAN_NOT_FOUND" });
      }
      if (plan.status !== "approved") {
        throw Object.assign(new Error("Owner approval is required before execution"), {
          status: 409, code: "PLAN_NOT_APPROVED",
        });
      }
      const result = await runtime.workflow.run({ planId, actor });
      return { status: result.status === "completed" ? 200 : 202, body: result };
    },
  });
}
