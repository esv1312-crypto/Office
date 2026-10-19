import test from "node:test";
import assert from "node:assert/strict";
import {
  initDatabase,
  saveTaskSnapshot,
  saveTaskSnapshots,
  saveEvent,
  loadDatabaseState,
  closeDatabase
} from "../src/database.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL integration: task snapshots persist, batches roll back atomically, and events reload by event time", {
  skip: !testDatabaseUrl
}, async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
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
      { id: `${tag}-child`, task: "integration child", status: "waiting", parentTaskId: `${tag}-root` }
    ];
    await saveTaskSnapshots(persisted);
    await saveTaskSnapshot({ id: `${tag}-single`, task: "single snapshot", status: "completed" });

    await saveEvent("integration.older", { taskId: `${tag}-root`, ts: "2026-01-01T00:00:00.000Z", marker: tag });
    await saveEvent("integration.newer", { taskId: `${tag}-root`, ts: "2026-01-02T00:00:00.000Z", marker: tag });

    state = await loadDatabaseState();
    const ids = new Set(state.tasks.map(task => task.id));
    assert.ok(ids.has(`${tag}-root`));
    assert.ok(ids.has(`${tag}-child`));
    assert.ok(ids.has(`${tag}-single`));
    assert.equal(ids.has(rolledBackId), false);

    const orderedEvents = state.events.filter(event => event.marker === tag).map(event => event.type);
    assert.deepEqual(orderedEvents, ["integration.older", "integration.newer"]);
  } finally {
    await closeDatabase();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
