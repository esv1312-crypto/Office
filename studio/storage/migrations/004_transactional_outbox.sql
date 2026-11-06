-- Transactional outbox for reliable event delivery.
-- Apply only after migrations 001-003 to a dedicated Studio database.
-- This migration is intentionally not auto-applied by application startup.

CREATE TABLE IF NOT EXISTS studio.outbox_events (
  event_id TEXT PRIMARY KEY,
  organization_id TEXT,
  project_id TEXT,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  correlation_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lock_token TEXT,
  locked_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((lock_token IS NULL) = (locked_until IS NULL)),
  CHECK (published_at IS NULL OR locked_until IS NULL)
);

-- Workers should claim the oldest due, unpublished events without blocking
-- one another; the dispatcher will use FOR UPDATE SKIP LOCKED.
CREATE INDEX IF NOT EXISTS studio_outbox_pending_idx
  ON studio.outbox_events(available_at, occurred_at)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS studio_outbox_aggregate_idx
  ON studio.outbox_events(aggregate_type, aggregate_id, occurred_at);

CREATE INDEX IF NOT EXISTS studio_outbox_correlation_idx
  ON studio.outbox_events(correlation_id)
  WHERE correlation_id IS NOT NULL;
