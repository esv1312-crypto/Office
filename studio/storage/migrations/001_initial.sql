-- Universal AI Studio isolated schema.
-- Apply only to a dedicated Studio database/schema after owner approval.
-- This migration is intentionally not wired to the legacy Office startup.

CREATE SCHEMA IF NOT EXISTS studio;

CREATE TABLE IF NOT EXISTS studio.projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  product_profile_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'archived')),
  version INTEGER NOT NULL CHECK (version >= 1),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS studio.specialists (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'archived')),
  version INTEGER NOT NULL CHECK (version >= 1),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS studio.tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES studio.projects(id),
  status TEXT NOT NULL CHECK (status IN (
    'draft', 'planned', 'ready', 'assigned', 'running', 'qa',
    'completed', 'failed', 'cancelled'
  )),
  assignee_specialist_id TEXT REFERENCES studio.specialists(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS studio_tasks_project_status_idx
  ON studio.tasks(project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS studio_tasks_assignee_status_idx
  ON studio.tasks(assignee_specialist_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS studio.executions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES studio.tasks(id),
  specialist_id TEXT NOT NULL REFERENCES studio.specialists(id),
  worker_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'qa', 'failed')),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  output TEXT,
  model_snapshot JSONB,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS studio_executions_task_idx
  ON studio.executions(task_id, started_at DESC);

CREATE TABLE IF NOT EXISTS studio.artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES studio.tasks(id),
  execution_id TEXT NOT NULL REFERENCES studio.executions(id),
  artifact_type TEXT NOT NULL,
  name TEXT NOT NULL,
  content JSONB NOT NULL,
  created_by_worker_id TEXT NOT NULL,
  specialist_id TEXT NOT NULL REFERENCES studio.specialists(id),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (execution_id)
);

CREATE INDEX IF NOT EXISTS studio_artifacts_task_idx
  ON studio.artifacts(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS studio.events (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  project_id TEXT,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS studio_events_aggregate_idx
  ON studio.events(aggregate_type, aggregate_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS studio_events_project_idx
  ON studio.events(project_id, occurred_at DESC);
