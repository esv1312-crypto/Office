const ALIASES = {
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
  "qa": ["qa.review"],
  "verification": ["acceptance.criteria", "qa.review"],
  "testing": ["testing", "qa.review", "roblox.testing"],

  // Universal planner vocabulary used by self-development and non-Roblox work.
  "frontend engineering": ["implementation", "coding", "ux.design"],
  "ux design": ["ux.design"],
  "api integration": ["integration"],
  "accessibility": ["accessibility"],
  "planning algorithms": ["task.decomposition"],
  "graph validation": ["implementation", "coding"],
  "llm structured generation": ["implementation", "coding"],
  "workflow design": ["system.design", "task.decomposition"],
  "llm routing engineering": ["implementation", "coding"],
  "configuration management": ["implementation", "integration"],
  "policy enforcement": ["security.review"],
  "cost modeling": ["product.strategy"],
  "financial controls engineering": ["implementation", "coding"],
  "atomic transaction design": ["implementation", "coding", "system.design"],
  "concurrency testing": ["testing", "qa.review"],
  "provider integration": ["integration"],
  "quality assurance engineering": ["qa.review"],
  "evidence evaluation": ["acceptance.criteria"],
  "test analysis": ["testing", "qa.review"],
  "structured reporting": ["technical documentation"],
  "program management": ["product.strategy", "task.decomposition"],
  "release planning": ["task.decomposition", "integration"],
  "risk management": ["security.review", "acceptance.criteria"],
  "dependency tracking": ["task.decomposition"],
  "workflow engine engineering": ["implementation", "coding"],
  "state machine design": ["system.design", "implementation"],
  "concurrency control": ["implementation", "coding"],
  "backend engineering": ["implementation", "coding"],
  "distributed systems architecture": ["architecture", "system.design"],
  "domain modeling": ["system.design"],
  "api design": ["integration", "system.design"],
  "extensibility design": ["architecture", "system.design"],
  "git automation": ["implementation", "coding"],
  "github api integration": ["integration"],
  "branching strategy": ["integration"],
  "code review workflow": ["qa.review"],
  "software architecture": ["architecture", "system.design"],
  "technical risk assessment": ["architecture", "security.review"],
  "migration planning": ["architecture", "system.design"],
  "decision documentation": ["technical documentation"],
  "plugin architecture": ["architecture", "system.design"],
  "configuration design": ["implementation", "system.design"],
  "extensibility engineering": ["implementation", "coding"],
  "sandboxing and isolation": ["security.review"],
  "tool adapter engineering": ["implementation", "coding"],
  "process supervision": ["implementation", "coding"],
  "security engineering": ["security.review"],
  "storage engineering": ["implementation", "coding"],
  "integrity verification": ["qa.review"],
  "data durability": ["system.design", "implementation"],
  "database engineering": ["implementation", "coding"],
  "sql migration authoring": ["implementation", "coding"],
  "data integrity design": ["system.design"],
  "neon/postgres operations": ["integration"],
  "llm application engineering": ["implementation", "coding"],
  "requirements elicitation": ["product.strategy", "requirements"],
  "structured output validation": ["qa.review"],
  "prompt design": ["task.decomposition", "requirements"],
  "organizational data modeling": ["system.design"],
  "crud api design": ["implementation", "coding"],
  "access control": ["security.review"],
  "test infrastructure engineering": ["implementation", "coding"],
  "container or sandbox operations": ["security.review"],
  "ci integration": ["integration"],
  "log management": ["technical documentation"],
  "distributed systems reliability": ["system.design"],
  "idempotency design": ["system.design"],
  "failure recovery engineering": ["system.design"],
  "technical writing": ["technical documentation"],
  "operational record keeping": ["technical documentation"],
  "git workflow": ["integration"],
  "evidence management": ["acceptance.criteria"],
  "reporting engineering": ["implementation", "coding"],
  "evidence traceability": ["acceptance.criteria"],
  "data aggregation": ["implementation", "coding"],
  "test engineering": ["qa.review"],
  "end-to-end automation": ["testing", "qa.review"],
  "acceptance criteria mapping": ["acceptance.criteria"],
  "evidence reporting": ["technical documentation"],
  "access control design": ["security.review"],
  "audit logging": ["security.review"],
  "secrets management": ["security.review"],

  // Universal self-development tasks often describe practical skills rather
  // than the canonical capability IDs stored on the specialist records.
  "node.js server code analysis": ["source code analysis", "architecture"],
  "sqlite schema/backward-compatibility review": ["system.design", "architecture"],
  "test harness inspection": ["testing", "test coverage analysis"],
  "test authoring": ["test development", "testing"],
  "node.js test harness": ["test development", "testing"],
  "redaction assertions": ["testing", "security.review"],
  "node.js": ["implementation", "coding"],
  "error handling": ["implementation", "coding"],
  "secret redaction": ["security.review"],
  "backward-compatible persistence": ["implementation", "coding", "system.design"],
  "scope control": ["acceptance.criteria", "qa.review"],
  "evidence reporting": ["technical documentation", "acceptance.criteria"],
};
// A full-file write is an allowed fallback for a patch request when a
// specialist has read/write access but the optimistic patch helper is not
// granted on that specialist record. The worker still must read before
// writing and read back after the write.
const TOOL_ALIASES = {
  patch_repo_file: ["write_repo_file"],
};

function normalize(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }
export function competencyCoverage(task, specialist) {
  const available = new Set((specialist?.competencies || []).map(normalize));
  return (task?.requiredCompetencies || []).reduce((score, requirement) => {
    const aliases = [...new Set([normalize(requirement), ...(ALIASES[normalize(requirement)] || []).map(normalize)])];
    return score + (aliases.some(skill => available.has(skill)) ? 1 : 0);
  }, 0);
}
export function hasCompetencyCoverage(task, specialist) {
  return competencyCoverage(task, specialist) > 0;
}

/**
 * Return explicit task tool requirements plus a conservative write/read
 * requirement when the task competencies include implementation or coding.
 * This prevents a planner omission from routing code work to a read-only role.
 */
export function requiredToolsForTask(task) {
  const explicit = Array.isArray(task?.requiredTools) ? task.requiredTools : [];
  const implementationCompetency = (task?.requiredCompetencies || []).some(requirement => {
    const key = normalize(requirement);
    const aliases = [key, ...(ALIASES[key] || []).map(normalize)];
    return aliases.some(value => value === "implementation" || value === "coding");
  });
  const inferred = implementationCompetency ? ["write_repo_file", "read_repo_file"] : [];
  return [...new Set([...explicit, ...inferred].map(value => String(value).trim()).filter(Boolean))];
}

/** Every explicit or inferred task tool must be granted to the specialist. */
export function hasRequiredToolCoverage(task, specialist) {
  const allowedTools = new Set((specialist?.allowedTools || []).map(value => String(value).trim()).filter(Boolean));
  return requiredToolsForTask(task).every(tool => [tool, ...(TOOL_ALIASES[tool] || [])].some(candidate => allowedTools.has(candidate)));
}
