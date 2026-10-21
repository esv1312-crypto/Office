import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanningTaskBrief } from "../src/task-context.js";

test("planning brief keeps task instructions and replaces a large inline dossier with its file index", () => {
  const task = [
    "Audit this project read-only.",
    "Use analyst, developer, verifier, and executor.",
    "SOURCE DOSSIER:",
    "===== README.md =====",
    "x".repeat(50000),
    "===== src/server.js =====",
    "y".repeat(50000)
  ].join("\n");

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
