import { assertStudioSpecialist } from "../contracts/specialist.js";

/** Deterministic specialist factory; persistence and authorization stay outside the domain. */
export function createSpecialist({
  id, organizationId, name, role, description = "", instructions,
  competencies = [], allowedTools = [], modelProfile = {}, status = "active", at,
}) {
  const specialist = {
    id, organizationId, name: typeof name === "string" ? name.trim() : name,
    role: typeof role === "string" ? role.trim() : role,
    description, instructions, competencies: [...competencies],
    allowedTools: [...allowedTools], modelProfile: { ...modelProfile },
    status, version: 1, createdAt: at, updatedAt: at,
  };
  if (typeof description !== "string") throw new TypeError("Specialist description must be a string");
  assertStudioSpecialist(specialist);
  return specialist;
}
