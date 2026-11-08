import { createTask } from "../core/create-task.js";

const PROJECT_NAME = "AI Office Self-Development";
const PLAN_TITLE = "AI Office — Live Source Read/Write Verification v4";
const TASK_TITLE = "Inspect deployed source and publish verifiable workspace evidence";
const EVIDENCE_PATH = "studio/agent-workspace/verification/post-pr81-source-audit-v4.md";

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(field + " is required");
  return value.trim();
}

/**
 * Creates and executes one idempotent owner-triggered verification plan.
 * All writes go through the domain store; SQL is used only for scoped reads.
 */
export function createSelfDevelopmentSourceVerification({ pool, controlPlane, createId, now = () => new Date().toISOString() }) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("PostgreSQL pool is required");
  const runtime = controlPlane?.runtime;
  if (!runtime?.stores?.domain || !runtime.approval || !runtime.recovery || !runtime.workflow) {
    throw new TypeError("A composed Studio runtime is required");
  }
  if (typeof createId !== "function" || typeof now !== "function") throw new TypeError("ID and clock functions are required");

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
    if (!projectId) {
      throw Object.assign(new Error("Active self-development project and owner access are required"), {
        code: "SELF_DEVELOPMENT_PROJECT_NOT_FOUND",
      });
    }

    const existingResult = await pool.query(
      "SELECT id, status, payload FROM studio.plans WHERE project_id = $1 AND payload->>'title' = $2 ORDER BY created_at DESC LIMIT 1",
      [projectId, PLAN_TITLE],
    );
    let plan;
    let created = false;

    if (existingResult.rows?.[0]) {
      const row = existingResult.rows[0];
      const taskRows = await pool.query("SELECT id, status FROM studio.tasks WHERE plan_id = $1 ORDER BY id", [row.id]);
      if (taskRows.rows?.length && taskRows.rows.every(task => task.status === "completed")) {
        return { status: "already_completed", planId: row.id, taskIds: taskRows.rows.map(task => task.id) };
      }
      plan = { ...(row.payload || {}), id: row.id, projectId, status: row.status };
    } else {
      const at = now();
      const task = createTask({
        id: createId(),
        projectId,
        title: TASK_TITLE,
        description: [
          "Perform a real, evidence-backed live inspection of the current repository source. The read_repo_file and list_repo_directory tools read from studio-v1-foundation; write_repo_file writes only to studio-ai-agent-workspace.",
          "Read source files only from branch=studio-v1-foundation by passing branch=studio-v1-foundation explicitly to every read_repo_file call. Use these bounded inclusive ranges: studio/server.js lines 160-180; studio/agents/github-workspace-tools.js lines 50-70 and 128-170; studio/agents/worker-runtime.js lines 165-175 and 215-225. The returned result includes path, branch, sha, and range.totalLines.",
          "Record each source file's SHA directly from that file's own tool result. Keep the three source-file records separate. Record the actual returned branch, totalLines, startLine, and endLine. Do not claim that a source behavior was inspected unless it is visible in the exact ranges listed for that file.",
          "Use the returned source snippets to verify: server.js configures branch=studio-ai-agent-workspace and readBranch=studio-v1-foundation; github-workspace-tools.js routes default reads to readBranch, explicit workspace read-back to studio-ai-agent-workspace, and writes/patches to the workspace branch; worker-runtime.js passes specialist.allowedTools to modelGateway.generate at lines 165-175 and honors externalArtifact=false at lines 215-225.",
          "Create exactly this evidence file with write_repo_file: " + EVIDENCE_PATH + ". The file must contain only source-file evidence: separate rows with path, branch, actual SHA, actual totalLines, exact inspected inclusive ranges, and facts visible in those ranges. Do NOT put the evidence file's own blob SHA, commit SHA, write result, read-back SHA, or read-back metadata inside the file; those values are self-referential and must be reported only in the final worker response and the system-generated Runtime-verified tool evidence.",
          "After writing, read the same evidence file back using read_repo_file with branch=studio-ai-agent-workspace, start_line=1, end_line=200. In the final worker response, report the exact returned branch, sha, range.startLine, range.endLine, range.totalLines, plus the actual write result's branch, commitSha, and blobSha. Do not copy values from source-file reads. The system will attach the exact read-back file content to the QA artifact; do not invent or paraphrase it as if it were the tool result.",
          "If any source read, write, or read-back fails, report the precise error and do not claim success.",
          "Do not modify any source file, settings, secrets, workflows, infrastructure, or production data. The only permitted write is the single evidence markdown file under studio/agent-workspace/verification/."
        ].join("\n\n"),
        requiredCompetencies: ["implementation", "coding"],
        acceptanceCriteria: [
          "All three required source files were actually read from studio-v1-foundation using read_repo_file",
          "Evidence includes each source file's actual blob SHA, actual total line count, and exact inspected inclusive ranges from the tool results",
          "Findings accurately explain source-read branch versus isolated workspace-write branch and worker allowedTools hand-off using the specified source lines",
          "A new markdown evidence file exists at " + EVIDENCE_PATH + " on studio-ai-agent-workspace and contains only source evidence, not self-referential write/read-back SHA claims",
          "The exact persisted evidence-file content is present in Runtime-verified tool evidence; write blobSha equals read-back sha and both use the isolated workspace branch",
          "No source, secret, workflow, infrastructure, or production data was modified; no unsupported success claims appear"
        ],
        at,
      });
      // Keep this control task out of the production artifact repository.
      task.externalArtifact = false;
      plan = {
        id: createId(),
        projectId,
        organizationId: orgId,
        title: PLAN_TITLE,
        objective: "Prove that a live AI Office worker can inspect current deployed source, preserve the read/write branch boundary, and publish independently reviewable evidence.",
        summary: "One tightly scoped, non-production verification task. The only permitted repository write is a Markdown evidence file in the isolated agent workspace.",
        acceptanceCriteria: [
          "Live source inspection is evidenced by actual source blob SHAs and line ranges",
          "Workspace evidence is committed and read back from the isolated branch",
          "Independent QA reviews the resulting artifact against every criterion",
          "No production source or infrastructure is changed by the worker",
        ],
        planningSource: "owner-triggered-source-verification",
        status: "proposed",
        version: 1,
        createdAt: at,
        updatedAt: at,
        createdBy: owner.id,
      };
      const persisted = await runtime.stores.domain.createPlanWithTasks({ plan, tasks: [task] });
      plan = persisted.plan;
      created = true;
    }

    let planStatus = plan.status;
    if (planStatus === "proposed") {
      const approval = await runtime.approval.approve({ plan, actor: owner });
      planStatus = approval.plan?.status || "approved";
    }
    if (planStatus !== "approved") {
      return { status: "not_executable", planId: plan.id, planStatus, created };
    }

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
