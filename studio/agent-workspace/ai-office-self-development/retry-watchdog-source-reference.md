# Verified source bundle — retry / watchdog / task-state

Purpose: bounded, read-only diagnosis by AI Office specialists. This file is a verbatim snapshot of production source/test files from `studio-v1-foundation` at the recorded blob SHAs. It is not permission to edit production or deploy.

## Runtime worker limits (studio/server.js excerpt)
Source blob SHA: f43e39ebfcb4f5332d755ddc123d1760b585b331
```js
217:     max: positiveIntegerEnv("STUDIO_RATE_LIMIT_PER_MINUTE", 60, 600),
218:   }),
219:   artifactWriter,
220:   workerTools: githubWorkspaceTools,
221:   createSpecialistsForProfile,
222:   workerConcurrency: positiveIntegerEnv("STUDIO_WORKER_CONCURRENCY", 2, 8),
223:   modelTimeoutMs: positiveIntegerEnv("STUDIO_WORKER_MODEL_TIMEOUT_MS", 300000, 600000),
224:   modelBudget,
225:   // A normal task should finish in a handful of tool rounds. Large jobs must
226:   // be decomposed by the Director instead of being allowed to consume a huge loop.
227:   maxToolRounds: positiveIntegerEnv("STUDIO_MAX_TOOL_ROUNDS", 8, 20),
228:   maxToolCalls: positiveIntegerEnv("STUDIO_MAX_TOOL_CALLS", 16, 40),
229: });
230: 
231: const launchSelfDevelopment = createSelfDevelopmentLaunchHandler({
```

## src/provider-retry-policy.js
Production branch: studio-v1-foundation
Blob SHA: 7e998b3f4dd9ccae98efcec57adbb2313a17507a
```js
export function shouldStopOpenRouterFallback(status) {
  // Authentication failures invalidate the shared credential. HTTP 402/429 can be
  // route/model-specific on free aggregators, so try the next candidate before
  // suppressing the entire provider.
  return Number(status) === 401;
}

export function shouldSuppressProviderForStatus(provider, status) {
  const name=String(provider || "").trim().toLowerCase();
  const code=Number(status);
  // OpenRouter serves many independently metered free routes behind one API key.
  // A model-specific 402/429 must cool down that model, not disable every model.
  if(name === "openrouter" && (code === 402 || code === 429)) return false;
  // A 401 indicates the shared provider credential is rejected.
  return code === 401 || code === 402 || code === 429;
}

export function providerCooldownMs(provider, status, message = "") {
  const name=String(provider || "").trim().toLowerCase();
  const code=Number(status);
  const text=String(message || "");
  // Gemini free-tier quota errors can include a reset many hours away.
  // A 60-second cooldown just replays the same doomed request on every task.
  if(name === "gemini" && (code === 429 || /quota exceeded|rate.?limit|resource.?exhausted/i.test(text))) {
    return 12 * 60 * 60 * 1000;
  }
  return code === 429 ? 60 * 1000 : 15 * 60 * 1000;
}

export function modelCooldownMs(status, message = "") {
  const code=Number(status);
  const text=String(message || "");
  // Explicit route-policy denials and stale free slugs will not heal after a short retry.
  if(code===403 && /only available on agentic harnesses|not available to this application|not permitted/i.test(text)) return 6*60*60*1000;
  if(code===404 || /model.*(not found|does not exist|unavailable for free)|unknown model|invalid model/i.test(text)) return 6*60*60*1000;
  // Bad-request route failures should not be retried on every task; retain a bounded cooldown.
  if(code===400) return 15*60*1000;
  if(/empty response/i.test(text)) return 60*1000;
  if(code===408 || (code>=500 && code<=599)) return 2*60*1000;
  return code===429 ? 60*1000 : 15*60*1000;
}

```

## src/worker-watchdog.js
Production branch: studio-v1-foundation
Blob SHA: ccd77d26d7302971c1d6e5bef23d8aae7e175fd8
```js
import { getWatchdogTimeoutAge } from "./task-state.js";

export async function runWorkerWatchdogPass({
  tasks,
  nowMs = Date.now(),
  timeoutMs,
  transitionTask,
  emit,
  recoverFailedWorker,
  onRecoveryError = () => {}
}) {
  for (const record of tasks.values()) {
    const age = getWatchdogTimeoutAge(record, nowMs, timeoutMs);
    if (age === null) continue;

    const watchdogFailedAt = new Date(nowMs).toISOString();
    await transitionTask(record, "failed", {
      error: "WORKER_WATCHDOG_TIMEOUT",
      failedAt: watchdogFailedAt,
      watchdogFailedAt
    });
    emit("worker.watchdog_timeout", {
      taskId: record.id,
      parentTaskId: record.parentTaskId || null,
      employeeId: record.employeeId,
      ageMs: age,
      timeoutMs
    });

    const parent = record.parentTaskId ? tasks.get(record.parentTaskId) : null;
    if (parent && ["waiting", "running"].includes(parent.status)) {
      try {
        void Promise.resolve(recoverFailedWorker(parent, record)).catch(onRecoveryError);
      } catch (error) {
        onRecoveryError(error);
      }
    }
  }
}

```

## src/task-state.js
Production branch: studio-v1-foundation
Blob SHA: b3dd1e0ab7d4b6f923afab35e8ada580e4585fbc
```js
export const TASK_STATES = new Set(["accepted","planning","running","waiting","completed","failed","cancelled"]);

const ALLOWED_TRANSITIONS = Object.freeze({
  accepted: new Set(["planning","running","waiting","failed","cancelled"]),
  planning: new Set(["running","waiting","failed","cancelled"]),
  running: new Set(["waiting","completed","failed","cancelled"]),
  waiting: new Set(["planning","running","completed","failed","cancelled"]),
  completed: new Set([]),
  failed: new Set(["planning","running","cancelled"]),
  cancelled: new Set([])
});

export function assertTaskTransitionAllowed(currentStatus, nextStatus) {
  if (!TASK_STATES.has(nextStatus)) {
    throw new Error("Invalid task state: " + nextStatus);
  }
  if (currentStatus !== nextStatus && !ALLOWED_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    throw new Error("Invalid task transition: " + currentStatus + " -> " + nextStatus);
  }
  return true;
}

export async function applyPersistedTaskTransition(record, nextStatus, extra = {}, persistSnapshot) {
  if (typeof persistSnapshot !== "function") {
    throw new TypeError("persistSnapshot must be a function");
  }
  assertTaskTransitionAllowed(record.status, nextStatus);
  const previousStatus = record.status;
  const previousRecord = { ...record };
  record.status = nextStatus;
  Object.assign(record, extra);
  try {
    await persistSnapshot(record);
  } catch (error) {
    for (const key of Object.keys(record)) {
      if (!Object.prototype.hasOwnProperty.call(previousRecord, key)) delete record[key];
    }
    Object.assign(record, previousRecord);
    throw error;
  }
  return { record, previousStatus };
}

export function normalizeTaskSnapshotAfterRestart(snapshot, now = new Date().toISOString()) {
  const record = { ...snapshot };
  delete record.children;

  if (record.status === "accepted" || record.status === "planning" || record.status === "running") {
    record.status = "failed";
    record.error = "SERVICE_RESTART_INTERRUPTED";
    record.failedAt = now;
    record.startedAt = null;
    record.completedAt = null;
    record.restartInterrupted = true;
    return { record, changed: true };
  }

  if (record.status === "waiting") {
    // A parent waiting on in-flight subtasks cannot resume that in-memory work after restart.
    if (record.waitingReason === "subtasks_running") {
      record.status = "failed";
      record.error = "SERVICE_RESTART_INTERRUPTED";
      record.failedAt = now;
      record.startedAt = null;
      record.completedAt = null;
      record.restartInterrupted = true;
      record.waitingReason = null;
      return { record, changed: true };
    }

    // Configuration-blocked tasks are intentionally left waiting for an operator to fix setup.
    record.startedAt = null;
    record.waitingReason = record.waitingReason || "service_restart";
    return { record, changed: true };
  }

  return { record, changed: false };
}


export function validateSubtaskBatch(input, fallback = {}) {
  const items = Array.isArray(input) ? input : [fallback];
  if (items.length === 0) {
    return { ok: false, error: "at least one subtask is required" };
  }
  const normalized = [];
  for (const item of items) {
    const task = String(item?.task || "").trim();
    if (!task) {
      return { ok: false, error: "each subtask requires task" };
    }
    normalized.push({ ...item, task });
  }
  return { ok: true, items: normalized };
}


// Return elapsed milliseconds only when a non-root worker is eligible for watchdog failure.
// Invalid timestamps and already-processed records are deliberately ignored.
export function getWatchdogTimeoutAge(record, nowMs, timeoutMs) {
  if (!record || record.kind === "root") return null;
  if (!["running", "waiting"].includes(record.status)) return null;
  if (!record.startedAt || record.watchdogFailedAt) return null;
  const startedAtMs = Date.parse(record.startedAt);
  if (!Number.isFinite(startedAtMs)) return null;
  const ageMs = nowMs - startedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < timeoutMs) return null;
  return ageMs;
}


// Root tasks may complete only when verification explicitly passes and every check passes.
export function isVerificationCompletionEligible(verification) {
  if (!verification || verification.status !== "PASS" || !Array.isArray(verification.checks)) return false;
  return verification.checks.length > 0 && verification.checks.every(check => check && check.passed === true);
}

```

## test/provider-retry-policy.test.js
Production branch: studio-v1-foundation
Blob SHA: 8f39998362132d63bee47b47a48bbf49fdd3e9cb
```js
import test from "node:test";
import assert from "node:assert/strict";
import { shouldStopOpenRouterFallback, modelCooldownMs } from "../src/provider-retry-policy.js";

test("OpenRouter stops immediately on authentication failure", () => {
  assert.equal(shouldStopOpenRouterFallback(401), true);
});

test("OpenRouter tries alternate free models after route-level payment/rate errors", () => {
  assert.equal(shouldStopOpenRouterFallback(402), false);
  assert.equal(shouldStopOpenRouterFallback(429), false);
  assert.equal(shouldStopOpenRouterFallback(503), false);
});

import { shouldSuppressProviderForStatus } from "../src/provider-retry-policy.js";

test("OpenRouter route quota/rate errors do not suppress every model", () => {
  assert.equal(shouldSuppressProviderForStatus("openrouter", 402), false);
  assert.equal(shouldSuppressProviderForStatus("openrouter", 429), false);
  assert.equal(shouldSuppressProviderForStatus("openrouter", 401), true);
});

test("other providers retain provider-wide quota/rate suppression", () => {
  assert.equal(shouldSuppressProviderForStatus("gemini", 402), true);
  assert.equal(shouldSuppressProviderForStatus("gemini", 429), true);
  assert.equal(shouldSuppressProviderForStatus("huggingface", 401), true);
  assert.equal(shouldSuppressProviderForStatus("openrouter", 503), false);
});


test("ordinary gateway routing skips providers already under cooldown", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function generateViaLocalGateway");
  const end = source.indexOf("\nasync function generateViaGateway", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const gateway = source.slice(start, end);
  assert.match(gateway, /!Array\.isArray\(forcedProvider\)\s*&&\s*isProviderSuppressed\(provider\)/);
  assert.match(gateway, /gateway\.provider_skipped/);
  assert.match(gateway, /ALL_PROVIDERS_SUPPRESSED/);
});


test("explicitly restricted and stale free routes receive long model cooldowns", () => {
  const sixHours=6*60*60*1000;
  assert.equal(modelCooldownMs(403,"This model is only available on agentic harnesses"),sixHours);
  assert.equal(modelCooldownMs(404,"This model is unavailable for free"),sixHours);
  assert.equal(modelCooldownMs(400,"Provider returned error"),15*60*1000);
});

test("empty responses and temporary outages receive bounded short cooldowns", () => {
  assert.equal(modelCooldownMs(null,"openrouter returned an empty response"),60*1000);
  assert.equal(modelCooldownMs(503,"upstream unavailable"),2*60*1000);
  assert.equal(modelCooldownMs(429,"rate limited"),60*1000);
});

```

## test/worker-watchdog.test.js
Production branch: studio-v1-foundation
Blob SHA: 616525d318f4c9b2bb7dcc7420f27aa844648f33
```js
import test from "node:test";
import assert from "node:assert/strict";
import { runWorkerWatchdogPass } from "../src/worker-watchdog.js";

test("watchdog persists timeout before emitting and scheduling parent recovery", async () => {
  const parent = { id: "root-1", kind: "root", status: "waiting" };
  const child = {
    id: "worker-1",
    kind: "subtask",
    parentTaskId: parent.id,
    employeeId: "developer",
    status: "running",
    startedAt: "2026-10-20T12:00:00.000Z"
  };
  const tasks = new Map([[parent.id, parent], [child.id, child]]);
  const order = [];
  const recoveries = [];
  await runWorkerWatchdogPass({
    tasks,
    nowMs: Date.parse("2026-10-20T12:00:10.000Z"),
    timeoutMs: 1000,
    transitionTask: async (record, status, extra) => {
      order.push("persist");
      record.status = status;
      Object.assign(record, extra);
    },
    emit: (type, payload) => {
      order.push("emit");
      assert.equal(type, "worker.watchdog_timeout");
      assert.equal(payload.taskId, child.id);
      assert.equal(payload.ageMs, 10000);
    },
    recoverFailedWorker: async (actualParent, actualChild) => {
      order.push("recover");
      recoveries.push([actualParent.id, actualChild.id]);
    }
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(order, ["persist", "emit", "recover"]);
  assert.equal(child.status, "failed");
  assert.equal(child.error, "WORKER_WATCHDOG_TIMEOUT");
  assert.equal(child.watchdogFailedAt, "2026-10-20T12:00:10.000Z");
  assert.deepEqual(recoveries, [[parent.id, child.id]]);
});

test("watchdog does not recover a parent after the timeout transition fails to persist", async () => {
  const parent = { id: "root-2", kind: "root", status: "running" };
  const child = {
    id: "worker-2",
    kind: "subtask",
    parentTaskId: parent.id,
    status: "running",
    startedAt: "2026-10-20T12:00:00.000Z"
  };
  let emitted = false;
  let recovered = false;
  await assert.rejects(runWorkerWatchdogPass({
    tasks: new Map([[parent.id, parent], [child.id, child]]),
    nowMs: Date.parse("2026-10-20T12:00:10.000Z"),
    timeoutMs: 1000,
    transitionTask: async () => { throw new Error("database unavailable"); },
    emit: () => { emitted = true; },
    recoverFailedWorker: async () => { recovered = true; }
  }), /database unavailable/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(emitted, false);
  assert.equal(recovered, false);
});

test("watchdog skips roots and tasks already marked as timed out", async () => {
  const root = { id: "root-3", kind: "root", status: "running", startedAt: "2026-10-20T12:00:00.000Z" };
  const alreadyMarked = { id: "worker-3", kind: "subtask", status: "failed", startedAt: "2026-10-20T12:00:00.000Z", watchdogFailedAt: "2026-10-20T12:00:05.000Z" };
  let transitions = 0;
  await runWorkerWatchdogPass({
    tasks: new Map([[root.id, root], [alreadyMarked.id, alreadyMarked]]),
    nowMs: Date.parse("2026-10-20T12:00:10.000Z"),
    timeoutMs: 1000,
    transitionTask: async () => { transitions += 1; },
    emit: () => {},
    recoverFailedWorker: async () => {}
  });
  assert.equal(transitions, 0);
});

```

## test/task-state.test.js
Production branch: studio-v1-foundation
Blob SHA: 8be866f6d4d3c9bce5fee763d3c44c4c05968dbf
```js
import test from "node:test";
import assert from "node:assert/strict";
import { assertTaskTransitionAllowed, normalizeTaskSnapshotAfterRestart, validateSubtaskBatch, TASK_STATES, getWatchdogTimeoutAge, isVerificationCompletionEligible, applyPersistedTaskTransition } from "../src/task-state.js";

test("task state policy contains the expected lifecycle states", () => {
  assert.deepEqual([...TASK_STATES], ["accepted", "planning", "running", "waiting", "completed", "failed", "cancelled"]);
});

test("normal task lifecycle transitions are allowed", () => {
  assert.equal(assertTaskTransitionAllowed("accepted", "planning"), true);
  assert.equal(assertTaskTransitionAllowed("planning", "running"), true);
  assert.equal(assertTaskTransitionAllowed("running", "waiting"), true);
  assert.equal(assertTaskTransitionAllowed("waiting", "running"), true);
  assert.equal(assertTaskTransitionAllowed("waiting", "planning"), true);
  assert.equal(assertTaskTransitionAllowed("running", "completed"), true);
});

test("failed tasks can be retried or cancelled", () => {
  assert.equal(assertTaskTransitionAllowed("failed", "running"), true);
  assert.equal(assertTaskTransitionAllowed("failed", "planning"), true);
  assert.equal(assertTaskTransitionAllowed("failed", "cancelled"), true);
});

test("completed and cancelled tasks are terminal", () => {
  assert.throws(() => assertTaskTransitionAllowed("completed", "running"), /Invalid task transition/);
  assert.throws(() => assertTaskTransitionAllowed("cancelled", "running"), /Invalid task transition/);
});

test("invalid and unknown states are rejected", () => {
  assert.throws(() => assertTaskTransitionAllowed("running", "queued"), /Invalid task state/);
  assert.throws(() => assertTaskTransitionAllowed("mystery", "running"), /Invalid task transition/);
});

test("idempotent same-state updates are allowed", () => {
  for (const state of TASK_STATES) assert.equal(assertTaskTransitionAllowed(state, state), true);
});

test("accepted, planning, and running tasks are marked interrupted after restart", () => {
  for (const status of ["accepted", "planning", "running"]) {
    const { record, changed } = normalizeTaskSnapshotAfterRestart({
      id: "task-1",
      status,
      startedAt: "2026-01-01T00:00:00.000Z",
      children: [{ id: "child" }]
    }, "2026-10-19T12:00:00.000Z");

    assert.equal(changed, true);
    assert.equal(record.status, "failed");
    assert.equal(record.error, "SERVICE_RESTART_INTERRUPTED");
    assert.equal(record.failedAt, "2026-10-19T12:00:00.000Z");
    assert.equal(record.startedAt, null);
    assert.equal(record.completedAt, null);
    assert.equal(record.restartInterrupted, true);
    assert.equal("children" in record, false);
  }
});

test("configuration-blocked waiting tasks remain waiting after restart", () => {
  const { record, changed } = normalizeTaskSnapshotAfterRestart({
    id: "task-2",
    status: "waiting",
    waitingReason: "ai_not_configured",
    startedAt: "2026-01-01T00:00:00.000Z"
  }, "2026-10-19T12:00:00.000Z");

  assert.equal(changed, true);
  assert.equal(record.status, "waiting");
  assert.equal(record.startedAt, null);
  assert.equal(record.waitingReason, "ai_not_configured");
});

test("parent tasks waiting on in-memory subtasks fail clearly after restart", () => {
  const { record, changed } = normalizeTaskSnapshotAfterRestart({
    id: "task-parent",
    status: "waiting",
    waitingReason: "subtasks_running",
    startedAt: "2026-10-19T11:59:00.000Z",
    subtaskIds: ["task-child"]
  }, "2026-10-19T12:00:00.000Z");

  assert.equal(changed, true);
  assert.equal(record.status, "failed");
  assert.equal(record.error, "SERVICE_RESTART_INTERRUPTED");
  assert.equal(record.failedAt, "2026-10-19T12:00:00.000Z");
  assert.equal(record.startedAt, null);
  assert.equal(record.completedAt, null);
  assert.equal(record.restartInterrupted, true);
  assert.equal(record.waitingReason, null);
});

test("terminal tasks are not rewritten during restart normalization", () => {
  const { record, changed } = normalizeTaskSnapshotAfterRestart({
    id: "task-3",
    status: "completed",
    completedAt: "2026-10-18T12:00:00.000Z"
  });

  assert.equal(changed, false);
  assert.equal(record.status, "completed");
  assert.equal(record.completedAt, "2026-10-18T12:00:00.000Z");
});


test("subtask batch validation is atomic and rejects empty or malformed batches before creation", () => {
  assert.deepEqual(validateSubtaskBatch([{task:"first"},{task:"second"}]), {
    ok:true,
    items:[{task:"first"},{task:"second"}]
  });
  assert.deepEqual(validateSubtaskBatch([{task:"first"},{task:"   "}]), {
    ok:false,
    error:"each subtask requires task"
  });
  assert.deepEqual(validateSubtaskBatch([]), {
    ok:false,
    error:"at least one subtask is required"
  });
  assert.deepEqual(validateSubtaskBatch(undefined, {task:"  single task  "}), {
    ok:true,
    items:[{task:"single task"}]
  });
});


test("watchdog eligibility is deterministic at the timeout boundary", () => {
  const record = { id: "worker-1", kind: "worker", status: "running", startedAt: "2026-10-20T12:00:00.000Z" };
  const startedAt = Date.parse(record.startedAt);
  assert.equal(getWatchdogTimeoutAge(record, startedAt + 999, 1000), null);
  assert.equal(getWatchdogTimeoutAge(record, startedAt + 1000, 1000), 1000);
  assert.equal(getWatchdogTimeoutAge(record, startedAt + 2500, 1000), 2500);
});

test("watchdog ignores root, terminal, unstarted, invalid-time, and already-marked tasks", () => {
  const now = Date.parse("2026-10-20T12:10:00.000Z");
  const base = { kind: "worker", status: "running", startedAt: "2026-10-20T12:00:00.000Z" };
  for (const record of [
    { ...base, kind: "root" },
    { ...base, status: "completed" },
    { ...base, status: "failed" },
    { ...base, startedAt: null },
    { ...base, startedAt: "not-a-date" },
    { ...base, watchdogFailedAt: "2026-10-20T12:09:00.000Z" },
  ]) assert.equal(getWatchdogTimeoutAge(record, now, 1000), null);
  assert.equal(getWatchdogTimeoutAge({ ...base, status: "waiting" }, now, 1000), 600000);
});


test("root completion requires explicit PASS and every verification check to pass", () => {
  assert.equal(isVerificationCompletionEligible(null), false);
  assert.equal(isVerificationCompletionEligible({ status: "DEGRADED", checks: [{ passed: true }] }), false);
  assert.equal(isVerificationCompletionEligible({ status: "FAIL", checks: [{ passed: true }] }), false);
  assert.equal(isVerificationCompletionEligible({ status: "PASS", checks: [] }), false);
  assert.equal(isVerificationCompletionEligible({ status: "PASS", checks: [{ passed: true }, { passed: false }] }), false);
  assert.equal(isVerificationCompletionEligible({ status: "PASS", checks: [{ passed: true }, {}] }), false);
  assert.equal(isVerificationCompletionEligible({ status: "PASS", checks: [{ passed: true }, { passed: true }] }), true);
});


test("persisted task transition rolls back all top-level changes when persistence fails", async () => {
  const record = { id: "task-1", status: "running", task: "keep this", attempts: 2 };
  await assert.rejects(
    applyPersistedTaskTransition(record, "failed", { error: "disk unavailable", failedAt: "2026-10-20T00:00:00.000Z" }, async current => {
      assert.equal(current.status, "failed");
      assert.equal(current.error, "disk unavailable");
      throw new Error("database unavailable");
    }),
    /database unavailable/
  );
  assert.deepEqual(record, { id: "task-1", status: "running", task: "keep this", attempts: 2 });
});

test("persisted task transition validates state before writing and returns the previous state", async () => {
  const record = { id: "task-2", status: "running" };
  let writes = 0;
  const result = await applyPersistedTaskTransition(record, "completed", { result: "verified" }, async current => {
    writes += 1;
    assert.equal(current.status, "completed");
  });
  assert.equal(result.previousStatus, "running");
  assert.equal(result.record, record);
  assert.equal(record.status, "completed");
  assert.equal(writes, 1);

  await assert.rejects(applyPersistedTaskTransition(record, "accepted", {}, async () => {
    writes += 1;
  }), /Invalid task transition/);
  assert.equal(writes, 1, "invalid transitions must not be persisted");
});

```
