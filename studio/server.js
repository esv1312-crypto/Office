import express from "express";
import OpenAI from "openai";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { createStudioControlPlane } from "./application/create-studio-control-plane.js";
import { createNeonAuthBearerMiddleware } from "./http/create-neon-auth-bearer-middleware.js";
import { createLegacyOfficeTokenMiddleware } from "./http/create-legacy-office-token-middleware.js";
import { createGithubArtifactWriter } from "./artifacts/github-artifact-writer.js";
import { createGithubWorkspaceTools } from "./agents/github-workspace-tools.js";
import { createRobloxStarterTeam } from "./product-profiles/roblox/starter-team.js";
import { createSelfDevelopmentLaunchHandler } from "./http/self-development-launch.js";
import { createSelfDevelopmentSourceVerification } from "./http/self-development-source-verification.js";
import { createSelfDevelopmentProductPilot } from "./http/self-development-product-pilot.js";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required Studio configuration: ${name}`);
  return value;
}

function positiveIntegerEnv(name, fallback, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

function createRateLimiter({ windowMs = 60_000, max = 60 } = {}) {
  const buckets = new Map();
  return function studioRateLimit(request, response, next) {
    const now = Date.now();
    const key = String(request.ip || request.socket?.remoteAddress || "unknown");
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    response.setHeader("RateLimit-Limit", String(max));
    response.setHeader("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      response.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return response.status(429).json({ error: "RATE_LIMITED" });
    }
    if (buckets.size > 10_000) {
      for (const [entry, value] of buckets) if (now >= value.resetAt) buckets.delete(entry);
    }
    return next();
  };
}

function createSpecialistsForProfile({ productProfileId, organizationId, createId, at }) {
  if (productProfileId === "roblox") {
    return createRobloxStarterTeam({ organizationId, createId, at });
  }

  const roles = [
    {
      name: "Product Director",
      role: "product_director",
      competencies: ["product.strategy", "task.decomposition", "requirements"],
      instructions: "Translate the product brief into clear requirements, milestones, risks, and measurable acceptance criteria. Do not claim implementation without evidence.",
    },
    {
      name: "Solution Architect",
      role: "solution_architect",
      competencies: ["architecture", "system.design", "integration"],
      allowedTools: ["list_repo_directory", "read_repo_file"],
      instructions: "Design a maintainable solution for the assigned product. Define boundaries, interfaces, security assumptions, and implementation steps.",
    },
    {
      name: "Implementation Specialist",
      role: "implementation_specialist",
      competencies: ["implementation", "coding", "documentation"],
      instructions: "Produce the assigned implementation artifact. Follow the task acceptance criteria, explain assumptions, and never claim external changes that were not performed.",
      allowedTools: ["list_repo_directory", "read_repo_file", "write_repo_file"],
    },
    {
      name: "Quality Engineer",
      role: "quality_engineer",
      competencies: ["qa.review", "testing", "security.review", "acceptance.criteria"],
      allowedTools: ["list_repo_directory", "read_repo_file"],
      instructions: "Independently review the deliverable against every acceptance criterion. Require revision if evidence is incomplete, ambiguous, or incorrect. For self-development tasks, use read-only repository tools to inspect the exact persisted patch and test files in studio-ai-agent-workspace; compare them with source files on studio-v1-foundation. Never claim tests ran unless execution evidence exists.",
    },
  ];

  return roles.map(role => ({
    id: createId(),
    organizationId,
    ...role,
    status: "active",
    version: 1,
    allowedTools: role.allowedTools || [],
    modelProfile: { strategy: "gateway-default", requiresOwnerApprovalForPaidModels: true },
    createdAt: at,
    updatedAt: at,
  }));
}

const port = positiveIntegerEnv("PORT", 10000, 65535);
const databaseUrl = String(process.env.STUDIO_DATABASE_URL || process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("Missing Studio database: set STUDIO_DATABASE_URL or reuse DATABASE_URL");
const modelApiKey = String(
  process.env.STUDIO_MODEL_API_KEY ||
  process.env.OPENROUTER_API_KEY ||
  (/^(sk-or-|or-)/i.test(String(process.env.OPENROUTER_MODEL || "")) ? process.env.OPENROUTER_MODEL : "") ||
  "",
).trim();
if (!modelApiKey) throw new Error("Missing Studio model key: set STUDIO_MODEL_API_KEY or reuse the existing OpenRouter key");
const configuredLegacyModel = String(process.env.OPENROUTER_MODEL || "").trim();
const legacyFreeModel = configuredLegacyModel.endsWith(":free") ? configuredLegacyModel : "openrouter/free";
const paidModelsEnabled = String(process.env.STUDIO_ALLOW_PAID_MODELS || "").toLowerCase() === "true";
const defaultModel = String(
  process.env.STUDIO_DEFAULT_MODEL ||
  (paidModelsEnabled ? "deepseek/deepseek-v4.1-flash-1017" : legacyFreeModel),
).trim();
function modelEnv(name) {
  const model = String(process.env[name] || defaultModel).trim();
  if (!model) throw new Error(`${name} must identify an OpenRouter model`);
  if (!paidModelsEnabled && model !== "openrouter/free" && !model.endsWith(":free")) {
    throw new Error(`${name} must identify an explicitly free OpenRouter model unless STUDIO_ALLOW_PAID_MODELS=true`);
  }
  return model;
}
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const client = new OpenAI({
  apiKey: modelApiKey,
  baseURL: process.env.STUDIO_MODEL_BASE_URL || "https://openrouter.ai/api/v1",
});
const models = {
  planner: {
    model: modelEnv("STUDIO_PLANNER_MODEL"),
    temperature: 0.2,
    maxTokens: 3000,
    instructionVersion: "studio-v1",
  },
  worker: {
    model: modelEnv("STUDIO_WORKER_MODEL"),
    temperature: 0.2,
    maxTokens: 6000,
    instructionVersion: "studio-v1",
  },
  qa: {
    model: modelEnv("STUDIO_QA_MODEL"),
    temperature: 0.1,
    maxTokens: 2500,
    instructionVersion: "studio-v1",
  },
};
const legacyOwnerToken = String(process.env.OFFICE_AUDIT_TOKEN || "").trim();
const authenticate = legacyOwnerToken
  ? createLegacyOfficeTokenMiddleware({ token: legacyOwnerToken })
  : createNeonAuthBearerMiddleware({
      jwksUrl: requiredEnv("STUDIO_AUTH_JWKS_URL"),
      issuer: requiredEnv("STUDIO_AUTH_ISSUER"),
      audience: requiredEnv("STUDIO_AUTH_AUDIENCE"),
    });
const githubToken = String(process.env.STUDIO_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
const artifactWriter = githubToken
  ? createGithubArtifactWriter({
      owner: "esv1312-crypto",
      repo: "Office",
      branch: "studio-v1-foundation",
      token: githubToken,
      allowedPrefixes: ["studio/projects/"],
    })
  : null;
const githubWorkspaceToken = String(process.env.STUDIO_GITHUB_WORKSPACE_TOKEN || githubToken).trim();
const githubWorkspaceTools = githubWorkspaceToken
  ? createGithubWorkspaceTools({
      owner: "esv1312-crypto",
      repo: "Office",
      branch: "studio-ai-agent-workspace",
      readBranch: "studio-v1-foundation",
      token: githubWorkspaceToken,
      allowedPrefix: "studio/agent-workspace/",
    })
  : null;
const controlPlane = createStudioControlPlane({
  express,
  pool,
  client,
  models,
  provider: process.env.STUDIO_MODEL_PROVIDER || "openrouter",
  createId: randomUUID,
  createWorkerId: randomUUID,
  authenticate,
  rateLimit: createRateLimiter({
    windowMs: 60_000,
    max: positiveIntegerEnv("STUDIO_RATE_LIMIT_PER_MINUTE", 60, 600),
  }),
  artifactWriter,
  workerTools: githubWorkspaceTools,
  createSpecialistsForProfile,
  workerConcurrency: positiveIntegerEnv("STUDIO_WORKER_CONCURRENCY", 2, 8),
});

const launchSelfDevelopment = createSelfDevelopmentLaunchHandler({
  pool,
  controlPlane,
  createId: randomUUID,
  createSpecialistsForProfile,
});

const runSourceVerification = createSelfDevelopmentSourceVerification({
  pool,
  controlPlane,
  createId: randomUUID,
});

const runProductPilot = createSelfDevelopmentProductPilot({ pool, controlPlane });

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.get("/health/live", (_request, response) => response.status(200).json({ status: "ok" }));
app.get("/health/ready", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    return response.status(200).json({ status: "ready", database: "connected" });
  } catch {
    return response.status(503).json({ status: "not_ready", database: "unavailable" });
  }
});
app.post(
  "/api/studio/organizations/:organizationId/self-development/launch",
  authenticate,
  createRateLimiter({ windowMs: 60_000, max: 5 }),
  async (request, response, next) => {
    try {
      const result = await launchSelfDevelopment(request);
      return response.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  },
);
app.use("/api/studio", controlPlane.router);
app.use((error, _request, response, _next) => {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
    ? error.status
    : 500;
  if (status >= 500) console.error("[studio] request failed", error?.code || "INTERNAL_ERROR");
  return response.status(status).json({
    error: status >= 500 ? "INTERNAL_ERROR" : (error?.code || "REQUEST_FAILED"),
  });
});

async function runConfiguredInitialBootstrap() {
  if (String(process.env.STUDIO_BOOTSTRAP_ON_START || "").toLowerCase() !== "true") return;
  const lockClient = await pool.connect();
  let locked = false;
  try {
    await lockClient.query("SELECT pg_advisory_lock(741920261)");
    locked = true;
    const actor = { id: "legacy-office-owner", name: "AI-OFFICE owner" };
    const brief = [
      "Create the first pilot product for Universal AI Studio: a Roblox experience about a football fans district.",
      "Prepare a production-minded MVP plan, not a claim that a published Roblox place already exists.",
      "Design a lively explorable fan district with a central plaza, club supporter zones, a stadium exterior and gathering points.",
      "Specify the core player loop, social interactions, safe chat/community rules, progression, repeat-play activities, and fair Robux monetization that does not make competitive advantages pay-to-win.",
      "Break implementation into verifiable Roblox Studio deliverables: greybox map, navigation, spawn flow, interaction systems, minigames, UI, art pass, QA and release checklist.",
      "For every milestone provide concrete artifacts, acceptance criteria, dependencies, risks and a test plan. Prefer a small playable vertical slice first.",
      "Do not invent completed assets, external access, Roblox publishing, or test results. Mark anything requiring Roblox Studio credentials or a human action."
    ].join("\\n");
    const existing = await lockClient.query("SELECT COUNT(*)::int AS count FROM studio.organizations");
    if (Number(existing.rows?.[0]?.count || 0) === 0) {
      const result = await controlPlane.runtime.bootstrap.bootstrap({
        organizationName: process.env.STUDIO_BOOTSTRAP_ORGANIZATION || "Universal AI Studio",
        projectName: process.env.STUDIO_BOOTSTRAP_PROJECT || "Roblox Football Fans District",
        productProfileId: "roblox",
        brief,
        actor,
      });
      console.log(`[studio] initial bootstrap finished; status=${result.status}; project=${result.workspace?.project?.id || "created"}; plan=${result.plan?.id || "not-created"}`);
      return;
    }
    const planCount = await lockClient.query("SELECT COUNT(*)::int AS count FROM studio.plans");
    if (Number(planCount.rows?.[0]?.count || 0) > 0) {
      console.log("[studio] initial bootstrap skipped; workspace and plan already exist");
      return;
    }
    const projectResult = await lockClient.query("SELECT id FROM studio.projects ORDER BY created_at ASC LIMIT 1");
    const projectId = projectResult.rows?.[0]?.id;
    if (!projectId) {
      console.log("[studio] initial planning skipped; no project exists");
      return;
    }
    const project = await controlPlane.access.loadProject({ projectId, actor });
    const plan = await controlPlane.runtime.director.plan({ request: brief, project, actor });
    console.log(`[studio] initial plan created; project=${projectId}; plan=${plan?.id || "created"}; status=${plan?.status || "proposed"}`);
  } catch (error) {
    console.error("[studio] initial bootstrap failed", error?.code || error?.status || error?.message || "BOOTSTRAP_FAILED");
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock(741920261)").catch(() => {});
    lockClient.release();
  }
}

async function runConfiguredSelfDevelopmentLaunch() {
  const organizationId = String(process.env.STUDIO_SELF_DEVELOPMENT_ORGANIZATION_ID || "").trim();
  if (!organizationId) {
    console.error("[studio] self-development launch skipped; organization ID is not configured");
    return;
  }
  console.log("[studio] self-development startup trigger enabled by organization configuration");
  const lockClient = await pool.connect();
  let locked = false;
  try {
    await lockClient.query("SELECT pg_advisory_lock(741920263)");
    locked = true;
    const actor = { id: "legacy-office-owner", name: "AI-OFFICE owner" };
    const result = await launchSelfDevelopment({
      auth: { actor },
      params: { organizationId },
    });
    console.log(`[studio] self-development launch; project=${result.body?.projectId || "unknown"}; plan=${result.body?.planId || "existing"}; status=${result.body?.execution?.status || result.body?.planStatus || "unknown"}`);
  } catch (error) {
    console.error("[studio] self-development launch failed", error?.code || error?.status || "SELF_DEVELOPMENT_LAUNCH_FAILED");
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock(741920263)").catch(() => {});
    lockClient.release();
  }
}

async function runConfiguredSourceVerification() {
  if (String(process.env.STUDIO_SELF_DEVELOPMENT_SOURCE_VERIFICATION || "").toLowerCase() !== "true") return;
  const organizationId = String(process.env.STUDIO_SELF_DEVELOPMENT_ORGANIZATION_ID || "").trim();
  if (!organizationId) {
    console.error("[studio] source verification skipped; organization ID is not configured");
    return;
  }
  const lockClient = await pool.connect();
  let locked = false;
  try {
    await lockClient.query("SELECT pg_advisory_lock(741920264)");
    locked = true;
    const actor = { id: "legacy-office-owner", name: "AI-OFFICE owner" };
    const result = await runSourceVerification({ organizationId, actor });
    const executionSummary = (result.execution?.executions || [])
      .map(item => `${item.taskId || "task"}:${item.status || "unknown"}:${item.errorCode || "none"}`)
      .join(",") || "none";
    const blockedSummary = (result.execution?.blocked || [])
      .map(item => `${item.taskId || "task"}:${item.status || "blocked"}:${item.errorCode || "none"}`)
      .join(",") || "none";
    console.log(`[studio] source verification; plan=${result.planId || "existing"}; status=${result.status}; created=${Boolean(result.created)}; executions=${result.execution?.executions?.length || 0}; executionResults=${executionSummary}; qa=${result.execution?.qaReviews?.length || 0}; blocked=${result.execution?.blocked?.length || 0}; blockedDetails=${blockedSummary}`);
  } catch (error) {
    console.error("[studio] source verification failed", error?.code || error?.status || "SOURCE_VERIFICATION_FAILED");
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock(741920264)").catch(() => {});
    lockClient.release();
  }
}

async function runConfiguredProductPilot() {
  if (String(process.env.STUDIO_SELF_DEVELOPMENT_PRODUCT_PILOT || "").toLowerCase() !== "true") return;
  const organizationId = String(process.env.STUDIO_SELF_DEVELOPMENT_ORGANIZATION_ID || "").trim();
  if (!organizationId) {
    console.error("[studio] product pilot skipped; organization ID is not configured");
    return;
  }
  const lockClient = await pool.connect();
  let locked = false;
  try {
    await lockClient.query("SELECT pg_advisory_lock(741920265)");
    locked = true;
    const actor = { id: "legacy-office-owner", name: "AI-OFFICE owner" };
    const result = await runProductPilot({ organizationId, actor });
    const executionSummary = (result.execution?.executions || [])
      .map(item => `${item.taskId || "task"}:${item.status || "unknown"}:${item.errorCode || "none"}`)
      .join(",") || "none";
    const blockedSummary = (result.execution?.blocked || [])
      .map(item => `${item.taskId || "task"}:${item.status || "blocked"}:${item.errorCode || "none"}`)
      .join(",") || "none";
    console.log(`[studio] product pilot; plan=${result.planId || "existing"}; status=${result.status}; created=${Boolean(result.created)}; executions=${result.execution?.executions?.length || 0}; executionResults=${executionSummary}; qa=${result.execution?.qaReviews?.length || 0}; blocked=${result.execution?.blocked?.length || 0}; blockedDetails=${blockedSummary}`);
  } catch (error) {
    console.error("[studio] product pilot failed", error?.code || error?.status || "PRODUCT_PILOT_FAILED");
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock(741920265)").catch(() => {});
    lockClient.release();
  }
}

async function runConfiguredOwnerExecution() {
  const planId = String(process.env.STUDIO_OWNER_EXECUTE_PLAN_ID || "").trim();
  if (!planId) return;
  const lockClient = await pool.connect();
  let locked = false;
  try {
    await lockClient.query("SELECT pg_advisory_lock(741920262)");
    locked = true;
    const actor = { id: "legacy-office-owner", name: "AI-OFFICE owner" };
    const recovery = await controlPlane.runtime.recovery.recover({ actor, limit: 50 });
    if (recovery.recovered) {
      console.log(`[studio] owner execution recovered expired tasks=${recovery.recovered}`);
    }
    let plan = await controlPlane.access.loadPlan({ planId, actor });
    if (!plan) throw Object.assign(new Error("Owner execution plan was not found"), { code: "PLAN_NOT_FOUND" });
    if (plan.status === "proposed") {
      const approval = await controlPlane.runtime.approval.approve({ plan, actor });
      plan = approval.plan;
      console.log(`[studio] owner-approved plan=${planId}; tasks=${approval.tasks?.length || 0}`);
    }
    if (plan.status !== "approved") {
      throw Object.assign(new Error("Plan is not in an executable state"), { code: "PLAN_NOT_APPROVED" });
    }
    let report = null;
    for (let round = 1; round <= 3; round += 1) {
      report = await controlPlane.runtime.workflow.run({ planId, actor });
      console.log(`[studio] owner execution round=${round}; plan=${planId}; status=${report.status}; assigned=${report.dispatch?.assigned?.length || 0}; executions=${report.executions?.length || 0}; qa=${report.qaReviews?.length || 0}; blocked=${report.blocked?.length || 0}`);
      const revisionsRequired = report.qaReviews?.some(review => review.verdict === "revision_required");
      if (report.status === "completed" || !revisionsRequired || round === 3) break;
    }
    console.log(`[studio] owner execution finished; plan=${planId}; status=${report?.status || "unknown"}`);
  } catch (error) {
    console.error("[studio] owner execution failed", error?.code || error?.status || "OWNER_EXECUTION_FAILED");
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock(741920262)").catch(() => {});
    lockClient.release();
  }
}

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`[studio] control plane listening on port ${port}; database=existing-office; provider=openrouter; auth=${legacyOwnerToken ? "legacy-owner-token" : "neon-auth"}; artifactStore=${artifactWriter ? "github+postgres" : "postgres"}; model=${defaultModel}`);
  void (async () => {
    await runConfiguredInitialBootstrap();
    await runConfiguredSelfDevelopmentLaunch();
    await runConfiguredSourceVerification();
    await runConfiguredProductPilot();
    await runConfiguredOwnerExecution();
  })().catch(error => {
    console.error("[studio] startup orchestration failed", error?.code || error?.message || "STARTUP_FAILED");
  });
});

async function shutdown(signal) {
  console.log(`[studio] received ${signal}; shutting down`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
