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
  assert.match(rootExecution, /await saveTaskSnapshots\(\[taskSnapshot\(record\),\.\.\.children\.map\(taskSnapshot\)\]\)/);
  assert.match(rootExecution, /const previousSubtaskIds=\[\.\.\.record\.subtaskIds\]/);
  assert.match(rootExecution, /record\.subtaskIds=previousSubtaskIds/);
  assert.ok(rootExecution.indexOf("await saveTaskSnapshots([taskSnapshot(record),...children.map(taskSnapshot)])") < rootExecution.indexOf('emit("task.accepted"'));
  assert.ok(rootExecution.indexOf("await saveTaskSnapshots(children.map(taskSnapshot))") < rootExecution.indexOf("Promise.all(children.map(child=>executeWorkerTask(child)))"));

  const replacementStart = server.indexOf("async function performWorkerRecovery");
  const replacementEnd = server.indexOf("\nasync function", replacementStart + 10);
  const replacement = server.slice(replacementStart, replacementEnd);
  assert.match(replacement, /await saveTaskSnapshot\(taskSnapshot\(replacement\)\)/);
  assert.ok(replacement.indexOf("await saveTaskSnapshot(taskSnapshot(replacement))") < replacement.indexOf("await executeWorkerTask(replacement)"));

  const recoveryTask = server.indexOf("await saveTaskSnapshots([taskSnapshot(record),taskSnapshot(fixTask)])");
  assert.ok(recoveryTask > 0, "root recovery must persist the parent link and recovery task atomically");
  assert.ok(recoveryTask < server.indexOf('emit("recovery.requested"', recoveryTask));
  const rootRecoveryStart = server.indexOf("async function recoverRootTask(record)");
  const rootRecoveryEnd = server.indexOf("async function executeRootTask(record)", rootRecoveryStart);
  const rootRecovery = server.slice(rootRecoveryStart, rootRecoveryEnd);
  assert.match(rootRecovery, /await transitionTask\(fixTask,"waiting",\{waitingReason:"ai_not_configured"\}\)/);
});


test("provider fallback smoke test does not mutate process-wide model configuration", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = server.indexOf('app.get("/api/smoke/fallback"');
  const end = server.indexOf('app.get("/api/smoke/recovery"', start);
  const route = server.slice(start, end);
  assert.doesNotMatch(route, /process\.env\.(AI_PROVIDER_ORDER|GEMINI_MODELS)\s*=/);
  assert.match(route, /geminiModels:\["definitely-nonexistent-ai-office-test-model"\]/);
  assert.match(route, /const ok=observed\.geminiFailure&&observed\.providerFallback&&observed\.huggingfaceSuccess/);
  assert.match(route, /res\.status\(ok\?200:503\)/);
  assert.match(server, /async function generateWithGemini\(task, preferredModel, configuredOverride = null\)/);
  assert.match(server, /generateWithGemini\(task,model,overrides\.geminiModels \|\| null\)/);
});


test("watchdog persists its failure marker atomically with the failed transition", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = server.indexOf("async function runWorkerWatchdog()");
  const end = server.indexOf("\nasync function transitionTask", start);
  const watchdog = server.slice(start, end);
  assert.match(watchdog, /await transitionTask\(record,"failed",\{error:"WORKER_WATCHDOG_TIMEOUT",failedAt:watchdogFailedAt,watchdogFailedAt\}\)/);
  assert.doesNotMatch(watchdog, /record\.watchdogFailedAt\s*=/);
  assert.match(watchdog, /recoverFailedWorker\(parent,record\)\.catch\(/);
});


test("root task cannot transition to completed unless the persisted verifier record passes every check", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const rootStart = server.indexOf("async function executeRootTask(record)");
  const rootEnd = server.indexOf("\nasync function", rootStart + 10);
  assert.ok(rootStart >= 0 && rootEnd > rootStart, "root execution function must be found");
  const root = server.slice(rootStart, rootEnd);
  const initialVerification = root.indexOf("let verificationPassed=await verifyRootTask(record)");
  const completionGate = root.indexOf("if(!isVerificationCompletionEligible(record.verification))");
  const completedTransition = root.indexOf('await transitionTask(record,"completed"');
  assert.ok(initialVerification >= 0, "root execution must call the independent verifier");
  assert.ok(completionGate > initialVerification, "completion gate must follow verification");
  assert.ok(completedTransition > completionGate, "completion gate must precede completed transition");
  assert.match(root, /if\(!verificationPassed\)[\s\S]*?await recoverRootTask\(record\)/);
  assert.match(server, /export function isVerificationCompletionEligible\(verification\)/);
});
