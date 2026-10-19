import test from "node:test";
import assert from "node:assert/strict";
import { runWorkerWatchdogPass } from "../src/worker-watchdog.js";

test("watchdog persists timeout before emitting and scheduling parent recovery", async () => {
  const parent = { id: "root-1", kind: "root", status: "waiting" };
  const child = {
    id: "worker-1",
    kind: "subtask",
    parentTaskId: parent.id,
    employeeId: "developer",
    status: "running",
    startedAt: "2026-10-20T12:00:00.000Z"
  };
  const tasks = new Map([[parent.id, parent], [child.id, child]]);
  const order = [];
  const recoveries = [];
  await runWorkerWatchdogPass({
    tasks,
    nowMs: Date.parse("2026-10-20T12:00:10.000Z"),
    timeoutMs: 1000,
    transitionTask: async (record, status, extra) => {
      order.push("persist");
      record.status = status;
      Object.assign(record, extra);
    },
    emit: (type, payload) => {
      order.push("emit");
      assert.equal(type, "worker.watchdog_timeout");
      assert.equal(payload.taskId, child.id);
      assert.equal(payload.ageMs, 10000);
    },
    recoverFailedWorker: async (actualParent, actualChild) => {
      order.push("recover");
      recoveries.push([actualParent.id, actualChild.id]);
    }
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(order, ["persist", "emit", "recover"]);
  assert.equal(child.status, "failed");
  assert.equal(child.error, "WORKER_WATCHDOG_TIMEOUT");
  assert.equal(child.watchdogFailedAt, "2026-10-20T12:00:10.000Z");
  assert.deepEqual(recoveries, [[parent.id, child.id]]);
});

test("watchdog does not recover a parent after the timeout transition fails to persist", async () => {
  const parent = { id: "root-2", kind: "root", status: "running" };
  const child = {
    id: "worker-2",
    kind: "subtask",
    parentTaskId: parent.id,
    status: "running",
    startedAt: "2026-10-20T12:00:00.000Z"
  };
  let emitted = false;
  let recovered = false;
  await assert.rejects(runWorkerWatchdogPass({
    tasks: new Map([[parent.id, parent], [child.id, child]]),
    nowMs: Date.parse("2026-10-20T12:00:10.000Z"),
    timeoutMs: 1000,
    transitionTask: async () => { throw new Error("database unavailable"); },
    emit: () => { emitted = true; },
    recoverFailedWorker: async () => { recovered = true; }
  }), /database unavailable/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(emitted, false);
  assert.equal(recovered, false);
});

test("watchdog skips roots and tasks already marked as timed out", async () => {
  const root = { id: "root-3", kind: "root", status: "running", startedAt: "2026-10-20T12:00:00.000Z" };
  const alreadyMarked = { id: "worker-3", kind: "subtask", status: "failed", startedAt: "2026-10-20T12:00:00.000Z", watchdogFailedAt: "2026-10-20T12:00:05.000Z" };
  let transitions = 0;
  await runWorkerWatchdogPass({
    tasks: new Map([[root.id, root], [alreadyMarked.id, alreadyMarked]]),
    nowMs: Date.parse("2026-10-20T12:00:10.000Z"),
    timeoutMs: 1000,
    transitionTask: async () => { transitions += 1; },
    emit: () => {},
    recoverFailedWorker: async () => {}
  });
  assert.equal(transitions, 0);
});
