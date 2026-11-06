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

    async approvePlan({ planId, actorId = null, at }) {
      const id = required(planId, "planId");
      const approvedAt = timestamp(at);
      return transaction(pool, async client => {
        const planResult = await client.query(
          "SELECT id, project_id, status, version, payload FROM studio.plans WHERE id = $1 FOR UPDATE",
          [id]);
        const planRow = planResult.rows[0];
        if (!planRow) throw Object.assign(new Error("Plan not found"), { code: "PLAN_NOT_FOUND" });
        if (planRow.status !== "proposed") {
          throw Object.assign(new Error("Only proposed plans can be approved"), { code: "PLAN_NOT_PROPOSED" });
        }
        const projectResult = await client.query(
          "SELECT organization_id FROM studio.projects WHERE id = $1",
          [planRow.project_id]);
        const organizationId = projectResult.rows[0]?.organization_id;
        if (!organizationId) throw new Error("Plan project is missing");
        const taskResult = await client.query(
          "SELECT id, status, version, payload FROM studio.tasks WHERE plan_id = $1 ORDER BY id FOR UPDATE",
          [id]);
        if (!taskResult.rows.length) {
          throw Object.assign(new Error("Plan has no tasks"), { code: "PLAN_HAS_NO_TASKS" });
        }
        if (taskResult.rows.some(row => row.status !== "draft")) {
          throw Object.assign(new Error("Plan tasks are not all in draft state"), { code: "PLAN_TASK_STATE_CONFLICT" });
        }

        const nextPlan = {
          ...(planRow.payload || {}), status: "approved",
          version: Number(planRow.version) + 1, approvedAt, approvedBy: actorId,
          updatedAt: approvedAt,
        };
        await client.query(
          "UPDATE studio.plans SET status = 'approved', version = $2, payload = $3::jsonb, updated_at = $4 WHERE id = $1",
          [id, nextPlan.version, JSON.stringify(nextPlan), approvedAt]);
        const approvedTasks = [];
        for (const row of taskResult.rows) {
          const nextTask = {
            ...(row.payload || {}), status: "planned",
            version: Number(row.version) + 1, updatedAt: approvedAt,
          };
          await client.query(
            "UPDATE studio.tasks SET status = 'planned', version = $2, payload = $3::jsonb, updated_at = $4 WHERE id = $1",
            [row.id, nextTask.version, JSON.stringify(nextTask), approvedAt]);
          approvedTasks.push(nextTask);
          await client.query(
            `INSERT INTO studio.events
               (id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
             VALUES ($1,$2,$3,'task',$4,'task.status_changed',$5::jsonb,$6)`,
            [eventId(createId), organizationId, planRow.project_id, row.id,
              JSON.stringify({ from: "draft", to: "planned", planId: id, actorId }), approvedAt]);
        }
        const approvalEventId = eventId(createId);
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
           VALUES ($1,$2,$3,'plan',$4,'plan.approved',$5::jsonb,$6)`,
          [approvalEventId, organizationId, planRow.project_id, id,
            JSON.stringify({ actorId, taskIds: approvedTasks.map(task => task.id) }), approvedAt]);
        return { plan: nextPlan, tasks: approvedTasks, eventId: approvalEventId };
      });
    },

    async loadApprovedPlanForDispatch({ planId }) {
      const id = required(planId, "planId");
      const client = await pool.connect();
      try {
        const planResult = await client.query(
          `SELECT pl.id, pl.project_id, pl.status, pl.version, pl.payload,
                  pr.organization_id, pr.status AS project_status
             FROM studio.plans pl JOIN studio.projects pr ON pr.id = pl.project_id
            WHERE pl.id = $1`, [id]);
        const row = planResult.rows[0];
        if (!row) throw Object.assign(new Error("Plan not found"), { code: "PLAN_NOT_FOUND" });
        if (row.status !== "approved") throw Object.assign(new Error("Plan is not approved"), { code: "PLAN_NOT_APPROVED" });
        if (row.project_status !== "active") throw Object.assign(new Error("Project is not active"), { code: "PROJECT_NOT_ACTIVE" });
        const taskResult = await client.query(
          "SELECT id, project_id, status, assignee_specialist_id, version, payload FROM studio.tasks WHERE plan_id = $1 ORDER BY id",
          [id]);
        return {
          plan: { ...(row.payload || {}), id: row.id, projectId: row.project_id, status: row.status, version: Number(row.version) },
          organizationId: row.organization_id,
          tasks: taskResult.rows.map(task => ({
            ...(task.payload || {}), id: task.id, projectId: task.project_id,
            status: task.status, assigneeSpecialistId: task.assignee_specialist_id,
            version: Number(task.version),
          })),
        };
      } finally {
        client.release();
      }
    },

    async getTask({ taskId }) {
      const id = required(taskId, "taskId");
      const result = await pool.query(
        `SELECT t.id, t.project_id, t.status, t.assignee_specialist_id, t.version,
                t.payload, p.organization_id
           FROM studio.tasks t JOIN studio.projects p ON p.id = t.project_id
          WHERE t.id = $1`, [id]);
      const row = result.rows[0];
      if (!row) return null;
      return {
        ...(row.payload || {}), id: row.id, projectId: row.project_id,
        organizationId: row.organization_id, status: row.status,
        assigneeSpecialistId: row.assignee_specialist_id, version: Number(row.version),
      };
    },

    async getSpecialist({ specialistId }) {
      const id = required(specialistId, "specialistId");
      const result = await pool.query(
        `SELECT id, organization_id, name, role, status, version, payload
           FROM studio.specialists WHERE id = $1`, [id]);
      const row = result.rows[0];
      if (!row) return null;
      return {
        ...(row.payload || {}), id: row.id, organizationId: row.organization_id,
        name: row.name, role: row.role, status: row.status, version: Number(row.version),
      };
    },

    async listActiveSpecialists({ organizationId }) {
      const orgId = required(organizationId, "organizationId");
      const result = await pool.query(
        `SELECT id, organization_id, name, role, status, version, payload
           FROM studio.specialists
          WHERE organization_id = $1 AND status = 'active'
          ORDER BY id`, [orgId]);
      return result.rows.map(row => ({
        ...(row.payload || {}), id: row.id, organizationId: row.organization_id,
        name: row.name, role: row.role, status: row.status, version: Number(row.version),
      }));
    },

    async markTaskReady({ taskId, expectedVersion, at, actorId = null }) {
      const id = required(taskId, "taskId");
      const readyAt = timestamp(at);
      return transaction(pool, async client => {
        const taskResult = await client.query(
          `SELECT t.*, p.organization_id
             FROM studio.tasks t JOIN studio.projects p ON p.id = t.project_id
            WHERE t.id = $1 FOR UPDATE OF t`, [id]);
        const row = taskResult.rows[0];
        if (!row) throw Object.assign(new Error("Task not found"), { code: "TASK_NOT_FOUND" });
        if (row.status !== "planned") throw Object.assign(new Error("Only planned tasks can become ready"), { code: "TASK_NOT_PLANNED" });
        if (expectedVersion !== undefined && Number(row.version) !== expectedVersion) {
          throw Object.assign(new Error("Task version conflict"), { code: "TASK_VERSION_CONFLICT" });
        }
        const payload = {
          ...(row.payload || {}), status: "ready",
          version: Number(row.version) + 1, updatedAt: readyAt,
        };
        await client.query(
          "UPDATE studio.tasks SET status = 'ready', version = $2, payload = $3::jsonb, updated_at = $4 WHERE id = $1",
          [id, payload.version, JSON.stringify(payload), readyAt]);
        const idForEvent = eventId(createId);
        await client.query(
          `INSERT INTO studio.events
             (id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
           VALUES ($1,$2,$3,'task',$4,'task.status_changed',$5::jsonb,$6)`,
          [idForEvent, row.organization_id, row.project_id, id,
            JSON.stringify({ from: "planned", to: "ready", actorId }), readyAt]);
        return { task: payload, eventId: idForEvent };
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
