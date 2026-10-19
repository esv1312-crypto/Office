import test from "node:test";
import assert from "node:assert/strict";
import { enforceVerificationEvidence } from "../src/verification.js";

test("verification passes only when every check has grounded evidence", () => {
  const result = enforceVerificationEvidence({
    status: "PASS",
    summary: "All checks passed.",
    checks: [{
      name: "API route exists",
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

test("claimed PASS fails closed when source or locator is missing", () => {
  const result = enforceVerificationEvidence({
    status: "PASS",
    summary: "Looks good.",
    checks: [{
      name: "Browser works",
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

test("a verifier's explicit FAIL is never upgraded to PASS", () => {
  const result = enforceVerificationEvidence({
    status: "FAIL",
    checks: [{
      name: "Missing test",
      passed: false,
      evidence: "No test result was supplied.",
      classification: "UNPROVEN",
      source: "runtime evidence",
      locator: "test result"
    }]
  }, ["Run the test"]);

  assert.equal(result.status, "FAIL");
});
