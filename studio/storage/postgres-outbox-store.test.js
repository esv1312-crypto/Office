import test from "node:test";
import assert from "node:assert/strict";
import { insertOutboxEvent, createOutboxDispatcher } from "./postgres-outbox-store.js";

test("inserts an outbox event using the caller transaction client", async () => {
  const calls = [];
  const client = { async query(sql, values) { calls.push({ sql, values }); } };
  const result = await insertOutboxEvent(client, {
    eventId: "evt-1", eventType: "task.assigned", aggregateType: "task",
    aggregateId: "task-1", occurredAt: "2026-11-07T10:00:00.000Z",
    organizationId: "org-1", projectId: "project-1",
    payload: { specialistId: "spec-1" }, correlationId: "corr-1",
  });
  assert.deepEqual(result, { eventId: "evt-1" });
  assert.match(calls[0].sql, /INSERT INTO studio\.outbox_events/);
  assert.equal(calls[0].values[0], "evt-1");
  assert.equal(calls[0].values[6], JSON.stringify({ specialistId: "spec-1" }));
});

test("rejects malformed events before writing", async () => {
  let writes = 0;
  const client = { async query() { writes += 1; } };
  await assert.rejects(insertOutboxEvent(client, {
    eventId: "", eventType: "task.created", aggregateType: "task",
    aggregateId: "task-1", occurredAt: "2026-11-07T10:00:00.000Z",
  }), /event\.eventId is required/);
  assert.equal(writes, 0);
});

test("publishes claimed events and acknowledges them", async () => {
  const calls = [];
  const event = { eventId: "evt-1", lockToken: "lease-1", eventType: "task.assigned" };
  const store = {
    async claimBatch(options) { calls.push(["claim", options]); return [event]; },
    async acknowledge(value) { calls.push(["ack", value]); },
    async scheduleRetry(value) { calls.push(["retry", value]); },
  };
  const dispatcher = createOutboxDispatcher({
    store,
    publisher: { async publish(value) { calls.push(["publish", value]); } },
  });
  const result = await dispatcher.dispatchBatch({ limit: 5 });
  assert.equal(result.claimed, 1);
  assert.equal(result.results[0].status, "published");
  assert.equal(calls[0][0], "claim");
  assert.equal(calls[1][0], "publish");
  assert.equal(calls[2][0], "ack");
});

test("schedules retry when publisher fails", async () => {
  const calls = [];
  const store = {
    async claimBatch() { return [{ eventId: "evt-2", lockToken: "lease-2" }]; },
    async acknowledge() { throw new Error("must not acknowledge"); },
    async scheduleRetry(value) { calls.push(value); },
  };
  const dispatcher = createOutboxDispatcher({
    store,
    publisher: { async publish() { throw new Error("broker unavailable"); } },
  });
  const result = await dispatcher.dispatchBatch();
  assert.equal(result.results[0].status, "retry_scheduled");
  assert.equal(calls[0].eventId, "evt-2");
  assert.match(calls[0].error.message, /broker unavailable/);
});

test("reports a lost lease instead of acknowledging stale work", async () => {
  const store = {
    async claimBatch() { return [{ eventId: "evt-3", lockToken: "expired-lease" }]; },
    async acknowledge() { throw new Error("lease lost"); },
    async scheduleRetry() { throw Object.assign(new Error("lease lost"), { code: "OUTBOX_LEASE_LOST" }); },
  };
  const dispatcher = createOutboxDispatcher({
    store, publisher: { async publish() {} },
  });
  const result = await dispatcher.dispatchBatch();
  assert.equal(result.results[0].status, "lease_lost");
});
