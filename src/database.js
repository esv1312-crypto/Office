import pg from "pg";
const { Pool } = pg;

let pool = null;
let dbReady = false;
let writeTail = Promise.resolve();

function enqueueWrite(work) {
  const pending = writeTail.then(work, work);
  writeTail = pending.catch(() => {});
  return pending;
}

export async function flushDatabaseWrites() {
  await writeTail;
}

export async function closeDatabase() {
  await flushDatabaseWrites();
  if (pool) {
    const current = pool;
    pool = null;
    dbReady = false;
    await current.end();
  }
}

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
    CREATE INDEX IF NOT EXISTS ai_office_events_created_idx ON ai_office_events(created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS ai_office_resources (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'discovered',
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  dbReady = true;
  return true;
}

export async function loadDatabaseState() {
  if (!dbReady) return {tasks:[], events:[]};
  const [tasks, events, resources] = await Promise.all([
    pool.query("SELECT id,parent_task_id,payload FROM ai_office_tasks ORDER BY updated_at ASC"),
    pool.query("SELECT task_id,event_type,payload,created_at FROM ai_office_events ORDER BY created_at DESC,id DESC LIMIT 500"),
    pool.query("SELECT id,status,payload FROM ai_office_resources ORDER BY updated_at DESC")
  ]);
  return {
    tasks: tasks.rows.map(r => r.payload),
    events: events.rows.reverse().map(r => ({type:r.event_type,...r.payload,createdAt:r.created_at})),
    resources: resources.rows.map(r => r.payload)
  };
}

export async function saveTaskSnapshot(snapshot) {
  if (!dbReady) return;
  return enqueueWrite(() => pool.query(
    "INSERT INTO ai_office_tasks(id,parent_task_id,payload,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(id) DO UPDATE SET parent_task_id=EXCLUDED.parent_task_id,payload=EXCLUDED.payload,updated_at=NOW()",
    [snapshot.id, snapshot.parentTaskId || null, snapshot]
  ));
}

export async function saveEvent(type, payload) {
  if (!dbReady) return;
  const eventTime=payload?.ts || payload?.createdAt || new Date().toISOString();
  return enqueueWrite(async () => {
    await pool.query(
      "INSERT INTO ai_office_events(task_id,event_type,payload,created_at) VALUES($1,$2,$3,$4)",
      [payload?.taskId || null, type, payload || {}, eventTime]
    );
    await pool.query("DELETE FROM ai_office_events WHERE id IN (SELECT id FROM ai_office_events ORDER BY created_at DESC,id DESC OFFSET 500)");
  });
}

export function databaseStatus() {
  return {enabled:databaseEnabled(),ready:dbReady};
}

export async function saveResourceSnapshot(resource) {
  if (!dbReady || !resource?.id) return;
  return enqueueWrite(() => pool.query(
    "INSERT INTO ai_office_resources(id,status,payload,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload,updated_at=NOW()",
    [String(resource.id), String(resource.status || "discovered"), resource]
  ));
}
