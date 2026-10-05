import pg from "pg";
const { Pool } = pg;

let pool = null;
let dbReady = false;

export function databaseEnabled() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

export async function initDatabase() {
  if (!databaseEnabled()) return false;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Math.max(2, Number(process.env.DB_POOL_MAX || 5)),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_office_tasks (
      id TEXT PRIMARY KEY,
      parent_task_id TEXT,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_office_tasks_parent_idx ON ai_office_tasks(parent_task_id);
    CREATE TABLE IF NOT EXISTS ai_office_events (
      id BIGSERIAL PRIMARY KEY,
      task_id TEXT,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_office_events_task_idx ON ai_office_events(task_id, id);
  `);
  dbReady = true;
  return true;
}

export async function loadDatabaseState() {
  if (!dbReady) return {tasks:[], events:[]};
  const [tasks, events] = await Promise.all([
    pool.query("SELECT id,parent_task_id,payload FROM ai_office_tasks ORDER BY updated_at ASC"),
    pool.query("SELECT task_id,event_type,payload,created_at FROM ai_office_events ORDER BY id DESC LIMIT 500")
  ]);
  return {
    tasks: tasks.rows.map(r => r.payload),
    events: events.rows.reverse().map(r => ({type:r.event_type,...r.payload,createdAt:r.created_at}))
  };
}

export async function saveTaskSnapshot(snapshot) {
  if (!dbReady) return;
  await pool.query(
    "INSERT INTO ai_office_tasks(id,parent_task_id,payload,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(id) DO UPDATE SET parent_task_id=EXCLUDED.parent_task_id,payload=EXCLUDED.payload,updated_at=NOW()",
    [snapshot.id, snapshot.parentTaskId || null, snapshot]
  );
}

export async function saveEvent(type, payload) {
  if (!dbReady) return;
  await pool.query(
    "INSERT INTO ai_office_events(task_id,event_type,payload) VALUES($1,$2,$3)",
    [payload?.taskId || null, type, payload || {}]
  );
  await pool.query("DELETE FROM ai_office_events WHERE id < GREATEST((SELECT COALESCE(MAX(id),0) FROM ai_office_events)-499,0)");
}

export function databaseStatus() {
  return {enabled:databaseEnabled(),ready:dbReady};
}
