-- Independent QA review records. Apply after migrations 001 and 002.
CREATE TABLE IF NOT EXISTS studio.qa_reviews (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES studio.tasks(id),
  artifact_id TEXT NOT NULL REFERENCES studio.artifacts(id),
  reviewer_specialist_id TEXT NOT NULL REFERENCES studio.specialists(id),
  producer_specialist_id TEXT NOT NULL REFERENCES studio.specialists(id),
  verdict TEXT NOT NULL CHECK (verdict IN ('accepted', 'revision_required')),
  findings JSONB NOT NULL,
  model_snapshot JSONB NOT NULL,
  actor_id TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL,
  CHECK (reviewer_specialist_id <> producer_specialist_id)
);
CREATE INDEX IF NOT EXISTS studio_qa_reviews_task_idx
  ON studio.qa_reviews(task_id, reviewed_at DESC);
