import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanningTaskBrief, buildWorkerTaskContext, buildRoleScopedWorkerContext, MAX_WORKER_CONTEXT_CHARS } from "../src/task-context.js";

test("planning brief keeps task instructions and replaces a large inline dossier with its file index", () => {
  const task = ["Audit this project read-only.","Use analyst, developer, verifier, and executor.","SOURCE DOSSIER:","===== README.md =====","x".repeat(50000),"===== src/server.js =====","y".repeat(50000)].join("\n");
  const brief = buildPlanningTaskBrief(task);
  assert.match(brief, /Audit this project read-only/);
  assert.match(brief, /Use analyst, developer, verifier, and executor/);
  assert.match(brief, /README\.md/);
  assert.match(brief, /src\/server\.js/);
  assert.match(brief, /Dossier size:/);
  assert.ok(brief.length < 12000);
  assert.ok(!brief.includes("x".repeat(1000)));
});

test("planning brief leaves normal short tasks unchanged", () => {
  const task = "Summarize the current release risks in three bullets.";
  assert.equal(buildPlanningTaskBrief(task), task);
});

test("planning brief bounds long tasks without an explicit dossier marker", () => {
  const task = "Task instructions. " + "z".repeat(20000);
  const brief = buildPlanningTaskBrief(task, 4000);
  assert.equal(brief.length, 4000 + "\n[PLANNING CONTEXT TRUNCATED BY RUNTIME; full task remains attached to parent task.]".length);
  assert.match(brief, /PLANNING CONTEXT TRUNCATED BY RUNTIME/);
});

test("worker context preserves the complete large source dossier below the expanded limit", () => {
  const task = ["Audit this project read-only.","===== src/server.js =====","a".repeat(142345),"===== src/model-scout.js =====","END_OF_DOSSIER"].join("\n");
  const context = buildWorkerTaskContext(task);
  assert.equal(context, task);
  assert.ok(context.includes("END_OF_DOSSIER"));
  assert.ok(context.length < MAX_WORKER_CONTEXT_CHARS);
});

test("worker context explicitly marks truncation above the expanded limit", () => {
  const task = "SOURCE DOSSIER " + "x".repeat(MAX_WORKER_CONTEXT_CHARS + 100);
  const context = buildWorkerTaskContext(task);
  assert.ok(context.length > MAX_WORKER_CONTEXT_CHARS);
  assert.match(context, /WORKER SOURCE CONTEXT TRUNCATED/);
  assert.match(context, new RegExp(String(task.length)));
});

test("role-scoped worker context includes only source files needed by the role", () => {
  const task = ["Audit instructions.","===== SOURCE DOSSIER =====","===== src/server.js =====","SERVER_SOURCE","===== src/model-scout.js =====","MODEL_SCOUT_SOURCE","===== src/evidence-index.js =====","EVIDENCE_SOURCE","===== RUNTIME BROWSER SNAPSHOT =====","BROWSER_SNAPSHOT"].join("\n");
  const analyst = buildRoleScopedWorkerContext(task, "analyst");
  const verifier = buildRoleScopedWorkerContext(task, "verifier");
  assert.match(analyst, /MODEL_SCOUT_SOURCE/);
  assert.doesNotMatch(analyst, /EVIDENCE_SOURCE/);
  assert.doesNotMatch(analyst, /SERVER_SOURCE/);
  assert.match(verifier, /EVIDENCE_SOURCE/);
  assert.match(verifier, /SERVER_SOURCE/);
  assert.doesNotMatch(verifier, /MODEL_SCOUT_SOURCE/);
  assert.match(analyst, /Audit instructions/);
  assert.match(verifier, /Audit instructions/);
});

test("role-scoped worker context falls back safely when dossier marker is absent", () => {
  const task = "A small task without a source dossier.";
  assert.equal(buildRoleScopedWorkerContext(task, "developer"), task);
});
