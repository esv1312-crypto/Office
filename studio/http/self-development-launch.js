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
const SELF_DEVELOPMENT_PLAN_TITLE = "AI Office Self-Development — Sprint 2: Reliable Autonomous Execution";
const SELF_DEVELOPMENT_BRIEF = [
  "Create a new plan titled exactly: AI Office Self-Development — Sprint 2: Reliable Autonomous Execution. This is a fresh sprint; do not resume or duplicate the failed Sprint 1 plan.",
  "Improve Universal AI Studio / AI Office itself. The initial audit and Sprint 1 are already recorded; do not repeat either and do not work on the Roblox Fan District product.",
  "Focus narrowly on two verified orchestration bottlenecks: failed tasks are not eligible for redispatch (inspect studio/director/director-dispatch.js), and the tool-loop helper defaults to 8 rounds / 12 calls while the Runtime gateway now passes 12 rounds / 24 calls (inspect studio/agents/openai-tool-loop.js and studio/gateways/openai-compatible-gateways.js). The zero-work false-completion defect is already fixed in the latest merged source; do not redo it.",
  "Inspect the actual source files on studio-v1-foundation using only list_repo_directory and read_repo_file. Cite exact repository paths, relevant line ranges, observed behavior, and distinguish proven root causes from hypotheses. Do not infer source behavior from logs alone.",
  "Create exactly three small, dependency-aware tasks: (1) Solution Architect inspects the two named source areas and defines a bounded retry policy with a hard attempt ceiling plus role-appropriate tool budgets; (2) Implementation Specialist prepares one minimal patch and focused regression tests for those behaviors; (3) independent universal Quality Engineer reads the exact persisted patch and tests back from GitHub and reviews them. Each task must require only a few repository tool calls and have explicit outputs.",
  "Use only these canonical requiredCompetencies: architect = architecture, system.design, integration, repository inspection, source code analysis, root cause analysis, technical documentation; implementation = implementation, coding, documentation, code patching, test development, regression testing, source code modification; platform QA = qa.review, testing, security.review, acceptance.criteria, code review, quality assurance, test coverage analysis, safety assessment, platform.qa. Include platform.qa explicitly and assign platform QA to the universal Quality Engineer, never Roblox QA.",
  "All proposed code and test files must be written only under studio/agent-workspace/ai-office-self-development/ on studio-ai-agent-workspace. Use write_repo_file, then read_repo_file on the exact returned path and verify the content. Do not modify studio-v1-foundation or any production path.",
  "The current worker tools do not provide shell execution or automatic pull-request creation. Do not claim tests were run, production code was changed, or a PR was opened. Provide exact test commands and a reviewable patch/diff for owner review.",
  "Every task must have concrete outputs, dependencies, and acceptance criteria. Require actual worker execution records, exact source read evidence, persisted workspace files, commit/blob identifiers, and an independent QA verdict. Never claim tests ran: Runtime currently has no shell/test runner, so test files are proposed artifacts only.",
  "Respect all path, branch, credential, and production safety restrictions. Do not change secrets, workflows, infrastructure, live data, or deployment configuration.",
  "Use only the currently enabled free model policy. Do not enable paid models or incur unapproved costs."
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
      "SELECT id, payload->>'role' AS role, version, payload FROM studio.specialists WHERE organization_id = $1 AND status = 'active'",
      [organizationId],
    );
    const existingByRole = new Map((roleRows.rows || []).filter(row => row.role).map(row => [row.role, row]));
    const proposedTeam = createSpecialistsForProfile({
      productProfileId: SELF_DEVELOPMENT_PROFILE, organizationId, createId, at,
    });
    const addedSpecialists = [];
    const updatedSpecialists = [];
    for (const specialist of proposedTeam) {
      const existing = existingByRole.get(specialist.role);
      if (!existing) {
        await controlPlane.runtime.stores.domain.createSpecialist(specialist);
        addedSpecialists.push(specialist.role);
        continue;
      }
      const currentTools = Array.isArray(existing.payload?.allowedTools) ? existing.payload.allowedTools : [];
      const desiredTools = Array.isArray(specialist.allowedTools) ? specialist.allowedTools : [];
      const currentCompetencies = Array.isArray(existing.payload?.competencies) ? existing.payload.competencies : [];
      const desiredCompetencies = Array.isArray(specialist.competencies) ? specialist.competencies : [];
      const needsTools = JSON.stringify([...currentTools].sort()) !== JSON.stringify([...desiredTools].sort());
      const needsCompetencies = JSON.stringify([...currentCompetencies].sort()) !== JSON.stringify([...desiredCompetencies].sort());
      const desiredInstructions = specialist.role === "quality_engineer" ? specialist.instructions : existing.payload?.instructions;
      const needsInstructions = typeof desiredInstructions === "string" && desiredInstructions !== existing.payload?.instructions;
      if (needsTools || needsCompetencies || needsInstructions) {
        await controlPlane.runtime.stores.domain.updateSpecialist({
          specialistId: existing.id, expectedVersion: Number(existing.version),
          patch: {
            ...(needsTools ? { allowedTools: desiredTools } : {}),
            ...(needsCompetencies ? { competencies: desiredCompetencies } : {}),
            ...(needsInstructions ? { instructions: desiredInstructions } : {}),
          }, at,
        });
        updatedSpecialists.push(specialist.role);
      }
    }

    const priorPlan = await pool.query(
      "SELECT id, status, payload FROM studio.plans WHERE project_id = $1 AND payload->>'title' = $2 ORDER BY created_at DESC LIMIT 1",
      [project.id, SELF_DEVELOPMENT_PLAN_TITLE],
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
          projectId: project.id, projectCreated, addedSpecialists, updatedSpecialists,
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
          maxTasks: 3,
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
        title: SELF_DEVELOPMENT_PLAN_TITLE,
        objective: "Prepare a source-grounded, independently reviewed patch for bounded task retry and role-appropriate worker tool budgets.",
        summary: "A narrow second sprint addressing failed-task redispatch and fixed worker tool budgets. Workers prepare proposed code and regression-test files in the isolated workspace only; QA reads back and reviews the exact persisted files.",
        acceptanceCriteria: [
          "The highest-priority orchestration defect is grounded in exact source paths and line ranges",
          "A minimal proposed patch and focused regression tests are persisted in the isolated workspace branch",
          "Every workspace write is followed by an exact read-back",
          "Independent QA reviews the persisted patch and test files",
          "No production source, secrets, workflows, infrastructure, or live data are modified",
          "Unrun tests and unavailable capabilities are explicitly identified",
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
          title: "Inspect failed-task redispatch and worker tool budgets",
          description: "Read only studio/director/director-dispatch.js, studio/agents/openai-tool-loop.js, and studio/gateways/openai-compatible-gateways.js. Explain why failed tasks are not redispatched and identify the exact fixed tool-loop limits. Propose a bounded retry policy with a hard ceiling. Cite exact source paths and line ranges. Do not claim tests ran.",
          competencies: ["architecture", "system.design", "integration"],
          criteria: ["Exact source paths and line ranges are cited", "Observed code behavior is separated from hypotheses", "A minimal fix strategy and regression scenario are defined"],
        },
        {
          title: "Prepare isolated retry-policy and worker-budget patch",
          description: "Prepare one reviewable unified diff and focused regression-test files for bounded failed-task retries and configurable worker tool budgets. Write no more than two proposed files under studio/agent-workspace/ai-office-self-development/ on studio-ai-agent-workspace. Read each written file back and include commit/blob identifiers. Do not claim production source was modified or tests were executed.",
          competencies: ["implementation", "coding"],
          criteria: ["Patch is grounded in source read-back", "Regression test covers the reproduced failure mode", "All files are persisted in the allowed workspace and read back exactly", "No production path is modified"],
        },
        {
          title: "Independently review the persisted retry and budget patch",
          description: "Use read-only repository tools to inspect the exact persisted patch and test files from studio-ai-agent-workspace. Compare with source files on studio-v1-foundation, verify retry ceilings, error classification, tool-budget bounds, and production isolation, then provide an independent verdict. Do not claim tests were run.",
          competencies: ["qa.review", "testing", "security.review", "acceptance.criteria", "platform.qa"],
          criteria: ["Universal Quality Engineer independently reads exact persisted files", "Patch and tests are checked against source and acceptance criteria", "Retry ceiling and tool budgets are bounded and safe", "Missing runtime or test execution evidence is clearly identified", "Reviewer is independent from the implementation specialist"],
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
        projectId: project.id, projectCreated, addedSpecialists, updatedSpecialists,
        planId: plan.id, planSource, plannerFailure,
        planStatus: approved.plan?.status || "approved",
        execution: report,
      },
    };
  };
}
