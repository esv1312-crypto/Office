import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerPool } from "./worker-pool.js";

function fixture({ concurrency = 2, failures = {} } = {}) {
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  const tasks = new Map(["a", "b", "c", "d"].map(id => [id, {
    id, status: "assigned", assigneeSpecialistId: `spec-${id}`,
  }]));
  const specialists = new Map(["a", "b", "c", "d"].map(id => [`spec-${id}`, {
    id: `spec-${id}`, role: "builder", instructions: "Build carefully",
  }]));
  const pool = createWorkerPool({
    concurrency,
    createWorkerId: (() => { let n = 0; return () => `worker-${++n}`; })(),
    directory: {
      async getTask({ taskId }) { return tasks.get(taskId) || null; },
      async getSpecialist({ specialistId }) { return specialists.get(specialistId) || null; },
    },
    worker: {
      async execute(input) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        calls.push(input);
        try {
          await new Promise(resolve => setTimeout(resolve, 10));
          if (failures[input.taskId]) throw Object.assign(new Error("worker exploded"), { code: "WORKER_CRASH" });
          return { executionId: `exec-${input.taskId}`, status: "qa", artifactId: `artifact-${input.taskId}`, output: "done" };
        } finally { active -= 1; }
      },
    },
  });
  return { pool, calls, get maximumActive() { return maximumActive; } };
}

test("executes assignments with a bounded number of concurrent Workers", async () => {
  const f = fixture({ concurrency: 2 });
  const result = await f.pool.executeAssignments(["a", "b", "c", "d"].map(id => ({
    taskId: id, specialistId: `spec-${id}`,
  })));
  assert.equal(result.length, 4);
  assert.ok(result.every(item => item.status === "qa"));
  assert.equal(f.maximumActive, 2);
  assert.deepEqual(result.map(item => item.taskId), ["a", "b", "c", "d"]);
});

test("isolates a Worker failure and continues processing other assignments", async () => {
  const f = fixture({ concurrency: 2, failures: { b: true } });
  const result = await f.pool.executeAssignments(["a", "b", "c"].map(id => ({
    taskId: id, specialistId: `spec-${id}`,
  })));
  assert.equal(result[1].status, "failed");
  assert.equal(result[1].errorCode, "WORKER_CRASH");
  assert.equal(result[2].status, "qa");
});

test("does not start a Worker for stale task assignment", async () => {
  const f = fixture();
  const result = await f.pool.executeAssignments([
    { taskId: "a", specialistId: "spec-b" },
  ]);
  assert.equal(result[0].status, "failed");
  assert.equal(result[0].errorCode, "ASSIGNMENT_STALE");
  assert.equal(f.calls.length, 0);
});

test("validates concurrency and assignment input", async () => {
  assert.throws(() => fixture({ concurrency: 0 }), /concurrency/);
  const f = fixture();
  await assert.rejects(f.pool.executeAssignments({}), /assignments must be an array/);
});
