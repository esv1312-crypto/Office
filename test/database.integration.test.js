import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTaskSnapshotAfterRestart } from "../src/task-state.js";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL integration: task snapshots persist, batches roll back atomically, and events reload by event time", {
  skip: !testDatabaseUrl
}, async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1));
  assert.match(databaseName, /(?:^|[_-])(test|integration)(?:$|[_-])/i,
    "TEST_DATABASE_URL must target an explicitly named test/integration database");
  const {
    initDatabase,
    saveTaskSnapshot,
    saveTaskSnapshots,
    saveEvent,
    loadDatabaseState,
    closeDatabase
  } = await import("../src/database.js");
  const tag = `integration-${process.pid}-${Date.now()}`;
  try {
    process.env.DATABASE_URL = testDatabaseUrl;
    assert.equal(await initDatabase(), true);

    const rolledBackId = `${tag}-must-rollback`;
    await assert.rejects(
      saveTaskSnapshots([
        { id: rolledBackId, task: "first row must roll back", status: "accepted" },
        { id: null, task: "invalid row forces transaction rollback", status: "accepted" }
      ])
    );
    let state = await loadDatabaseState();
    assert.equal(state.tasks.some(task => task.id === rolledBackId), false);

    const persisted = [
      { id: `${tag}-root`, task: "integration root", status: "accepted", parentTaskId: null },
      { id: `${tag}-child`, task: "integration child", status: "waiting", parentTaskId: `${tag}-root` },
      { id: `${tag}-running-worker`, task: "worker interrupted by restart", kind: "subtask", status: "running", startedAt: "2026-01-01T00:00:00.000Z" },
      { id: `${tag}-blocked-config`, task: "waiting for configuration", kind: "root", status: "waiting", waitingReason: "ai_not_configured", startedAt: "2026-01-01T00:00:00.000Z" },
      { id: `${tag}-waiting-parent`, task: "parent with in-memory work", kind: "root", status: "waiting", waitingReason: "subtasks_running", startedAt: "2026-01-01T00:00:00.000Z" }
    ];
    await saveTaskSnapshots(persisted);
    await saveTaskSnapshot({ id: `${tag}-single`, task: "single snapshot", status: "completed" });

    const beforeRestart = await loadDatabaseState();
    const restartRecords = beforeRestart.tasks
      .filter(task => [`${tag}-running-worker`, `${tag}-blocked-config`, `${tag}-waiting-parent`].includes(task.id))
      .map(task => normalizeTaskSnapshotAfterRestart(task, "2026-10-20T00:00:00.000Z"))
      .filter(result => result.changed)
      .map(result => result.record);
    assert.equal(restartRecords.length, 3);
    await saveTaskSnapshots(restartRecords);

    await saveEvent("integration.older", { taskId: `${tag}-root`, ts: "2026-01-01T00:00:00.000Z", marker: tag });
    await saveEvent("integration.newer", { taskId: `${tag}-root`, ts: "2026-01-02T00:00:00.000Z", marker: tag });

    state = await loadDatabaseState();
    const ids = new Set(state.tasks.map(task => task.id));
    assert.ok(ids.has(`${tag}-root`));
    assert.ok(ids.has(`${tag}-child`));
    assert.ok(ids.has(`${tag}-single`));
    assert.equal(ids.has(rolledBackId), false);

    const restartById = new Map(state.tasks.filter(task => task.id.startsWith(tag + "-")).map(task => [task.id, task]));
    assert.equal(restartById.get(`${tag}-running-worker`).status, "failed");
    assert.equal(restartById.get(`${tag}-running-worker`).restartInterrupted, true);
    assert.equal(restartById.get(`${tag}-blocked-config`).status, "waiting");
    assert.equal(restartById.get(`${tag}-waiting-parent`).status, "failed");
    assert.equal(restartById.get(`${tag}-waiting-parent`).restartInterrupted, true);

    const orderedEvents = state.events.filter(event => event.marker === tag).map(event => event.type);
    assert.deepEqual(orderedEvents, ["integration.older", "integration.newer"]);
  } finally {
    await closeDatabase();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
