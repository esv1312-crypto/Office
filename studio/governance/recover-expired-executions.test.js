import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionRecovery } from "./recover-expired-executions.js";

test("authorizes and recovers expired executions", async () => {
  let saved;
  const recovery = createExecutionRecovery({
    store: { async recoverExpiredExecutions(input) {
      saved = input;
      return { recovered: 1, tasks: [{ taskId: "task-1", executionId: "exec-1", status: "assigned" }] };
    } },
    authorize: async input => input.action === "execution.recover",
    now: () => "2026-11-07T12:00:00.000Z",
  });
  const result = await recovery.recover({ actor: { id: "system-maintenance" }, limit: 5 });
  assert.equal(result.recovered, 1);
  assert.deepEqual(saved, { at: "2026-11-07T12:00:00.000Z", limit: 5 });
});

test("does not recover executions when governance denies access", async () => {
  const recovery = createExecutionRecovery({
    store: { async recoverExpiredExecutions() { assert.fail("must not recover"); } },
    authorize: async () => false,
  });
  await assert.rejects(
    recovery.recover({ actor: { id: "worker-1" } }),
    error => error.code === "EXECUTION_RECOVERY_FORBIDDEN",
  );
});

test("rejects invalid recovery limits", async () => {
  const recovery = createExecutionRecovery({
    store: { async recoverExpiredExecutions() { assert.fail("must not recover"); } },
    authorize: async () => true,
  });
  await assert.rejects(recovery.recover({ limit: 0 }), /limit must be a positive integer/);
});
