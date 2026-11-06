import { insertOutboxEvent } from "./postgres-outbox-store.js";

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
}
function asObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  return value;
}
async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Atomically creates the first owner organization, project, and its initial
 * dynamic specialist team. Requires Studio migrations 001, 004, and 006.
 */
export function createPostgresWorkspaceBootstrapStore({ pool, createId }) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A pg-compatible pool is required");
  if (typeof createId !== "function") throw new TypeError("createId is required");

  return Object.freeze({
    async createWorkspace({ organization: organizationInput, ownerActorId, project: projectInput, specialists: specialistInputs }) {
      const organization = asObject(organizationInput, "organization");
      const project = asObject(projectInput, "project");
      const actorId = required(ownerActorId, "ownerActorId");
      const specialists = specialistInputs;
      const organizationId = required(organization.id, "organization.id");
      const organizationName = required(organization.name, "organization.name");
      const projectId = required(project.id, "project.id");
      if (project.organizationId !== organizationId) throw new TypeError("Project must belong to the new organization");
      if (project.status !== "active" || project.version !== 1) throw new TypeError("New project must be active at version 1");
      if (!Array.isArray(specialists) || specialists.length < 1 || specialists.length > 50) {
        throw new TypeError("Workspace must include between 1 and 50 specialists");
      }
      const seen = new Set();
      const team = specialists.map((item, index) => {
        const specialist = asObject(item, `specialists[${index}]`);
        const id = required(specialist.id, `specialists[${index}].id`);
        if (seen.has(id)) throw new TypeError("Specialist IDs must be unique");
        seen.add(id);
        if (specialist.organizationId !== organizationId || specialist.status !== "active" || specialist.version !== 1) {
          throw new TypeError("Every new specialist must be active, version 1, and belong to the new organization");
        }
        required(specialist.name, `specialists[${index}].name`);
        required(specialist.role, `specialists[${index}].role`);
        required(specialist.instructions, `specialists[${index}].instructions`);
        if (!Array.isArray(specialist.competencies) || !Array.isArray(specialist.allowedTools)) {
          throw new TypeError("Specialist competencies and allowedTools must be arrays");
        }
        return specialist;
      });

      return transaction(pool, async client => {
        await client.query(
          "INSERT INTO studio.organizations (id, name, status, created_at) VALUES ($1,$2,'active',$3)",
          [organizationId, organizationName, required(organization.createdAt, "organization.createdAt")],
        );
        await client.query(
          `INSERT INTO studio.organization_memberships
             (organization_id, actor_id, role, status, created_at, updated_at)
           VALUES ($1,$2,'owner','active',$3,$4)`,
          [organizationId, actorId, required(organization.createdAt, "organization.createdAt"),
            required(organization.createdAt, "organization.createdAt")],
        );

        await client.query(
          `INSERT INTO studio.projects
             (id, organization_id, name, product_profile_id, status, version, payload, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'active',1,$5::jsonb,$6,$7)`,
          [projectId, organizationId, required(project.name, "project.name"),
            required(project.productProfileId, "project.productProfileId"), JSON.stringify(project),
            required(project.createdAt, "project.createdAt"), required(project.updatedAt, "project.updatedAt")],
        );

        const organizationEventId = required(createId(), "generated organization event ID");
        const organizationPayload = { name: organizationName, ownerActorId: actorId };
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
           VALUES ($1,$2,'organization',$3,'organization.created',$4::jsonb,$5)`,
          [organizationEventId, organizationId, organizationId, JSON.stringify(organizationPayload),
            required(organization.createdAt, "organization.createdAt")],
        );
        await insertOutboxEvent(client, {
          eventId: organizationEventId, organizationId, aggregateType: "organization",
          aggregateId: organizationId, eventType: "organization.created",
          payload: organizationPayload, occurredAt: organization.createdAt,
        });

        const projectEventId = required(createId(), "generated project event ID");
        const projectPayload = { name: project.name, productProfileId: project.productProfileId };
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
           VALUES ($1,$2,$3,'project',$4,'project.created',$5::jsonb,$6)`,
          [projectEventId, organizationId, projectId, projectId, JSON.stringify(projectPayload), project.createdAt],
        );
        await insertOutboxEvent(client, {
          eventId: projectEventId, organizationId, projectId, aggregateType: "project",
          aggregateId: projectId, eventType: "project.created", payload: projectPayload,
          occurredAt: project.createdAt,
        });

        for (const specialist of team) {
          await client.query(
            `INSERT INTO studio.specialists
               (id, organization_id, name, role, status, version, payload, created_at, updated_at)
             VALUES ($1,$2,$3,$4,'active',1,$5::jsonb,$6,$7)`,
            [specialist.id, organizationId, specialist.name, specialist.role,
              JSON.stringify(specialist), specialist.createdAt, specialist.updatedAt],
          );
          const eventId = required(createId(), "generated specialist event ID");
          const payload = {
            name: specialist.name, role: specialist.role,
            competencies: specialist.competencies,
          };
          await client.query(
            `INSERT INTO studio.events
               (id, organization_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
             VALUES ($1,$2,'specialist',$3,'specialist.created',$4::jsonb,$5)`,
            [eventId, organizationId, specialist.id, JSON.stringify(payload), specialist.createdAt],
          );
          await insertOutboxEvent(client, {
            eventId, organizationId, aggregateType: "specialist", aggregateId: specialist.id,
            eventType: "specialist.created", payload, occurredAt: specialist.createdAt,
          });
        }

        return {
          organization: { ...organization, id: organizationId, name: organizationName, status: "active" },
          project,
          specialists: team,
          ownerActorId: actorId,
        };
      });
    },
  });
}
