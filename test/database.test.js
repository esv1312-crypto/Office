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


test("runtime health and authenticated state expose persistence readiness", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /status:"online",startedAt,persistence:databaseStatus\(\)/);
  assert.match(server, /workerQueue:\{active:workerQueue\.active,pending:workerQueue\.pending\.length,limit:workerQueue\.limit\},persistence:databaseStatus\(\)/);
});


test("subtask batches are persisted atomically before workers start", async () => {
  const database = await readFile(new URL("../src/database.js", import.meta.url), "utf8");
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(database, /export async function saveTaskSnapshots\(snapshots = \[\]\)/);
  assert.match(database, /await client\.query\("BEGIN"\)/);
  assert.match(database, /await client\.query\("COMMIT"\)/);
  assert.match(database, /await client\.query\("ROLLBACK"\)/);
  const start = server.indexOf('app.post("/api/tasks/:id/subtasks"');
  const end = server.indexOf('\napp.get("/api/tasks/:id"', start);
  const route = server.slice(start, end);
  assert.match(route, /await saveTaskSnapshots\(records\.map\(taskSnapshot\)\)/);
  assert.ok(route.indexOf("await saveTaskSnapshots") < route.indexOf('emit("task.accepted"'));
  assert.ok(route.indexOf("await saveTaskSnapshots") < route.indexOf("void executeWorkerTask(record)"));
  assert.match(route, /status\(503\).*subtasks could not be durably accepted/);
});


test("critical task lifecycle transitions await snapshot persistence", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /async function transitionTask\(record, nextStatus, extra = \{\}\)/);
  assert.match(server, /await saveTaskSnapshot\(taskSnapshot\(record\)\)/);
  assert.match(server, /async function runWorkerWatchdog\(\)/);
  assert.match(server, /setInterval\(\(\)=>void runWorkerWatchdog\(\)\.catch/);
  const calls = server.split("\n").filter(line => line.includes("transitionTask(") && !line.includes("function transitionTask("));
  assert.ok(calls.length >= 17, "expected lifecycle transition call sites to be covered");
  assert.ok(calls.every(line => line.includes("await transitionTask(")), "every lifecycle transition must await persistence");
});


test("internal audit and smoke task endpoints persist acceptance before starting work", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const officeAuditStart = server.indexOf("async function startOfficeAudit()");
  const officeAuditEnd = server.indexOf('app.get("/api/office-check"', officeAuditStart);
  const officeAudit = server.slice(officeAuditStart, officeAuditEnd);
  assert.match(officeAudit, /await saveTaskSnapshot\(taskSnapshot\(record\)\)/);
  assert.ok(officeAudit.indexOf("await saveTaskSnapshot") < officeAudit.indexOf('emit("office_check.started"'));
  assert.ok(officeAudit.indexOf("await saveTaskSnapshot") < officeAudit.indexOf("void executeRootTask(record)"));

  const evidenceStart = server.indexOf('app.get("/api/smoke/evidence"');
  const evidenceEnd = server.indexOf("async function runResourceScan", evidenceStart);
  const evidenceRoute = server.slice(evidenceStart, evidenceEnd);
  assert.match(evidenceRoute, /app\.get\("\/api\/smoke\/evidence", async/);
  assert.match(evidenceRoute, /await saveTaskSnapshot\(taskSnapshot\(record\)\)/);
  assert.ok(evidenceRoute.indexOf("await saveTaskSnapshot") < evidenceRoute.indexOf("void executeRootTask(record)"));

  const pognaliStart = server.indexOf('app.get("/api/pognali/audit"');
  const pognaliEnd = server.indexOf('app.post("/api/tasks"', pognaliStart);
  const pognaliRoute = server.slice(pognaliStart, pognaliEnd);
  assert.match(pognaliRoute, /await saveTaskSnapshot\(taskSnapshot\(record\)\)/);
  assert.ok(pognaliRoute.indexOf("await saveTaskSnapshot") < pognaliRoute.indexOf('emit("task.accepted"'));
  assert.ok(pognaliRoute.indexOf("await saveTaskSnapshot") < pognaliRoute.indexOf("void executeRootTask(record)"));
});


test("planned subtasks and recovery workers are persisted before execution", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const planStart = server.indexOf("async function executeRootTask(record)");
  const planEnd = server.indexOf("\nasync function", planStart + 10);
  const rootExecution = server.slice(planStart, planEnd);
  assert.match(rootExecution, /await saveTaskSnapshots\(children\.map\(taskSnapshot\)\)/);
  assert.ok(rootExecution.indexOf("await saveTaskSnapshots(children.map(taskSnapshot))") < rootExecution.indexOf('emit("task.accepted"'));
  assert.ok(rootExecution.indexOf("await saveTaskSnapshots(children.map(taskSnapshot))") < rootExecution.indexOf("Promise.all(children.map(child=>executeWorkerTask(child)))"));

  const replacementStart = server.indexOf("async function performWorkerRecovery");
  const replacementEnd = server.indexOf("\nasync function", replacementStart + 10);
  const replacement = server.slice(replacementStart, replacementEnd);
  assert.match(replacement, /await saveTaskSnapshot\(taskSnapshot\(replacement\)\)/);
  assert.ok(replacement.indexOf("await saveTaskSnapshot(taskSnapshot(replacement))") < replacement.indexOf("await executeWorkerTask(replacement)"));

  const recoveryTask = server.indexOf("await saveTaskSnapshots([taskSnapshot(record),taskSnapshot(fixTask)])");
  assert.ok(recoveryTask > 0, "root recovery must persist the parent link and recovery task atomically");
  assert.ok(recoveryTask < server.indexOf('emit("recovery.requested"', recoveryTask));
});
