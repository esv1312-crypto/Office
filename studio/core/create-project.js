/**
 * Create a project domain object.
 *
 * IDs and timestamps are injected by the application layer so this function
 * remains deterministic and does not reach into infrastructure.
 */
export function createProject({ id, organizationId, name, productProfileId, at }) {
  for (const [field, value] of Object.entries({
    id, organizationId, name, productProfileId, at,
  })) {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`Project ${field} is required`);
    }
  }
  if (Number.isNaN(Date.parse(at))) {
    throw new TypeError("Project timestamp must be a valid ISO-8601 date");
  }

  return {
    id,
    organizationId,
    name: name.trim(),
    productProfileId,
    status: "active",
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
}
