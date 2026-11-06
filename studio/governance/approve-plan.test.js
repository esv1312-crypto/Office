import test from "node:test";
import assert from "node:assert/strict";
import { createPlanApproval } from "./approve-plan.js";

const plan = { id: "plan-1", status: "proposed" };
const actor = { id: "owner-1" };

test("requires owner authorization before persisting approval", async () => {
  let saved;
  const approval = createPlanApproval({
    store: { approvePlan: async input => {
      saved = input;
      return { plan: { ...plan, status: "approved" }, tasks: [{ id: "task-1", status: "planned" }] };
    } },
    authorize: async input => input.action === "director.plan.approve",
    now: () => "2026-11-07T10:00:00.000Z",
  });
  const result = await approval.approve({ plan, actor });
  assert.equal(result.plan.status, "approved");
  assert.equal(saved.planId, "plan-1");
  assert.equal(saved.actorId, "owner-1");
});

test("does not persist when approval is denied", async () => {
  const approval = createPlanApproval({
    store: { approvePlan: async () => assert.fail("must not persist") },
    authorize: async () => false,
  });
  await assert.rejects(
    approval.approve({ plan, actor }),
    error => error.code === "PLAN_APPROVAL_FORBIDDEN",
  );
});

test("rejects plans that are not proposed", async () => {
  const approval = createPlanApproval({
    store: { approvePlan: async () => assert.fail("must not persist") },
    authorize: async () => true,
  });
  await assert.rejects(
    approval.approve({ plan: { ...plan, status: "approved" }, actor }),
    error => error.code === "PLAN_NOT_PROPOSED",
  );
});
