const PROJECT_NAME = "AI Office Self-Development";
const PLAN_TITLE = "Roblox Fan District — First Playable Vertical Slice v1";

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(field + " is required");
  return value.trim();
}

/**
 * Creates one fresh Director-planned product task set and executes it through
 * the normal approval, worker, and independent-QA workflow.
 */
export function createSelfDevelopmentProductPilot({ pool, controlPlane, now = () => new Date().toISOString() }) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("PostgreSQL pool is required");
  const runtime = controlPlane?.runtime;
  if (!runtime?.director || !runtime?.approval || !runtime?.recovery || !runtime?.workflow ||
      !controlPlane?.access?.loadProject) {
    throw new TypeError("A composed Studio runtime with project access is required");
  }
  if (typeof now !== "function") throw new TypeError("Clock function is required");

  return async function run({ organizationId, actor }) {
    const orgId = required(organizationId, "organizationId");
    const owner = actor && typeof actor.id === "string" ? actor : null;
    if (!owner) throw Object.assign(new Error("Authenticated owner actor is required"), { code: "AUTHENTICATION_REQUIRED" });

    const projectResult = await pool.query(
      `SELECT p.id
         FROM studio.projects p
         JOIN studio.organization_memberships m ON m.organization_id = p.organization_id
         JOIN studio.organizations o ON o.id = p.organization_id
        WHERE p.organization_id = $1 AND p.name = $2 AND p.status = 'active'
          AND m.actor_id = $3 AND m.role = 'owner' AND m.status = 'active'
          AND o.status = 'active'
        ORDER BY p.created_at DESC LIMIT 1`,
      [orgId, PROJECT_NAME, owner.id],
    );
    const projectId = projectResult.rows?.[0]?.id;
    if (!projectId) throw Object.assign(new Error("Active self-development project and owner access are required"), { code: "SELF_DEVELOPMENT_PROJECT_NOT_FOUND" });

    const existing = await pool.query(
      "SELECT id, status, payload FROM studio.plans WHERE project_id = $1 AND payload->>'title' = $2 ORDER BY created_at DESC LIMIT 1",
      [projectId, PLAN_TITLE],
    );

    let plan;
    let created = false;
    if (existing.rows?.[0]) {
      const row = existing.rows[0];
      const taskRows = await pool.query("SELECT id, status FROM studio.tasks WHERE plan_id = $1 ORDER BY id", [row.id]);
      if (taskRows.rows?.length && taskRows.rows.every(task => task.status === "completed")) {
        return { status: "already_completed", planId: row.id, taskIds: taskRows.rows.map(task => task.id), created: false };
      }
      plan = { ...(row.payload || {}), id: row.id, projectId, status: row.status };
    } else {
      const project = await controlPlane.access.loadProject({ projectId, actor: owner });
      const brief = [
        "Build the first real Roblox product vertical slice for Universal AI Studio: a football fans district.",
        "This is an implementation assignment, not another audit or roadmap. Name the plan exactly: Roblox Fan District — First Playable Vertical Slice v1. Create concrete Roblox Luau source files and a setup guide in the isolated GitHub workspace only.",
        "Target folder: studio/agent-workspace/roblox-fan-district/ . Do not write anywhere else.",
        "Implement a small, coherent playable loop: player spawn, a central fan plaza, a safe server-authoritative interaction/points mechanic, a repeatable short challenge, and a simple leaderboard or score display.",
        "Deliver separate, correctly named Luau scripts with clear server/client placement, RemoteEvent setup, and exact Roblox Studio installation steps. Prefer Roblox services and APIs that exist; do not invent engine APIs.",
        "Include basic input validation, server-side authority, rate limiting for remotes, and safe handling of player leave/join. Never trust client-submitted score or currency.",
        "Keep scope small enough for a first playable vertical slice. Do not attempt to create a full stadium, complex 3D art, paid monetization, external services, or publish to Roblox.",
        "The Director must decompose the work into implementation tasks and assign specialists. The implementation worker must actually use the GitHub workspace tools to create the source files. QA must independently inspect the persisted files and verify that the instructions and scripts agree.",
        "Acceptance evidence must name every created path, show the actual write tool results and commit/blob identifiers, and include an independent QA verdict. If tools cannot create or read back the files, report the blocker and do not claim the prototype is complete.",
        "All output must remain on studio-ai-agent-workspace under studio/agent-workspace/roblox-fan-district/. Do not modify production source, deployment configuration, secrets, workflows, databases, or live Roblox experiences."
      ].join("\\n");
      const proposed = await runtime.director.plan({
        request: brief,
        project,
        actor: owner,
        constraints: {
          maxTasks: 5,
          requireEvidence: true,
          noProductionChanges: true,
          freeModelsOnly: true,
        },
      });
      plan = proposed?.plan || proposed;
      if (!plan?.id) throw Object.assign(new Error("Director did not return a persisted product plan"), { code: "DIRECTOR_PLAN_NOT_CREATED" });
      created = true;
    }

    let planStatus = plan.status;
    if (planStatus === "proposed") {
      const approval = await runtime.approval.approve({ plan, actor: owner });
      planStatus = approval.plan?.status || "approved";
    }
    if (planStatus !== "approved") return { status: "not_executable", planId: plan.id, planStatus, created };

    const recovery = await runtime.recovery.recover({ actor: owner, limit: 20 });
    let execution = null;
    for (let round = 1; round <= 3; round += 1) {
      execution = await runtime.workflow.run({ planId: plan.id, actor: owner });
      const needsRevision = execution.qaReviews?.some(review => review.verdict === "revision_required");
      if (execution.status === "completed" || !needsRevision || round === 3) break;
    }
    return { status: execution?.status || "unknown", planId: plan.id, planStatus, created, recovery, execution };
  };
}
