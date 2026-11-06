/** Governed maintenance operation for recovering expired Worker leases. */
export function createExecutionRecovery({ store, authorize, now = () => new Date().toISOString() }) {
  if (!store || typeof store.recoverExpiredExecutions !== "function") {
    throw new TypeError("An execution recovery store is required");
  }
  if (typeof authorize !== "function") throw new TypeError("An authorization function is required");
  if (typeof now !== "function") throw new TypeError("now must be a function");
  return Object.freeze({
    async recover({ actor, limit = 20 } = {}) {
      if (!Number.isInteger(limit) || limit < 1) throw new TypeError("limit must be a positive integer");
      const allowed = await authorize({ actor, action: "execution.recover", scope: "studio" });
      if (allowed !== true) throw Object.assign(new Error("Execution recovery is not authorized"), { code: "EXECUTION_RECOVERY_FORBIDDEN" });
      const at = now();
      if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new TypeError("Recovery clock returned an invalid timestamp");
      const result = await store.recoverExpiredExecutions({ at, limit });
      if (!result || !Number.isInteger(result.recovered) || !Array.isArray(result.tasks) ||
          result.recovered !== result.tasks.length) {
        throw new Error("Execution store returned an invalid recovery report");
      }
      return result;
    },
  });
}
