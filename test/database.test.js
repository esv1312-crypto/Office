import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("PostgreSQL event history is ordered and retained by event time", async () => {
  const source = await readFile(new URL("../src/database.js", import.meta.url), "utf8");
  assert.match(source, /ORDER BY created_at DESC,id DESC LIMIT 500/);
  assert.match(source, /const eventTime=payload\?\.ts \|\| payload\?\.createdAt \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(source, /INSERT INTO ai_office_events\(task_id,event_type,payload,created_at\)/);
  assert.match(source, /DELETE FROM ai_office_events WHERE id IN \(SELECT id FROM ai_office_events ORDER BY created_at DESC,id DESC OFFSET 500\)/);
});

test("database writes are serialized and drained on graceful shutdown", async () => {
  const database = await readFile(new URL("../src/database.js", import.meta.url), "utf8");
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(database, /let writeTail = Promise\.resolve\(\)/);
  assert.match(database, /function enqueueWrite\(work\)/);
  assert.match(database, /export async function flushDatabaseWrites\(\)/);
  assert.match(database, /export async function closeDatabase\(\)/);
  assert.match(server, /process\.once\("SIGTERM"/);
  assert.match(server, /process\.once\("SIGINT"/);
  assert.match(server, /await closeDatabase\(\)/);
});


test("configured PostgreSQL failure prevents degraded startup without persistence", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /databaseEnabled\(\)/);
  assert.match(server, /DATABASE_STARTUP_FAILED: DATABASE_URL is configured but persistence could not be initialized/);
  assert.doesNotMatch(server, /initialization failed; continuing without persistence/);
});


test("task API acknowledges acceptance only after the initial snapshot is persisted", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = server.indexOf('app.post("/api/tasks"');
  const end = server.indexOf('\napp.post("/api/tasks/:id/subtasks"', start);
  const route = server.slice(start, end);
  assert.match(route, /app\.post\("\/api\/tasks", async/);
  assert.match(route, /await saveTaskSnapshot\(taskSnapshot\(record\)\)/);
  assert.ok(route.indexOf("await saveTaskSnapshot") < route.indexOf('emit("task.accepted"'));
  assert.ok(route.indexOf("await saveTaskSnapshot") < route.indexOf("void executeRootTask(record)"));
  assert.match(route, /status\(503\).*task could not be durably accepted/);
});
