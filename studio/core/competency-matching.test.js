import test from "node:test";
import assert from "node:assert/strict";
import { competencyCoverage, hasCompetencyCoverage } from "./competency-matching.js";

test("matches canonical competencies without case or whitespace sensitivity", () => {
  const task = { requiredCompetencies: ["Implementation", "CODING", "  Documentation  "] };
  const specialist = { competencies: ["implementation", "coding", "documentation"] };
  assert.equal(competencyCoverage(task, specialist), 3);
  assert.equal(hasCompetencyCoverage(task, specialist), true);
});

test("maps common QA vocabulary to canonical QA competencies", () => {
  const task = { requiredCompetencies: ["QA", "Testing", "Verification", "Luau"] };
  const specialist = { competencies: ["qa.review", "testing", "acceptance.criteria"] };
  assert.equal(competencyCoverage(task, specialist), 3);
  assert.equal(hasCompetencyCoverage(task, specialist), true);
});

test("does not assign a task when no competency is covered", () => {
  const task = { requiredCompetencies: ["Roblox Studio", "RemoteEvents", "Luau"] };
  const specialist = { competencies: ["product.strategy", "task.decomposition"] };
  assert.equal(competencyCoverage(task, specialist), 0);
  assert.equal(hasCompetencyCoverage(task, specialist), false);
});
