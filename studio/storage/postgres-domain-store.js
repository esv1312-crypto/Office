/**
 * PostgreSQL repositories for Studio projects, specialists, and tasks.
 * The caller injects a pg-compatible pool; this module never connects or migrates.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
}
function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  return value;
}
function timestamp(value) {
  const result = required(value, "at");
  if (Number.isNaN(Date.parse(result))) throw new TypeError("at must be a valid timestamp");
  return result;
}
async function transaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
function eventId(createId) {
  return required(createId(), "generated eventId");
}

export function createPostgresDomainStore({ pool, createId }) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A pg-compatible pool is required");
  if (typeof createId !== "function") throw new TypeError("createId is required");

  return Object.freeze({
    async createProject(input) {
      const project = object(input, "project");
      const id = required(project.id, "project.id");
      const organizationId = required(project.organizationId, "project.organizationId");
      const name = required(project.name, "project.name");
      const profile = required(project.productProfileId, "project.productProfileId");
      const at = timestamp(project.createdAt);
      if (project.status !== "active" || project.version !== 1) throw new TypeError("New project must be active at version 1");
      return transaction(pool, async client => {
        await client.query(
          `INSERT INTO studio.projects
             (id, organization_id, name, product_profile_id, status, version, payload, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
          [id, organizationId, name, profile, project.status, project.version, JSON.stringify(project), at, timestamp(project.updatedAt)]);
        const idForEvent = eventId(createId);
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
           VALUES ($1,$2,'project',$3,'project.created',$4::jsonb,$5)`,
          [idForEvent, organizationId, id, JSON.stringify({ name, productProfileId: profile }), at]);
        return { project, eventId: idForEvent };
      });
    },

    async createSpecialist(input) {
      const specialist = object(input, "specialist");
      const id = required(specialist.id, "specialist.id");
      const organizationId = required(specialist.organizationId, "specialist.organizationId");
      const name = required(specialist.name, "specialist.name");
      const role = required(specialist.role, "specialist.role");
      const at = timestamp(specialist.createdAt);
      if (specialist.status !== "active" || specialist.version !== 1) throw new TypeError("New specialist must be active at version 1");
      if (!Array.isArray(specialist.competencies) || !Array.isArray(specialist.allowedTools)) {
        throw new TypeError("Specialist competencies and allowedTools must be arrays");
      }
      return transaction(pool, async client => {
        await client.query(
          `INSERT INTO studio.specialists
             (id, organization_id, name, role, status, version, payload, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
          [id, organizationId, name, role, specialist.status, specialist.version,
            JSON.stringify(specialist), at, timestamp(specialist.updatedAt)]);
        const idForEvent = eventId(createId);
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
           VALUES ($1,$2,'specialist',$3,'specialist.created',$4::jsonb,$5)`,
          [idForEvent, organizationId, id, JSON.stringify({ name, role, competencies: specialist.competencies }), at]);
        return { specialist, eventId: idForEvent };
      });
    },

    async createPlanWithTasks({ plan: planInput, tasks: taskInputs }) {
      const plan = object(planInput, "plan");
      const planId = required(plan.id, "plan.id");
      const projectId = required(plan.projectId, "plan.projectId");
      const at = timestamp(plan.createdAt);
      if (plan.status !== "proposed" || plan.version !== 1) {
        throw new TypeError("A new director plan must be proposed at version 1");
      }
      if (!Array.isArray(taskInputs) || taskInputs.length < 1 || taskInputs.length > 50) {
        throw new TypeError("A director plan must contain between 1 and 50 tasks");
      }
      const tasks = taskInputs.map(task => {
        object(task, "task");
        if (task.projectId !== projectId || task.status !== "draft" ||
            task.version !== 1 || task.assigneeSpecialistId !== null) {
          throw new TypeError("Plan tasks must be new, draft, unassigned tasks in the same project");
        }
        return task;
      });
      return transaction(pool, async client => {
        const projectResult = await client.query(
          "SELECT organization_id FROM studio.projects WHERE id = $1 AND status = 'active' FOR SHARE",
          [projectId]);
        const project = projectResult.rows[0];
        if (!project) throw Object.assign(new Error("Active project not found"), { code: "PROJECT_NOT_FOUND_OR_INACTIVE" });
        await client.query(
          `INSERT INTO studio.plans
             (id, project_id, status, version, payload, created_at, updated_at)
           VALUES ($1,$2,'proposed',1,$3::jsonb,$4,$5)`,
          [planId, projectId, JSON.stringify(plan), at, timestamp(plan.updatedAt)]);
        for (const task of tasks) {
          await client.query(
            `INSERT INTO studio.tasks
               (id, project_id, plan_id, status, assignee_specialist_id, version, payload, created_at, updated_at)
             VALUES ($1,$2,$3,'draft',NULL,1,$4::jsonb,$5,$6)`,
            [required(task.id, "task.id"), projectId, planId, JSON.stringify(task),
              timestamp(task.createdAt), timestamp(task.updatedAt)]);
        }
        const createdEventId = eventId(createId);
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
           VALUES ($1,$2,$3,'plan',$4,'plan.created',$5::jsonb,$6)`,
          [createdEventId, project.organization_id, projectId, planId,
            JSON.stringify({ title: plan.title, taskIds: tasks.map(task => task.id), status: "proposed" }), at]);
        for (const task of tasks) {
          await client.query(
            `INSERT INTO studio.events
               (id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
             VALUES ($1,$2,$3,'task',$4,'task.created',$5::jsonb,$6)`,
            [eventId(createId), project.organization_id, projectId, task.id,
              JSON.stringify({ title: task.title, planId, requiredCompetencies: task.requiredCompetencies }), at]);
        }
        return { plan, tasks, eventId: createdEventId };
      });
    },

    async createTask(input) {
      const task = object(input, "task");
      const id = required(task.id, "task.id");
      const projectId = required(task.projectId, "task.projectId");
      const title = required(task.title, "task.title");
      const at = timestamp(task.createdAt);
      if (task.status !== "draft" || task.version !== 1 || task.assigneeSpecialistId !== null) {
        throw new TypeError("New task must be draft, unassigned, and at version 1");
      }
      if (!Array.isArray(task.requiredCompetencies)) throw new TypeError("Task requiredCompetencies must be an array");
      return transaction(pool, async client => {
        const projectResult = await client.query(
          "SELECT organization_id FROM studio.projects WHERE id = $1 AND status = 'active' FOR SHARE",
          [projectId]);
        const project = projectResult.rows[0];
        if (!project) throw Object.assign(new Error("Active project not found"), { code: "PROJECT_NOT_FOUND_OR_INACTIVE" });
        await client.query(
          `INSERT INTO studio.tasks
             (id, project_id, status, assignee_specialist_id, version, payload, created_at, updated_at)
           VALUES ($1,$2,'draft',NULL,1,$3::jsonb,$4,$5)`,
          [id, projectId, JSON.stringify(task), at, timestamp(task.updatedAt)]);
        const idForEvent = eventId(createId);
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
           VALUES ($1,$2,$3,'task',$4,'task.created',$5::jsonb,$6)`,
          [idForEvent, project.organization_id, projectId, id,
            JSON.stringify({ title, requiredCompetencies: task.requiredCompetencies }), at]);
        return { task, eventId: idForEvent };
      });
    },
  });
}
