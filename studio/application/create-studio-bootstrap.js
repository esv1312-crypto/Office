import { createProject } from "../core/create-project.js";

/**
 * One-command workspace bootstrap. Product-specific specialist teams are
 * injected, so the core does not assume the studio only builds games.
 */
export function createStudioBootstrap({ store, director, createId, createSpecialistsForProfile, now = () => new Date().toISOString() }) {
  if (!store || typeof store.createWorkspace !== "function") throw new TypeError("A durable workspace bootstrap store is required");
  if (!director || typeof director.plan !== "function") throw new TypeError("Director planning runtime is required");
  if (typeof createId !== "function") throw new TypeError("createId is required");
  if (typeof createSpecialistsForProfile !== "function") throw new TypeError("A product-profile specialist factory is required");

  return Object.freeze({
    async bootstrap({ organizationName, projectName, productProfileId, brief, actor }) {
      const actorId = typeof actor?.id === "string" ? actor.id.trim() : "";
      if (!actorId) throw Object.assign(new Error("Verified owner identity is required"), { code: "AUTHENTICATION_REQUIRED" });
      for (const [field, value] of Object.entries({ organizationName, projectName, productProfileId, brief })) {
        if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
      }
      const at = now();
      if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new TypeError("Bootstrap clock returned an invalid timestamp");

      const organization = {
        id: createId(), name: organizationName.trim(), status: "active", createdAt: at,
      };
      const project = createProject({
        id: createId(),
        organizationId: organization.id,
        name: projectName.trim(),
        productProfileId: productProfileId.trim(),
        at,
      });
      const specialists = await createSpecialistsForProfile({
        productProfileId: project.productProfileId,
        organizationId: organization.id,
        createId,
        at,
      });
      if (!Array.isArray(specialists) || specialists.length < 1) {
        throw Object.assign(new Error("No specialist team is registered for this product profile"), {
          code: "PRODUCT_PROFILE_TEAM_UNAVAILABLE",
        });
      }

      const workspace = await store.createWorkspace({
        organization, ownerActorId: actorId, project, specialists,
      });
      try {
        const plan = await director.plan({
          request: brief.trim(),
          project: workspace.project,
          actor,
        });
        return { status: "plan_proposed", workspace, plan };
      } catch (error) {
        return {
          status: "workspace_created_plan_failed",
          workspace,
          planningError: { code: error?.code || "DIRECTOR_PLANNING_FAILED", message: "Workspace created; initial plan could not be generated" },
        };
      }
    },
  });
}
