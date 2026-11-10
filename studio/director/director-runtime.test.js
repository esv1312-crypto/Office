import test from "node:test";
import assert from "node:assert/strict";
import { createDirectorRuntime } from "./director-runtime.js";

const project = {
  id: "project-1", organizationId: "org-1", productProfileId: "roblox",
  name: "Football Fans", status: "active",
};
const actor = { id: "owner-1" };
const proposal = {
  title: "Build playable fan district",
  objective: "Deliver a first playable social district",
  summary: "Create the initial map and a basic interaction loop.",
  acceptanceCriteria: ["The map loads", "Players can join a fan group"],
  tasks: [{
    title: "Build district blockout",
    description: "Create the first playable district layout.",
    requiredCompetencies: ["roblox", "lua"],
    requiredTools: [],
    acceptanceCriteria: ["All key zones exist", "Spawn is accessible"],
  }, {
    title: "Implement fan group flow",
    description: "Create a basic join and leave flow.",
    requiredCompetencies: ["lua", "gameplay-systems"],
    requiredTools: [],
    acceptanceCriteria: ["Players can join", "Players can leave"],
  }],
  modelSnapshot: { provider: "test", model: "planner-fixture", version: "1" },
};

function setup({ allowed = true, generated = proposal } = {}) {
  const saved = [];
  let id = 0;
  const runtime = createDirectorRuntime({
    planningGateway: { generatePlan: async input => { saved.push({ planningInput: input }); return Array.isArray(generated) ? generated.shift() : generated; } },
    store: { createPlanWithTasks: async input => {
      saved.push({ persistedInput: input });
      return { plan: input.plan, tasks: input.tasks };
    } },
    authorize: async () => allowed,
    createId: () => `id-${++id}`,
    now: () => "2026-11-07T10:00:00.000Z",
  });
  return { runtime, saved };
}

test("turns owner request into proposed plan and draft tasks", async () => {
  const { runtime, saved } = setup();
  const result = await runtime.plan({ request: "Create the first playable game slice", project, actor });
  assert.equal(result.status, "proposed");
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].status, "draft");
  assert.deepEqual(result.tasks[0].requiredCompetencies, ["roblox", "lua"]);
  assert.deepEqual(result.tasks[0].requiredTools, []);
  assert.deepEqual(saved[1].persistedInput.plan.planningModelSnapshot, proposal.modelSnapshot);
});

test("rejects a plan task that omits the requiredTools declaration", async () => {
  const generated = {
    ...proposal,
    tasks: [{ ...proposal.tasks[0] }],
  };
  delete generated.tasks[0].requiredTools;
  const { runtime, saved } = setup({ generated });
  await assert.rejects(
    runtime.plan({ request: "Do work", project, actor }),
    /requiredTools must be an array/,
  );
  assert.equal(saved.length, 2);
});

test("retries once with deterministic validation feedback when a proposal violates the Director contract", async () => {
  const invalid = { ...proposal, tasks: [{ ...proposal.tasks[0] }] };
  delete invalid.tasks[0].requiredTools;
  const { runtime, saved } = setup({ generated: [invalid, proposal] });
  const result = await runtime.plan({ request: "Do work", project, actor });
  assert.equal(saved.filter(item => item.planningInput).length, 2);
  assert.match(saved[1].planningInput.request, /DIRECTOR VALIDATION CORRECTION REQUIRED/);
  assert.match(saved[1].planningInput.request, /requiredTools must be an array/);
  assert.equal(result.plan.planningModelSnapshot.validationRetryUsed, true);
  assert.match(result.plan.planningModelSnapshot.validationFeedback, /requiredTools must be an array/);
  assert.equal(saved.filter(item => item.persistedInput).length, 1);
});

test("fails closed with a stable code after the single validation correction attempt", async () => {
  const invalid = { ...proposal, tasks: [{ ...proposal.tasks[0] }] };
  delete invalid.tasks[0].requiredTools;
  const { runtime, saved } = setup({ generated: [invalid, invalid] });
  await assert.rejects(
    runtime.plan({ request: "Do work", project, actor }),
    error => error.code === "INVALID_PLAN_PROPOSAL" && /correction attempt/.test(error.message),
  );
  assert.equal(saved.filter(item => item.planningInput).length, 2);
  assert.equal(saved.filter(item => item.persistedInput).length, 0);
});

test("does not call planner when owner authorization is denied", async () => {
  const { runtime, saved } = setup({ allowed: false });
  await assert.rejects(
    runtime.plan({ request: "Do work", project, actor }),
    error => error.code === "PLAN_FORBIDDEN",
  );
  assert.equal(saved.length, 0);
});

test("rejects malformed plans instead of persisting partial tasks", async () => {
  const { runtime, saved } = setup({ generated: { ...proposal, tasks: [] } });
  await assert.rejects(
    runtime.plan({ request: "Do work", project, actor }),
    /between 1 and 8 bounded stage tasks/,
  );
  assert.equal(saved.length, 2);
});


test("rejects oversized stage plans instead of dispatching a whole-program backlog", async () => {
  const { runtime, saved } = setup({
    generated: { ...proposal, tasks: Array.from({ length: 9 }, (_, index) => ({
      ...proposal.tasks[0], title: `Task ${index + 1}`,
    })) },
  });
  await assert.rejects(
    runtime.plan({ request: "Build the entire office", project, actor }),
    /between 1 and 8 bounded stage tasks/,
  );
  assert.equal(saved.length, 2);
});

test("rejects oversized task descriptions and acceptance criteria", async () => {
  const tooLong = setup({ generated: {
    ...proposal,
    tasks: [{ ...proposal.tasks[0], description: "x".repeat(1201) }],
  } });
  await assert.rejects(
    tooLong.runtime.plan({ request: "Do work", project, actor }),
    /1200 characters or fewer/,
  );
  const tooManyCriteria = setup({ generated: {
    ...proposal,
    tasks: [{ ...proposal.tasks[0], acceptanceCriteria: ["1", "2", "3", "4", "5"] }],
  } });
  await assert.rejects(
    tooManyCriteria.runtime.plan({ request: "Do work", project, actor }),
    /between 1 and 4 items/,
  );
});

test("does not persist if project is inactive", async () => {
  const { runtime, saved } = setup();
  await assert.rejects(
    runtime.plan({ request: "Do work", project: { ...project, status: "paused" }, actor }),
    error => error.code === "PROJECT_NOT_ACTIVE",
  );
  assert.equal(saved.length, 0);
});
