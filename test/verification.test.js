import test from "node:test";
import assert from "node:assert/strict";
import { enforceVerificationEvidence } from "../src/verification.js";

test("verification passes only when every checklist item has grounded evidence", () => {
  const result = enforceVerificationEvidence({
    status: "PASS",
    summary: "All checks passed.",
    checks: [{
      name: "API route exists",
      requirement: "Confirm the health route exists",
      passed: true,
      evidence: "The route is registered in the server.",
      classification: "FACT",
      source: "src/server.js",
      locator: "app.get('/health')"
    }]
  }, ["Confirm the health route exists"]);

  assert.equal(result.status, "PASS");
  assert.equal(result.checks[0].passed, true);
});

test("descriptive line locators are grounded against the exact source line", () => {
  const result = enforceVerificationEvidence({
    status: "PASS",
    summary: "The source line supports the claim.",
    checks: [{
      name: "Launch gate is GREEN",
      requirement: "Confirm the launch gate name",
      passed: true,
      evidence: "The supplied source line names the launch gate as GREEN.",
      classification: "FACT",
      source: "test/source.txt",
      locator: "Line beginning FACT A: The launch gate is called GREEN."
    }]
  }, ["Confirm the launch gate name"]);

  assert.equal(result.status, "PASS");
  assert.equal(result.checks[0].referenceGrounded, true);
});

test("claimed PASS fails closed when source or locator is missing", () => {
  const result = enforceVerificationEvidence({
    status: "PASS",
    summary: "Looks good.",
    checks: [{
      name: "Browser works",
      requirement: "Verify browser execution",
      passed: true,
      evidence: "The model said it worked.",
      classification: "FACT"
    }]
  }, ["Verify browser execution"]);

  assert.equal(result.status, "FAIL");
  assert.equal(result.checks[0].passed, false);
  assert.match(result.summary, /Evidence validation failed/);
});

test("assumptions and unproven claims cannot satisfy a passing check", () => {
  const result = enforceVerificationEvidence({
    status: "PASS",
    checks: [{
      name: "External browser configured",
      requirement: "Confirm browser configuration",
      passed: true,
      evidence: "No runtime test was performed.",
      classification: "UNPROVEN",
      source: "runtime diagnostics",
      locator: "browser.summary"
    }]
  }, ["Confirm browser configuration"]);

  assert.equal(result.status, "FAIL");
  assert.equal(result.checks[0].passed, false);
});

test("verification fails when the verifier omits checklist coverage", () => {
  const result = enforceVerificationEvidence({
    status: "PASS",
    summary: "One check passed.",
    checks: [{
      name: "First requirement",
      requirement: "First requirement",
      passed: true,
      evidence: "The first requirement is present.",
      classification: "FACT",
      source: "README.md",
      locator: "## First requirement"
    }]
  }, ["First requirement", "Second requirement"]);

  assert.equal(result.status, "FAIL");
  assert.equal(result.checks.length, 2);
  assert.equal(result.checks[1].name, "Checklist coverage");
  assert.equal(result.checks[1].passed, false);
});

test("duplicate checks cannot satisfy different checklist items", () => {
  const result = enforceVerificationEvidence({
    status: "PASS",
    checks: [
      {
        name: "First item",
        requirement: "first item",
        passed: true,
        evidence: "First item is present.",
        classification: "FACT",
        source: "README.md",
        locator: "## First item"
      },
      {
        name: "Repeated first item",
        requirement: " first   item ",
        passed: true,
        evidence: "Repeated claim about the first item.",
        classification: "FACT",
        source: "README.md",
        locator: "## First item"
      }
    ]
  }, ["first item", "second item"]);

  assert.equal(result.status, "FAIL");
  assert.equal(result.checks[1].passed, false);
  assert.match(result.checks[1].evidence, /Duplicate coverage/);
  assert.ok(result.checks.some(check => check.name === "Checklist coverage" && check.requirement === "second item"));
});

test("checks that do not map to a required checklist item cannot pass", () => {
  const result = enforceVerificationEvidence({
    status: "PASS",
    checks: [{
      name: "Unrelated check",
      requirement: "Something else",
      passed: true,
      evidence: "Some evidence.",
      classification: "FACT",
      source: "README.md",
      locator: "## Introduction"
    }]
  }, ["Required item"]);

  assert.equal(result.status, "FAIL");
  assert.equal(result.checks[0].passed, false);
  assert.ok(result.checks.some(check => check.name === "Checklist coverage"));
});

test("a verifier's explicit FAIL is never upgraded to PASS", () => {
  const result = enforceVerificationEvidence({
    status: "FAIL",
    checks: [{
      name: "Missing test",
      requirement: "Run the test",
      passed: false,
      evidence: "No test result was supplied.",
      classification: "UNPROVEN",
      source: "runtime evidence",
      locator: "test result"
    }]
  }, ["Run the test"]);

  assert.equal(result.status, "FAIL");
});


test("a passing verifier claim is rejected when authoritative runtime status says failed", () => {
  const taskId = "07f6ac84-2f21-428a-befb-989fefe27d95";
  const result = enforceVerificationEvidence({
    status: "PASS",
    checks: [{
      name: "Task completed",
      requirement: "Confirm task completed",
      passed: true,
      evidence: "The task completed successfully.",
      classification: "FACT",
      source: "runtime events",
      locator: "task.state_changed taskId " + taskId
    }]
  }, ["Confirm task completed"], {
    eventEvidence: [{
      type: "task.state_changed",
      taskId,
      status: "failed",
      ts: "2026-10-20T10:00:00.000Z"
    }]
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.checks[0].passed, false);
  assert.match(result.checks[0].evidence, /authoritative runtime status.*failed/i);
});

test("a claim that all workers completed is rejected when a worker remains failed", () => {
  const result = enforceVerificationEvidence({
    status: "PASS",
    checks: [{
      name: "All four worker roles completed their assigned subtasks",
      requirement: "All four worker roles completed their assigned subtasks",
      passed: true,
      evidence: "Runtime records show the worker outcomes.",
      classification: "FACT",
      source: "runtime events",
      locator: "task.state_changed"
    }]
  }, ["All four worker roles completed their assigned subtasks"], {
    workerResults: [
      { taskId: "worker-1", employeeId: "analyst", status: "completed" },
      { taskId: "worker-2", employeeId: "developer", status: "failed" }
    ],
    eventEvidence: [{ type: "task.state_changed", taskId: "worker-1", status: "completed" }]
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.checks[0].passed, false);
  assert.match(result.checks[0].evidence, /all workers completed conflicts/i);
});

test("grounds citations against source documents supplied inline in the task dossier", () => {
  const task = [
    "Use the supplied source dossier:",
    "===== test/source.txt =====",
    "FACT A: The launch gate is called GREEN.",
    "FACT B: The required owner is STAS.",
    "===== test/config.txt =====",
    "FACT C: The retry limit is 2."
  ].join("\n");
  const result = enforceVerificationEvidence({
    status: "PASS",
    summary: "All supplied dossier facts are grounded.",
    checks: [
      {
        name: "Launch gate is GREEN",
        requirement: "Confirm the launch gate name",
        passed: true,
        evidence: "The supplied source states the launch gate is GREEN.",
        classification: "FACT",
        source: "test/source.txt",
        locator: "Line beginning FACT A: The launch gate is called GREEN."
      },
      {
        name: "Retry limit is 2",
        requirement: "Confirm the retry limit",
        passed: true,
        evidence: "The supplied config states the retry limit is 2.",
        classification: "FACT",
        source: "test/config.txt",
        locator: "FACT C: The retry limit is 2."
      }
    ]
  }, ["Confirm the launch gate name", "Confirm the retry limit"], { task });

  assert.equal(result.status, "PASS");
  assert.equal(result.checks.every(check => check.referenceGrounded), true);
});
