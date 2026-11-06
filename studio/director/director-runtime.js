import { createTask } from "../core/create-task.js";

/**
 * AI Director: turns an owner request into a proposed, persisted plan.
 * It does not approve the plan, assign specialists, or start Workers.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
}
function nonEmptyStrings(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) {
    throw new TypeError(`${field} must be an array of non-empty strings`);
  }
  return [...value];
}
function validateProposal(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new TypeError("Planning gateway must return a plan object");
  }
  const title = required(proposal.title, "plan.title");
  const objective = required(proposal.objective, "plan.objective");
  const summary = required(proposal.summary, "plan.summary");
  const acceptanceCriteria = nonEmptyStrings(proposal.acceptanceCriteria, "plan.acceptanceCriteria");
  if (!Array.isArray(proposal.tasks) || proposal.tasks.length < 1 || proposal.tasks.length > 25) {
    throw new TypeError("Plan must contain between 1 and 25 tasks");
  }
  const tasks = proposal.tasks.map((task, index) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      throw new TypeError(`plan.tasks[${index}] must be an object`);
    }
    return {
      title: required(task.title, `plan.tasks[${index}].title`),
      description: required(task.description, `plan.tasks[${index}].description`),
      requiredCompetencies: nonEmptyStrings(task.requiredCompetencies, `plan.tasks[${index}].requiredCompetencies`),
      acceptanceCriteria: nonEmptyStrings(task.acceptanceCriteria, `plan.tasks[${index}].acceptanceCriteria`),
    };
  });
  const modelSnapshot = proposal.modelSnapshot;
  if (!modelSnapshot || typeof modelSnapshot !== "object" || Array.isArray(modelSnapshot)) {
    throw new TypeError("Planning gateway must include a modelSnapshot object");
  }
  return { title, objective, summary, acceptanceCriteria, tasks, modelSnapshot };
}

export function createDirectorRuntime({
  planningGateway, store, authorize, createId,
  now = () => new Date().toISOString(),
}) {
  if (!planningGateway || typeof planningGateway.generatePlan !== "function") {
    throw new TypeError("planningGateway.generatePlan is required");
  }
  if (!store || typeof store.createPlanWithTasks !== "function") {
    throw new TypeError("Director requires a durable createPlanWithTasks store");
  }
  if (typeof authorize !== "function") throw new TypeError("Director authorization function is required");
  if (typeof createId !== "function") throw new TypeError("createId is required");

  return Object.freeze({
    async plan({ request, project, actor, constraints = {} }) {
      const userRequest = required(request, "request");
      if (!project || typeof project !== "object") throw new TypeError("project is required");
      const projectId = required(project.id, "project.id");
      const organizationId = required(project.organizationId, "project.organizationId");
      const productProfileId = required(project.productProfileId, "project.productProfileId");
      if (project.status !== "active") throw Object.assign(new Error("Project is not active"), { code: "PROJECT_NOT_ACTIVE" });

      const permitted = await authorize({ actor, action: "director.plan.create", project });
      if (permitted !== true) throw Object.assign(new Error("Plan creation is not authorized"), { code: "PLAN_FORBIDDEN" });

      const generated = await planningGateway.generatePlan({
        request: userRequest,
        project: { id: projectId, organizationId, productProfileId, name: project.name },
        constraints,
      });
      const proposal = validateProposal(generated);
      const at = now();
      if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new TypeError("Director clock returned an invalid timestamp");

      const planId = required(createId(), "generated planId");
      const plan = {
        id: planId,
        projectId,
        organizationId,
        title: proposal.title,
        objective: proposal.objective,
        summary: proposal.summary,
        acceptanceCriteria: proposal.acceptanceCriteria,
        status: "proposed",
        version: 1,
        createdBy: actor?.id || null,
        planningModelSnapshot: proposal.modelSnapshot,
        createdAt: at,
        updatedAt: at,
      };
      const tasks = proposal.tasks.map(task => createTask({
        id: required(createId(), "generated taskId"),
        projectId,
        title: task.title,
        description: task.description,
        requiredCompetencies: task.requiredCompetencies,
        acceptanceCriteria: task.acceptanceCriteria,
        at,
      }));
      const persisted = await store.createPlanWithTasks({ plan, tasks });
      if (!persisted || persisted.plan?.id !== planId ||
          !Array.isArray(persisted.tasks) || persisted.tasks.length !== tasks.length) {
        throw new Error("Domain store did not confirm durable plan and task creation");
      }
      return { plan: persisted.plan, tasks: persisted.tasks, status: "proposed" };
    },
  });
}
