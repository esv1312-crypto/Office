import { createTask } from "../core/create-task.js";

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
      const existingPlan = {
        ...(row.payload || {}),
        id: row.id,
        projectId: project.id,
        organizationId,
        status: row.status,
      };
      let planStatus = row.status;
      let execution = null;
      let recovery = null;

      if (planStatus === "proposed") {
        const approval = await controlPlane.runtime.approval.approve({
          plan: existingPlan, actor,
        });
        planStatus = approval.plan?.status || "approved";
      }
      if (planStatus === "approved") {
        recovery = await controlPlane.runtime.recovery.recover({ actor, limit: 50 });
        execution = await controlPlane.runtime.workflow.run({
          planId: row.id, actor,
        });
      }

      return {
        status: execution?.status === "completed" ? 200 : 202,
        body: {
          projectId: project.id, projectCreated, addedSpecialists,
          planId: row.id, planStatus, recovery, execution,
          message: execution
            ? "Existing self-development plan resumed; no duplicate plan was created."
            : "Existing self-development plan found; no duplicate plan was created.",
        },
      };
    }

    let proposed;
    let planSource = "director-model";
    let plannerFailure = null;
    try {
      proposed = await controlPlane.runtime.director.plan({
        request: SELF_DEVELOPMENT_BRIEF, project, actor,
        constraints: {
          maxTasks: 12,
          requireEvidence: true,
          noProductionChanges: true,
          freeModelsOnly: true,
        },
      });
    } catch (error) {
      plannerFailure = {
        code: error?.code || null,
        status: Number.isInteger(error?.status) ? error.status : null,
      };
    }

    let plan = proposed?.plan || proposed;
    if (!plan?.id) {
      planSource = "deterministic-bootstrap-fallback";
      const fallbackPlan = {
        id: createId(),
        projectId: project.id,
        organizationId,
        title: "AI Office Self-Development — Initial Audit and Roadmap",
        objective: "Establish an evidence-based development roadmap for a reliable autonomous universal AI office.",
        summary: "A bounded bootstrap plan created because the configured planner did not return a valid persisted plan. Specialists must distinguish verified facts from assumptions and must not claim repository access they do not have.",
        acceptanceCriteria: [
          "Architecture and current runtime capabilities are mapped without unsupported claims",
          "Autonomy lifecycle gaps and recovery risks are prioritized",
          "Model reliability and structured-output failure modes are documented",
          "GitHub worker access prerequisites and permission boundaries are explicit",
          "A dependency-aware implementation backlog has owners and verifiable acceptance criteria",
          "QA evidence requirements are defined for every implementation stage",
        ],
        planningSource: planSource,
        plannerFailure,
        modelSnapshot: {
          provider: "studio-bootstrap",
          model: "deterministic-self-development-template",
          instructionVersion: "1",
          parameters: { reason: "planner output unavailable; free-model policy preserved" },
        },
        status: "proposed",
        version: 1,
        createdAt: at,
        updatedAt: at,
        createdBy: actor.id,
      };
      const taskSpecs = [
        {
          title: "Map the current AI Office architecture and capability boundaries",
          description: "Produce a structured architecture map from the verified project context and known runtime behavior. Explicitly label what is verified, inferred, and still requires repository inspection. Do not claim to have read source files or run commands unless tools provide evidence.",
          competencies: ["architecture", "system.design", "integration"],
          criteria: ["Architecture map covers intake, planning, specialists, dispatch, workers, QA, persistence, recovery, models, and tools", "Every statement is labelled verified, inferred, or unverified", "Missing evidence is listed as concrete follow-up work"],
        },
        {
          title: "Audit the autonomous work lifecycle and failure recovery",
          description: "Describe the complete lifecycle from owner request through planning, approval, task assignment, execution, QA, retry, and evidence. Identify failure states, recovery gaps, and safe stopping conditions using only verified context.",
          competencies: ["architecture", "system.design", "integration"],
          criteria: ["Lifecycle diagram or ordered state map is provided", "Failure modes and recovery paths are listed", "No unsupported claim of successful execution is made"],
        },
        {
          title: "Prioritize the universal AI Office product roadmap",
          description: "Create a dependency-aware roadmap for making the office useful across software, design, construction, marketing, research, and other domains. Separate foundational platform work from domain-specific specialists.",
          competencies: ["product.strategy", "task.decomposition", "requirements"],
          criteria: ["Roadmap is divided into ordered milestones", "Each milestone has an observable completion condition", "Universal extension points are distinguished from product-specific features"],
        },
        {
          title: "Document model reliability and structured-output risks",
          description: "Analyze the observed empty, invalid-JSON, and access-error behavior in planner model calls. Recommend a bounded free-model routing, parsing, timeout, and fallback strategy. Do not request paid-model activation.",
          competencies: ["product.strategy", "task.decomposition", "requirements"],
          criteria: ["Observed failures are separated from hypotheses", "Retry/fallback behavior has explicit bounds", "No paid model or unapproved spending is proposed"],
        },
        {
          title: "Audit GitHub execution readiness and permission boundaries",
          description: "Document the runtime prerequisites for workers to read and write the approved GitHub workspace, including credential presence, allowed paths, branch restrictions, artifact persistence, and how to verify actual commits. Never ask for or print secret values.",
          competencies: ["architecture", "system.design", "integration"],
          criteria: ["Required runtime credentials are named without exposing values", "Workspace path and branch restrictions are documented", "A safe end-to-end GitHub tool verification checklist is provided"],
        },
        {
          title: "Define independent QA and evidence gates for self-improvement",
          description: "Create acceptance and QA rules that prevent plans, drafts, unrun tests, or unsupported model claims from being reported as completed work.",
          competencies: ["qa.review", "testing", "security.review", "acceptance.criteria"],
          criteria: ["Every stage has evidence requirements", "QA independence and revision rules are defined", "Deployment and production changes require explicit gates"],
        },
      ];
      const tasks = taskSpecs.map(spec => createTask({
        id: createId(), projectId: project.id, title: spec.title,
        description: spec.description, requiredCompetencies: spec.competencies,
        acceptanceCriteria: spec.criteria, at,
      }));
      const persisted = await controlPlane.runtime.stores.domain.createPlanWithTasks({
        plan: fallbackPlan, tasks,
      });
      plan = persisted.plan;
    }

    const approved = await controlPlane.runtime.approval.approve({ plan, actor });
    const report = await controlPlane.runtime.workflow.run({ planId: plan.id, actor });
    return {
      status: report.status === "completed" ? 200 : 202,
      body: {
        projectId: project.id, projectCreated, addedSpecialists,
        planId: plan.id, planSource, plannerFailure,
        planStatus: approved.plan?.status || "approved",
        execution: report,
      },
    };
  };
}
