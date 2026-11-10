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
function boundedStrings(value, field, min, max) {
  const items = nonEmptyStrings(value, field);
  if (items.length < min || items.length > max) {
    throw new TypeError(`${field} must contain between ${min} and ${max} items`);
  }
  return items;
}
function validateProposal(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new TypeError("Planning gateway must return a plan object");
  }
  const title = required(proposal.title, "plan.title");
  const objective = required(proposal.objective, "plan.objective");
  const summary = required(proposal.summary, "plan.summary");
  const acceptanceCriteria = boundedStrings(proposal.acceptanceCriteria, "plan.acceptanceCriteria", 1, 8);
  if (!Array.isArray(proposal.tasks) || proposal.tasks.length < 1 || proposal.tasks.length > 8) {
    throw new TypeError("Plan must contain between 1 and 8 bounded stage tasks");
  }
  const tasks = proposal.tasks.map((task, index) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      throw new TypeError(`plan.tasks[${index}] must be an object`);
    }
    return {
      title: required(task.title, `plan.tasks[${index}].title`),
      description: (() => { const value = required(task.description, `plan.tasks[${index}].description`); if (value.length > 1200) throw new TypeError(`plan.tasks[${index}].description must be 1200 characters or fewer`); return value; })(),
      requiredCompetencies: boundedStrings(task.requiredCompetencies, `plan.tasks[${index}].requiredCompetencies`, 1, 6),
      requiredTools: (() => { const value = nonEmptyStrings(task.requiredTools, `plan.tasks[${index}].requiredTools`); if (value.length > 8) throw new TypeError(`plan.tasks[${index}].requiredTools must contain 8 items or fewer`); return [...new Set(value.map(item => item.trim()))]; })(),
      acceptanceCriteria: boundedStrings(task.acceptanceCriteria, `plan.tasks[${index}].acceptanceCriteria`, 1, 4),
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

      // A syntactically valid planner response can still violate the Director's
      // stricter plan contract. Give the configured planner exactly one bounded
      // correction attempt; never persist a partial or invalid proposal.
      let proposal = null;
      let validationRetryUsed = false;
      let validationFeedback = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const planningRequest = attempt === 1
          ? userRequest
          : [
              userRequest,
              "",
              "DIRECTOR VALIDATION CORRECTION REQUIRED:",
              `The previous proposal failed deterministic validation: ${validationFeedback}`,
              "Return a complete corrected plan that satisfies every field and item-count limit. Do not omit required fields.",
            ].join("\n");
        const generated = await planningGateway.generatePlan({
          request: planningRequest,
          project: { id: projectId, organizationId, productProfileId, name: project.name },
          constraints,
        });
        try {
          proposal = validateProposal(generated);
          break;
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          validationFeedback = String(error.message || "Plan schema validation failed").slice(0, 1000);
          if (attempt === 2) {
            throw Object.assign(
              new Error(`Planner returned an invalid proposal after one correction attempt: ${validationFeedback}`),
              { code: "INVALID_PLAN_PROPOSAL", cause: error },
            );
          }
          validationRetryUsed = true;
        }
      }
      if (!proposal) {
        throw Object.assign(new Error("Planner did not produce a valid proposal"), {
          code: "INVALID_PLAN_PROPOSAL",
        });
      }
      if (validationRetryUsed) {
        proposal = {
          ...proposal,
          modelSnapshot: {
            ...proposal.modelSnapshot,
            validationRetryUsed: true,
            validationFeedback,
          },
        };
      }
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
        requiredTools: task.requiredTools,
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
