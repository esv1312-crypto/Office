/**
 * Owner-only launch of the AI Office self-development project.
 * Creates a separate project inside the existing organization, ensures a
 * generic platform team exists, then asks the Director to plan, approves
 * the plan as the authenticated owner, and starts the bounded workflow.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new TypeError(`${field} is required`), { status: 400, code: "INVALID_REQUEST" });
  }
  return value.trim();
}

const SELF_DEVELOPMENT_PROJECT = "AI Office Self-Development";
const SELF_DEVELOPMENT_PROFILE = "ai-office-platform";
const SELF_DEVELOPMENT_BRIEF = [
  "You are responsible for improving the Universal AI Office platform itself, not the Roblox product.",
  "Perform an evidence-based audit of the current repository, runtime, database model, specialist system, model gateways, tool permissions, memory/context handling, orchestration, QA, deployment, observability, and cost controls.",
  "Create a prioritized, dependency-aware roadmap to make the office a reliable autonomous general-purpose organization that can accept a goal, plan work, staff it dynamically, execute real tool actions, verify results, recover failures, and report evidence.",
  "Start with a safe discovery and architecture phase. Inspect only the repository workspace and tools actually available to you. Do not claim access to files, services, credentials, or capabilities you cannot verify.",
  "For each task define concrete outputs, acceptance criteria, risks, dependencies, and tests. Separate recommendations from implemented changes.",
  "Respect the GitHub workspace allowlist and all tool/path restrictions. Do not modify production source, secrets, workflows, infrastructure, or live data. Produce proposed patches and implementation specifications only where write permissions do not permit direct changes.",
  "Prefer small independently verifiable increments. Run available tests and report exact commands and outcomes. Never fabricate successful tests, commits, deployments, or results.",
  "Keep model use within the currently enabled free-model policy. Do not enable paid models or change spend limits.",
  "Deliver the audit, prioritized backlog, first implementation-ready work package, blockers, and evidence in structured artifacts."
].join("\n");

export function createSelfDevelopmentLaunchHandler({
  pool, controlPlane, createId, createSpecialistsForProfile,
  now = () => new Date().toISOString(),
}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("PostgreSQL pool is required");
  if (!controlPlane?.runtime?.stores?.domain || !controlPlane.runtime.director ||
      !controlPlane.runtime.approval || !controlPlane.runtime.workflow) {
    throw new TypeError("Composed Studio control plane is required");
  }
  if (typeof createId !== "function" || typeof createSpecialistsForProfile !== "function") {
    throw new TypeError("ID and specialist factories are required");
  }

  return async function launch(request) {
    const actor = request?.auth?.actor;
    if (!actor || typeof actor.id !== "string" || !actor.id.trim()) {
      throw Object.assign(new Error("Authenticated owner context is required"), {
        status: 401, code: "AUTHENTICATION_REQUIRED",
      });
    }
    const organizationId = required(request?.params?.organizationId, "organizationId");
    const owner = await pool.query(
      `SELECT o.id FROM studio.organizations o
         JOIN studio.organization_memberships m ON m.organization_id = o.id
        WHERE o.id = $1 AND m.actor_id = $2 AND m.role = 'owner'
          AND m.status = 'active' AND o.status = 'active'`,
      [organizationId, actor.id],
    );
    if (!owner.rows?.[0]) {
      throw Object.assign(new Error("Active organization owner access is required"), {
        status: 403, code: "ORGANIZATION_OWNER_REQUIRED",
      });
    }

    const at = now();
    let projectRow = await pool.query(
      "SELECT id, organization_id, name, product_profile_id, status, version, payload FROM studio.projects WHERE organization_id = $1 AND name = $2 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      [organizationId, SELF_DEVELOPMENT_PROJECT],
    );
    let project;
    let projectCreated = false;
    if (projectRow.rows?.[0]) {
      const row = projectRow.rows[0];
      project = {
        ...(row.payload || {}), id: row.id, organizationId: row.organization_id,
        name: row.name, productProfileId: row.product_profile_id,
        status: row.status, version: Number(row.version),
      };
    } else {
      project = {
        id: createId(), organizationId, name: SELF_DEVELOPMENT_PROJECT,
        productProfileId: SELF_DEVELOPMENT_PROFILE, status: "active", version: 1,
        createdAt: at, updatedAt: at,
      };
      await controlPlane.runtime.stores.domain.createProject(project);
      projectCreated = true;
    }

    const roleRows = await pool.query(
      "SELECT payload->>'role' AS role FROM studio.specialists WHERE organization_id = $1 AND status = 'active'",
      [organizationId],
    );
    const existingRoles = new Set((roleRows.rows || []).map(row => row.role).filter(Boolean));
    const proposedTeam = createSpecialistsForProfile({
      productProfileId: SELF_DEVELOPMENT_PROFILE, organizationId, createId, at,
    });
    const addedSpecialists = [];
    for (const specialist of proposedTeam) {
      if (existingRoles.has(specialist.role)) continue;
      await controlPlane.runtime.stores.domain.createSpecialist(specialist);
      existingRoles.add(specialist.role);
      addedSpecialists.push(specialist.role);
    }

    const priorPlan = await pool.query(
      "SELECT id, status, payload FROM studio.plans WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1",
      [project.id],
    );
    if (priorPlan.rows?.[0]) {
      const row = priorPlan.rows[0];
      return {
        status: 200,
        body: {
          projectId: project.id, projectCreated, addedSpecialists,
          planId: row.id, planStatus: row.status,
          message: "Self-development project already has a plan; no duplicate plan was created.",
        },
      };
    }

    const proposed = await controlPlane.runtime.director.plan({
      request: SELF_DEVELOPMENT_BRIEF, project, actor,
      constraints: {
        maxTasks: 12,
        requireEvidence: true,
        noProductionChanges: true,
        freeModelsOnly: true,
      },
    });
    const plan = proposed.plan || proposed;
    if (!plan?.id) throw Object.assign(new Error("Director did not persist a plan"), {
      status: 502, code: "DIRECTOR_PLAN_NOT_CREATED",
    });
    const approved = await controlPlane.runtime.approval.approve({ plan, actor });
    const report = await controlPlane.runtime.workflow.run({ planId: plan.id, actor });
    return {
      status: report.status === "completed" ? 200 : 202,
      body: {
        projectId: project.id, projectCreated, addedSpecialists,
        planId: plan.id, planStatus: approved.plan?.status || "approved",
        execution: report,
      },
    };
  };
}
