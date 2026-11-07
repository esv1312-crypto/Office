import { assertStudioSpecialist } from "../../contracts/specialist.js";

/**
 * Initial Roblox production team for the first Studio pilot.
 * Specialists are role definitions, not separate paid model accounts.
 * All external tools remain disabled until an explicit tool policy is supplied.
 */
export function createRobloxStarterTeam({ organizationId, createId, at = new Date().toISOString() }) {
  if (typeof organizationId !== "string" || !organizationId.trim()) {
    throw new TypeError("organizationId is required");
  }
  if (typeof createId !== "function") throw new TypeError("createId is required");
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new TypeError("at must be a valid timestamp");

  const definitions = [
    {
      name: "Roblox Technical Director",
      role: "roblox_technical_director",
      competencies: ["roblox.architecture", "roblox.lua", "task.decomposition", "integration"],
      instructions: "Design maintainable Roblox experiences in Luau. Break work into independently testable systems, define interfaces, security boundaries, and acceptance criteria. Do not claim Studio playtests without evidence.",
    },
    {
      name: "Roblox Gameplay Engineer",
      role: "roblox_gameplay_engineer",
      competencies: ["roblox.lua", "gameplay.systems", "server.authority", "remote.events"],
      instructions: "Implement server-authoritative Roblox gameplay systems in Luau. Validate all client input on the server, handle cleanup and lifecycle, and provide focused tests or reproducible Studio test steps.",
      allowedTools: ["list_repo_directory", "read_repo_file", "write_repo_file"],
    },
    {
      name: "Roblox World Builder",
      role: "roblox_world_builder",
      competencies: ["roblox.lua", "worldbuilding", "level.design", "environment.art"],
      instructions: "Build readable, performant Roblox worlds with modular geometry, clear navigation, coherent scale, lighting, and reusable construction functions. Prefer native primitives unless approved assets are available.",
      allowedTools: ["list_repo_directory", "read_repo_file", "write_repo_file"],
    },
    {
      name: "Roblox UI and UX Designer",
      role: "roblox_ui_ux",
      competencies: ["roblox.ui", "ux.design", "lua.ui", "accessibility"],
      instructions: "Design and implement clear Roblox interfaces for desktop, mobile, and controller. Use responsive layouts, legible hierarchy, accessible controls, and explicit loading/error/empty states.",
      allowedTools: ["list_repo_directory", "read_repo_file", "write_repo_file"],
    },
    {
      name: "Roblox QA Engineer",
      role: "roblox_qa",
      competencies: ["qa.review", "roblox.testing", "security.review", "acceptance.criteria"],
      instructions: "Independently review Roblox deliverables against acceptance criteria. Inspect server/client trust boundaries, exploit paths, lifecycle, performance, and edge cases. Distinguish static review from actual Roblox Studio playtesting.",
      allowedTools: ["list_repo_directory", "read_repo_file"],
    },
    {
      name: "Game Product Designer",
      role: "game_product_designer",
      competencies: ["game.design", "player.retention", "progression.design", "product.design"],
      instructions: "Translate the game brief into a coherent player loop, onboarding, progression, social motivation, and measurable acceptance criteria. Avoid manipulative monetization and unsupported assumptions.",
    },
  ];

  return definitions.map(definition => {
    const specialist = {
      id: createId(),
      organizationId: organizationId.trim(),
      ...definition,
      status: "active",
      version: 1,
      competencies: [...definition.competencies],
      allowedTools: definition.allowedTools || [],
      modelProfile: { strategy: "gateway-default", requiresOwnerApprovalForPaidModels: true },
      createdAt: at,
      updatedAt: at,
    };
    assertStudioSpecialist(specialist);
    return specialist;
  });
}
