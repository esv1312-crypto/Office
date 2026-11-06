/**
 * PostgreSQL-backed organization membership and control-plane authorization.
 *
 * The host identity provider MUST authenticate the request and populate
 * request.auth.actor.id with its stable subject identifier. This module does
 * not authenticate credentials, trust request-body actor IDs, or create users.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
}

function actorId(actor) {
  return required(actor?.id, "authenticated actor.id");
}

function projectIdFrom(resource, kind) {
  if (kind === "project") return required(resource?.id, "project.id");
  if (kind === "plan") return required(resource?.projectId, "plan.projectId");
  if (kind === "task") return required(resource?.projectId, "task.projectId");
  return null;
}

export function createPostgresStudioAccessControl({ pool }) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A pg-compatible query pool is required");

  async function membership({ actor, organizationId }) {
    const id = actorId(actor);
    const orgId = required(organizationId, "organizationId");
    const result = await pool.query(
      `SELECT m.role, m.status, o.status AS organization_status
         FROM studio.organization_memberships m
         JOIN studio.organizations o ON o.id = m.organization_id
        WHERE m.organization_id = $1 AND m.actor_id = $2`,
      [orgId, id]);
    const row = result.rows[0];
    if (!row || row.status !== "active" || row.organization_status !== "active") return null;
    return { role: row.role, organizationId: orgId };
  }

  async function loadProject({ projectId, actor }) {
    const id = required(projectId, "projectId");
    const actor = actorId(actor);
    const result = await pool.query(
      `SELECT p.id, p.organization_id, p.name, p.product_profile_id,
              p.status, p.version, p.payload
         FROM studio.projects p
         JOIN studio.organization_memberships m
           ON m.organization_id = p.organization_id
         JOIN studio.organizations o ON o.id = p.organization_id
        WHERE p.id = $1 AND m.actor_id = $2
          AND m.status = 'active' AND o.status = 'active'`,
      [id, actor]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...(row.payload || {}), id: row.id, organizationId: row.organization_id,
      name: row.name, productProfileId: row.product_profile_id,
      status: row.status, version: Number(row.version),
    };
  }

  async function loadPlan({ planId, actor }) {
    const id = required(planId, "planId");
    const subject = actorId(actor);
    const result = await pool.query(
      `SELECT pl.id, pl.project_id, pl.status, pl.version, pl.payload,
              pr.organization_id
         FROM studio.plans pl
         JOIN studio.projects pr ON pr.id = pl.project_id
         JOIN studio.organization_memberships m
           ON m.organization_id = pr.organization_id
         JOIN studio.organizations o ON o.id = pr.organization_id
        WHERE pl.id = $1 AND m.actor_id = $2
          AND m.status = 'active' AND o.status = 'active'`,
      [id, subject]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...(row.payload || {}), id: row.id, projectId: row.project_id,
      organizationId: row.organization_id, status: row.status,
      version: Number(row.version),
    };
  }

  async function authorize({ actor, action, project, plan, task, specialist }) {
    const resource = project || plan || task;
    const resourceKind = project ? "project" : plan ? "plan" : task ? "task" : null;
    const resourceProjectId = projectIdFrom(resource, resourceKind);
    if (!resourceProjectId) return false;
    const subject = actorId(actor);
    const result = await pool.query(
      `SELECT m.role, m.status, o.status AS organization_status
         FROM studio.projects p
         JOIN studio.organization_memberships m
           ON m.organization_id = p.organization_id
         JOIN studio.organizations o ON o.id = p.organization_id
        WHERE p.id = $1 AND m.actor_id = $2`,
      [resourceProjectId, subject]);
    const row = result.rows[0];
    if (!row || row.status !== "active" || row.organization_status !== "active") return false;

    const owner = row.role === "owner";
    const administrator = owner || row.role === "admin";
    switch (action) {
      case "director.plan.create":
        return ["owner", "admin", "member"].includes(row.role);
      case "director.plan.approve":
      case "director.plan.dispatch":
      case "director.plan.execute":
        return owner;
      case "task.assign":
        return administrator;
      case "task.qa.review":
        return administrator && Boolean(specialist?.id);
      default:
        return false;
    }
  }

  return Object.freeze({ loadProject, loadPlan, authorize });
}
