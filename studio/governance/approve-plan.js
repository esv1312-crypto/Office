/** Owner-controlled approval gate for a proposed Director plan. */
export function createPlanApproval({ store, authorize, now = () => new Date().toISOString() }) {
  if (!store || typeof store.approvePlan !== "function") throw new TypeError("A durable plan approval store is required");
  if (typeof authorize !== "function") throw new TypeError("An authorization function is required");
  return Object.freeze({
    async approve({ plan, actor }) {
      if (!plan || typeof plan !== "object") throw new TypeError("plan is required");
      if (typeof plan.id !== "string" || !plan.id.trim()) throw new TypeError("plan.id is required");
      if (plan.status !== "proposed") {
        throw Object.assign(new Error("Only proposed plans can be approved"), { code: "PLAN_NOT_PROPOSED" });
      }
      const allowed = await authorize({ actor, action: "director.plan.approve", plan });
      if (allowed !== true) throw Object.assign(new Error("Plan approval is not authorized"), { code: "PLAN_APPROVAL_FORBIDDEN" });
      const at = now();
      if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new TypeError("Approval clock returned an invalid timestamp");
      const result = await store.approvePlan({ planId: plan.id, actorId: actor?.id || null, at });
      if (!result || result.plan?.status !== "approved" || !Array.isArray(result.tasks) ||
          result.tasks.some(task => task.status !== "planned")) {
        throw new Error("Approval store did not confirm the approved plan and planned tasks");
      }
      return result;
    },
  });
}
