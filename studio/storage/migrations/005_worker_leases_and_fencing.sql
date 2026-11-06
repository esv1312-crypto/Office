-- Worker leases and fencing tokens prevent stale workers from committing results.
-- Apply after migrations 001-004 to a dedicated Studio database only.

ALTER TABLE studio.tasks
  ADD COLUMN IF NOT EXISTS fencing_token BIGINT NOT NULL DEFAULT 0
  CHECK (fencing_token >= 0);

ALTER TABLE studio.executions
  ADD COLUMN IF NOT EXISTS fencing_token BIGINT NOT NULL DEFAULT 0
  CHECK (fencing_token >= 0),
  ADD COLUMN IF NOT EXISTS lease_token TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS studio_executions_expired_lease_idx
  ON studio.executions(lease_expires_at, started_at)
  WHERE status = 'running';
