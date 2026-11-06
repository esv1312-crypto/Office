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
};
function normalize(value) { return String(value || "").trim().toLowerCase().replace(/\\s+/g, " "); }
export function competencyCoverage(task, specialist) {
  const available = new Set(specialist?.competencies || []);
  return (task?.requiredCompetencies || []).reduce((score, requirement) => {
    const aliases = ALIASES[normalize(requirement)] || [requirement];
    return score + (aliases.some(skill => available.has(skill)) ? 1 : 0);
  }, 0);
}
export function hasCompetencyCoverage(task, specialist) {
  return competencyCoverage(task, specialist) > 0;
}
