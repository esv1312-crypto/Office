-- Director planning records. Apply only after migration 001 to a dedicated Studio database.
CREATE TABLE IF NOT EXISTS studio.plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES studio.projects(id),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'superseded')),
  version INTEGER NOT NULL CHECK (version >= 1),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE studio.tasks
  ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES studio.plans(id);

CREATE INDEX IF NOT EXISTS studio_plans_project_status_idx
  ON studio.plans(project_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS studio_tasks_plan_idx
  ON studio.tasks(plan_id, status);
