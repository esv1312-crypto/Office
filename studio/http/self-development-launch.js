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
const SELF_DEVELOPMENT_PLAN_TITLE = "AI Office Self-Development — First Implementation Sprint";
const SELF_DEVELOPMENT_BRIEF = [
  "Create a plan titled exactly: AI Office Self-Development — First Implementation Sprint.",
  "This is the first implementation sprint to improve Universal AI Studio / AI Office itself. The previous initial audit and roadmap are already complete. Do not repeat the audit and do not work on the Roblox Fan District product.",
  "Use source-grounded repository inspection to investigate the observed orchestration defects: a plan reported completed with zero assigned tasks and zero executions; worker executions repeatedly expiring their leases; and QA tasks being retried repeatedly without producing verifiable source read-back.",
  "Inspect the actual source files on studio-v1-foundation using only list_repo_directory and read_repo_file. Cite exact repository paths, relevant line ranges, observed behavior, and distinguish proven root causes from hypotheses. Do not infer source behavior from logs alone.",
  "Create a dependency-aware plan with no more than four tasks: (1) architect identifies and documents the highest-priority verified root cause, (2) Implementation Specialist prepares a minimal proposed code patch and focused regression tests, (3) an independent Quality Engineer reads the exact persisted patch files back from GitHub and reviews correctness, safety, and test coverage, and (4) only if needed, a small follow-up integration task.",
  "Use only these exact canonical requiredCompetencies when creating tasks: architect = architecture, system.design, integration, repository inspection, source code analysis, root cause analysis, technical documentation; implementation = implementation, coding, documentation, code patching, test development, regression testing, source code modification; platform QA = qa.review, testing, security.review, acceptance.criteria, code review, quality assurance, test coverage analysis, safety assessment, platform.qa. Do not invent alternative competency labels. Assign platform QA to the Quality Engineer, not Roblox QA.";
  "All proposed code and test files must be written only under studio/agent-workspace/ai-office-self-development/ on studio-ai-agent-workspace. Use write_repo_file, then read_repo_file on the exact returned path and verify the content. Do not modify studio-v1-foundation or any production path.",
  "The current worker tools do not provide shell execution or automatic pull-request creation. Do not claim tests were run, production code was changed, or a PR was opened. Provide exact test commands and a reviewable patch/diff for owner review.",
  "Every task must have concrete outputs, dependencies, and acceptance criteria. Require actual worker execution records, exact source read evidence, persisted workspace files, commit/blob identifiers, and an independent QA verdict.",
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
          maxTasks: 4,
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
        objective: "Prepare the first source-grounded, independently reviewed patch for improving the AI Office autonomous execution lifecycle.",
        summary: "A bounded first implementation sprint. Workers must inspect current source, prepare proposed code and regression-test files in the isolated workspace only, and have QA read back and review the exact persisted files.",
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
          title: "Inspect orchestration completion and worker lease recovery",
          description: "Read the current workflow, task-state, dispatch, execution lease, recovery, and QA source files. Identify one highest-priority proven defect using exact paths and line ranges. Do not infer source behavior or claim tests were run.",
          competencies: ["architecture", "system.design", "integration"],
          criteria: ["Exact source paths and line ranges are cited", "Observed code behavior is separated from hypotheses", "A minimal fix strategy and regression scenario are defined"],
        },
        {
          title: "Prepare an isolated patch and regression tests for the verified defect",
          description: "Prepare a reviewable unified diff and focused regression-test files for the verified orchestration defect. Write only under studio/agent-workspace/ai-office-self-development/ on studio-ai-agent-workspace. Read every written file back and include commit/blob identifiers. Do not claim the production source was modified or tests were executed.",
          competencies: ["implementation", "coding"],
          criteria: ["Patch is grounded in source read-back", "Regression test covers the reproduced failure mode", "All files are persisted in the allowed workspace and read back exactly", "No production path is modified"],
        },
        {
          title: "Independently review the persisted self-development patch",
          description: "Use read-only repository tools to inspect the exact patch and test files from studio-ai-agent-workspace. Compare the proposed changes with source files on studio-v1-foundation, identify correctness and safety issues, and provide an independent verdict. Do not claim tests were run.",
          competencies: ["qa.review", "testing", "security.review", "acceptance.criteria"],
          criteria: ["QA independently reads exact persisted files", "Patch and tests are checked against source and acceptance criteria", "Missing runtime or test execution evidence is clearly identified", "Reviewer is independent from the implementation specialist"],
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
