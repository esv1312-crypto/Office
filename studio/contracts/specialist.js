/**
 * Dynamic specialist contract for Universal AI Studio.
 *
 * A specialist is a governed role definition, not necessarily a dedicated model.
 */
export const SPECIALIST_STATUSES = Object.freeze(["active", "paused", "archived"]);

export function assertStudioSpecialist(specialist) {
  if (!specialist || typeof specialist !== "object" || Array.isArray(specialist)) {
    throw new TypeError("Specialist must be an object");
  }
  for (const field of ["id", "organizationId", "name", "role", "instructions"]) {
    if (typeof specialist[field] !== "string" || !specialist[field].trim()) {
      throw new TypeError(`Specialist ${field} is required`);
    }
  }
  if (!Array.isArray(specialist.competencies) ||
      specialist.competencies.some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("Specialist competencies must be an array of non-empty strings");
  }
  if (!Array.isArray(specialist.allowedTools) ||
      specialist.allowedTools.some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("Specialist allowedTools must be an array of non-empty strings");
  }
  if (!SPECIALIST_STATUSES.includes(specialist.status)) {
    throw new TypeError("Specialist status is invalid");
  }
  if (!Number.isInteger(specialist.version) || specialist.version < 1) {
    throw new TypeError("Specialist version must be a positive integer");
  }
  if (typeof specialist.createdAt !== "string" || Number.isNaN(Date.parse(specialist.createdAt))) {
    throw new TypeError("Specialist createdAt must be a valid timestamp");
  }
  if (typeof specialist.updatedAt !== "string" || Number.isNaN(Date.parse(specialist.updatedAt))) {
    throw new TypeError("Specialist updatedAt must be a valid timestamp");
  }
  if (specialist.modelProfile !== undefined &&
      (!specialist.modelProfile || typeof specialist.modelProfile !== "object" || Array.isArray(specialist.modelProfile))) {
    throw new TypeError("Specialist modelProfile must be an object when provided");
  }
}
