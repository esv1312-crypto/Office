import test from "node:test";
import assert from "node:assert/strict";
import { recoverBeforeOwnerTaskClaim } from "./owner-task-startup.js";

test("recovers expired leases before checking the one-shot owner-task claim", async () => {
  const calls = [];
  const result = await recoverBeforeOwnerTaskClaim({
    actor: { id: "legacy-office-owner" },
    recovery: {
      async recover(input) {
        calls.push(["recovery", input]);
        return { recovered: 2, tasks: [{ taskId: "a" }, { taskId: "b" }] };
      },
    },
    async claim() {
      calls.push(["claim"]);
      return { rowCount: 0, rows: [] };
    },
  });

  assert.deepEqual(calls.map(([name]) => name), ["recovery", "claim"]);
  assert.deepEqual(calls[0][1], { actor: { id: "legacy-office-owner" }, limit: 50 });
  assert.equal(result.recovery.recovered, 2);
  assert.equal(result.alreadyClaimed, true);
});

test("does not dispatch work or call model gateways during recovery and claim", async () => {
  let dispatchCalls = 0;
  let modelCalls = 0;
  const result = await recoverBeforeOwnerTaskClaim({
    actor: { id: "legacy-office-owner" },
    recovery: { async recover() { return { recovered: 0, tasks: [] }; } },
    async claim() { return { rowCount: 1, rows: [{ task_key: "owner-task", plan_id: null }] }; },
  });

  assert.equal(result.alreadyClaimed, false);
  assert.equal(dispatchCalls, 0);
  assert.equal(modelCalls, 0);
});
