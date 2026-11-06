/**
 * Dispatch approved plan tasks to compatible active specialists.
 * Assignment is deterministic; PostgreSQL remains the final authorization/scope gate.
 *
 * Director models may describe competencies in natural language while the
 * specialist directory stores canonical capability IDs. This adapter maps
 * the known Roblox pilot vocabulary to those IDs and scores partial coverage:
 * cross-functional tasks still get a primary owner instead of being stranded
 * because one specialist cannot possess every skill in the task brief.
 */
const COMPETENCY_ALIASES = {
  "game loop design": ["game.design", "gameplay.systems"],
  "xp system": ["progression.design", "gameplay.systems"],
  "reward distribution": ["progression.design", "game.design"],
  "state management": ["gameplay.systems", "roblox.lua"],
  "roblox studio mapping": ["worldbuilding", "level.design"],
  "spatial design": ["level.design", "worldbuilding"],
  "basic 3d modeling": ["worldbuilding", "environment.art"],
  "layout planning": ["level.design", "worldbuilding"],
  "roblox studio build export": ["roblox.architecture", "integration"],
  "documentation": ["task.decomposition", "integration"],
  "release coordination": ["integration", "task.decomposition"],
  "final quality gate": ["qa.review", "acceptance.criteria"],
  "roblox chat module": ["roblox.lua", "server.authority", "remote.events"],
  "moderation system": ["server.authority", "security.review"],
  "role-based access control": ["server.authority", "security.review"],
  "content filtering": ["server.authority", "security.review"],
  "roblox ui (screengui, textlabel, imagebutton)": ["roblox.ui", "ux.design"],
  "ui layout and animation": ["roblox.ui", "ux.design"],
  "accessibility considerations": ["accessibility", "ux.design"],
  "game scripting": ["roblox.lua", "gameplay.systems"],
  "minigame design": ["game.design", "gameplay.systems"],
  "timer and scoring systems": ["gameplay.systems", "roblox.lua"],
  "integration with player loop": ["gameplay.systems", "integration"],
  "quality assurance": ["qa.review", "roblox.testing"],
  "test case design": ["qa.review", "acceptance.criteria"],
  "bug tracking": ["qa.review", "roblox.testing"],
  "performance testing": ["roblox.testing", "security.review"],
  "roblox studio modeling": ["worldbuilding", "environment.art"],
  "lighting and effects": ["environment.art", "worldbuilding"],
  "architectural design": ["worldbuilding", "level.design"],
  "environmental storytelling": ["environment.art", "worldbuilding"],
  "xp tracking system": ["progression.design", "gameplay.systems"],
  "level progression logic": ["progression.design", "gameplay.systems"],
  "reward design": ["progression.design", "game.design"],
  "currency management (robux integration)": ["progression.design", "game.design"],
  "roblox studio building": ["worldbuilding", "level.design"],
  "interaction scripting (chat, seating)": ["roblox.lua", "gameplay.systems"],
  "ui design": ["roblox.ui", "ux.design"],
  "social system basics": ["game.design", "gameplay.systems"],
  "roblox movement module": ["roblox.lua", "gameplay.systems"],
  "waypoint navigation": ["gameplay.systems", "roblox.lua"],
  "ui interaction (teleport buttons)": ["roblox.ui", "ux.design"],
  "collision handling": ["roblox.lua", "server.authority"],
  "material and texture application": ["environment.art", "worldbuilding"],
  "zone-specific design": ["level.design", "worldbuilding"],
  "interaction scripting": ["roblox.lua", "gameplay.systems"],
};

function normalized(value) {
  return String(value || "").trim().toLowerCase().replace(/\\s+/g, " ");
}

function competencyCoverage(task, specialist) {
  const available = new Set(specialist.competencies || []);
  return (task.requiredCompetencies || []).reduce((score, requirement) => {
    const key = normalized(requirement);
    const aliases = COMPETENCY_ALIASES[key] || [requirement];
    return score + (aliases.some(skill => available.has(skill)) ? 1 : 0);
  }, 0);
}

function eligible(task, specialist, organizationId) {
  if (specialist.status !== "active" || specialist.organizationId !== organizationId) return false;
  if (specialist.projectIds?.length && !specialist.projectIds.includes(task.projectId)) return false;
  return competencyCoverage(task, specialist) > 0;
}

function chooseSpecialist(task, specialists, organizationId) {
  return specialists
    .filter(specialist => eligible(task, specialist, organizationId))
    .sort((a, b) => {
      const scoreDifference = competencyCoverage(task, b) - competencyCoverage(task, a);
      if (scoreDifference) return scoreDifference;
      const required = new Set(task.requiredCompetencies || []);
      const extraA = (a.competencies || []).filter(skill => !required.has(skill)).length;
      const extraB = (b.competencies || []).filter(skill => !required.has(skill)).length;
      return extraA - extraB || a.id.localeCompare(b.id);
    })[0] || null;
}

export function createDirectorDispatch({
  store, assignment, authorize, now = () => new Date().toISOString(),
}) {
  if (!store || typeof store.loadApprovedPlanForDispatch !== "function" ||
      typeof store.listActiveSpecialists !== "function" ||
      typeof store.markTaskReady !== "function") {
    throw new TypeError("Dispatch requires approved-plan, specialist-list, and task-readiness store methods");
  }
  if (!assignment || typeof assignment.assign !== "function") {
    throw new TypeError("A governed task assignment service is required");
  }
  if (typeof authorize !== "function") throw new TypeError("Dispatch authorization is required");

  return Object.freeze({
    async dispatch({ planId, actor }) {
      if (typeof planId !== "string" || !planId.trim()) throw new TypeError("planId is required");
      const loaded = await store.loadApprovedPlanForDispatch({ planId: planId.trim() });
      const allowed = await authorize({ actor, action: "director.plan.dispatch", plan: loaded.plan });
      if (allowed !== true) throw Object.assign(new Error("Plan dispatch is not authorized"), { code: "PLAN_DISPATCH_FORBIDDEN" });

      const specialists = await store.listActiveSpecialists({ organizationId: loaded.organizationId });
      const report = { planId: loaded.plan.id, status: "dispatched", assigned: [], blocked: [], skipped: [] };

      for (const task of loaded.tasks) {
        if (task.status === "assigned" || task.status === "running" ||
            task.status === "qa" || task.status === "completed") {
          report.skipped.push({ taskId: task.id, status: task.status });
          continue;
        }
        if (task.status !== "planned") {
          report.blocked.push({ taskId: task.id, reason: `Unexpected task status: ${task.status}` });
          continue;
        }
        const specialist = chooseSpecialist(task, specialists, loaded.organizationId);
        if (!specialist) {
          report.blocked.push({
            taskId: task.id, reason: "No active specialist has a matching competency and project access",
            requiredCompetencies: task.requiredCompetencies || [],
          });
          continue;
        }
        try {
          const ready = await store.markTaskReady({
            taskId: task.id, expectedVersion: task.version, at: now(), actorId: actor?.id || null,
          });
          const result = await assignment.assign({
            task: { ...ready.task, organizationId: loaded.organizationId },
            specialist, actor, expectedVersion: ready.task.version,
          });
          report.assigned.push({
            taskId: task.id, specialistId: specialist.id,
            taskStatus: result.task?.status || "assigned",
          });
        } catch (error) {
          report.blocked.push({ taskId: task.id, code: error?.code || "DISPATCH_FAILED", reason: String(error?.message || error).slice(0, 500) });
        }
      }

      if (report.blocked.length) report.status = report.assigned.length ? "partially_dispatched" : "blocked";
      return report;
    },
  });
}
