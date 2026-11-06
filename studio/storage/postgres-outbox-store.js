/**
 * PostgreSQL transactional outbox adapter.
 *
 * Producers call insertOutboxEvent(client, event) using the SAME transaction
 * that writes the domain event. The dispatcher claims due rows with a lease,
 * publishes outside the transaction, then acknowledges or schedules retry.
 * Delivery is at-least-once: consumers must deduplicate by eventId.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
}
function validDate(value, field) {
  const result = required(value, field);
  if (Number.isNaN(Date.parse(result))) throw new TypeError(`${field} must be a valid timestamp`);
  return result;
}
function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer`);
  return value;
}

/** Insert an outbox row within a caller-owned database transaction. */
export async function insertOutboxEvent(client, event) {
  if (!client || typeof client.query !== "function") throw new TypeError("A transaction client is required");
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("event is required");
  const eventId = required(event.eventId, "event.eventId");
  const eventType = required(event.eventType, "event.eventType");
  const aggregateType = required(event.aggregateType, "event.aggregateType");
  const aggregateId = required(event.aggregateId, "event.aggregateId");
  const occurredAt = validDate(event.occurredAt, "event.occurredAt");
  const payload = event.payload ?? {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("event.payload must be an object");
  const schemaVersion = event.schemaVersion ?? 1;
  positiveInteger(schemaVersion, "event.schemaVersion");
  await client.query(
    `INSERT INTO studio.outbox_events
       (event_id, organization_id, project_id, aggregate_type, aggregate_id,
        event_type, payload, schema_version, correlation_id, occurred_at, available_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
    [eventId, event.organizationId || null, event.projectId || null,
      aggregateType, aggregateId, eventType, JSON.stringify(payload), schemaVersion,
      event.correlationId || null, occurredAt, validDate(event.availableAt || occurredAt, "event.availableAt")],
  );
  return { eventId };
}

export function createPostgresOutboxStore({ pool, createId, now = () => new Date().toISOString() }) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A pg-compatible pool is required");
  if (typeof createId !== "function") throw new TypeError("createId is required");
  if (typeof now !== "function") throw new TypeError("now must be a function");

  return Object.freeze({
    async claimBatch({ limit = 20, leaseMs = 30_000 } = {}) {
      positiveInteger(limit, "limit");
      positiveInteger(leaseMs, "leaseMs");
      const at = validDate(now(), "now");
      const leaseUntil = new Date(Date.parse(at) + leaseMs).toISOString();
      const client = await pool.connect();
      const lockToken = required(createId(), "generated lockToken");
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `WITH candidates AS (
             SELECT event_id
               FROM studio.outbox_events
              WHERE published_at IS NULL
                AND available_at <= $1
                AND (locked_until IS NULL OR locked_until <= $1)
              ORDER BY occurred_at, event_id
              LIMIT $2
              FOR UPDATE SKIP LOCKED
           )
           UPDATE studio.outbox_events AS outbox
              SET lock_token = $3, locked_until = $4, attempts = attempts + 1
             FROM candidates
            WHERE outbox.event_id = candidates.event_id
           RETURNING outbox.*`,
          [at, limit, lockToken, leaseUntil],
        );
        await client.query("COMMIT");
        return result.rows.map(row => ({
          eventId: row.event_id, organizationId: row.organization_id,
          projectId: row.project_id, aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id, eventType: row.event_type,
          payload: row.payload, schemaVersion: row.schema_version,
          correlationId: row.correlation_id, occurredAt: row.occurred_at,
          attempts: Number(row.attempts), lockToken,
        }));
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
      } finally { client.release(); }
    },

    async acknowledge({ eventId, lockToken, publishedAt = now() }) {
      const id = required(eventId, "eventId");
      const token = required(lockToken, "lockToken");
      const at = validDate(publishedAt, "publishedAt");
      const result = await pool.query(
        `UPDATE studio.outbox_events
            SET published_at = $3, lock_token = NULL, locked_until = NULL, last_error = NULL
          WHERE event_id = $1 AND lock_token = $2 AND published_at IS NULL
          RETURNING event_id`,
        [id, token, at],
      );
      if (!result.rowCount) throw Object.assign(new Error("Outbox lease lost or event already acknowledged"), { code: "OUTBOX_LEASE_LOST" });
      return { eventId: id, publishedAt: at };
    },

    async scheduleRetry({ eventId, lockToken, error, delayMs = 5_000 }) {
      const id = required(eventId, "eventId");
      const token = required(lockToken, "lockToken");
      positiveInteger(delayMs, "delayMs");
      const message = String(error?.message || error || "Unknown publish error").slice(0, 2000);
      const at = validDate(now(), "now");
      const availableAt = new Date(Date.parse(at) + delayMs).toISOString();
      const result = await pool.query(
        `UPDATE studio.outbox_events
            SET available_at = $3, lock_token = NULL, locked_until = NULL, last_error = $4
          WHERE event_id = $1 AND lock_token = $2 AND published_at IS NULL
          RETURNING event_id`,
        [id, token, availableAt, message],
      );
      if (!result.rowCount) throw Object.assign(new Error("Outbox lease lost; retry was not scheduled"), { code: "OUTBOX_LEASE_LOST" });
      return { eventId: id, availableAt, error: message };
    },
  });
}

/** Publish one claimed batch. Publisher receives stable event IDs for deduplication. */
export function createOutboxDispatcher({ store, publisher }) {
  if (!store || typeof store.claimBatch !== "function" ||
      typeof store.acknowledge !== "function" || typeof store.scheduleRetry !== "function") {
    throw new TypeError("A compatible outbox store is required");
  }
  if (!publisher || typeof publisher.publish !== "function") throw new TypeError("publisher.publish is required");
  return Object.freeze({
    async dispatchBatch(options = {}) {
      const events = await store.claimBatch(options);
      const results = [];
      for (const event of events) {
        try {
          await publisher.publish(event);
          await store.acknowledge({ eventId: event.eventId, lockToken: event.lockToken });
          results.push({ eventId: event.eventId, status: "published" });
        } catch (error) {
          try {
            await store.scheduleRetry({ eventId: event.eventId, lockToken: event.lockToken, error });
            results.push({ eventId: event.eventId, status: "retry_scheduled", error: String(error?.message || error) });
          } catch (retryError) {
            results.push({ eventId: event.eventId, status: "lease_lost", error: String(retryError?.message || retryError) });
          }
        }
      }
      return { claimed: events.length, results };
    },
  });
}
