import test from "node:test";
import assert from "node:assert/strict";
import { competencyCoverage, hasCompetencyCoverage, hasRequiredToolCoverage, requiredToolsForTask } from "./competency-matching.js";

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


test("routes all competencies from the Universal AI Studio master plan to the active team", () => {
  const specialists = [
    { id: "architect", competencies: ["architecture", "system.design", "integration", "technical documentation"] },
    { id: "implementation", competencies: ["implementation", "coding", "documentation", "source code modification"] },
    { id: "quality", competencies: ["qa.review", "testing", "security.review", "acceptance.criteria"] },
    { id: "product", competencies: ["product.strategy", "task.decomposition", "requirements"] },
    { id: "ux", competencies: ["roblox.ui", "ux.design", "accessibility"] },
  ];
  const requirements = [
    ["Frontend engineering", "UX design", "API integration", "Accessibility"],
    ["Planning algorithms", "Graph validation", "LLM structured generation", "Workflow design"],
    ["LLM routing engineering", "Configuration management", "Policy enforcement", "Cost modeling"],
    ["Financial controls engineering", "Atomic transaction design", "Concurrency testing", "Provider integration"],
    ["Quality assurance engineering", "Evidence evaluation", "Test analysis", "Structured reporting"],
    ["Program management", "Release planning", "Risk management", "Dependency tracking"],
    ["Workflow engine engineering", "State machine design", "Concurrency control", "Backend engineering"],
    ["Distributed systems architecture", "Domain modeling", "API design", "Extensibility design"],
    ["Git automation", "GitHub API integration", "Branching strategy", "Code review workflow"],
    ["Software architecture", "Technical risk assessment", "Migration planning", "Decision documentation"],
    ["Plugin architecture", "Domain modeling", "Configuration design", "Extensibility engineering"],
    ["Sandboxing and isolation", "Tool adapter engineering", "Process supervision", "Security engineering"],
    ["Storage engineering", "Integrity verification", "Backend engineering", "Data durability"],
    ["Database engineering", "SQL migration authoring", "Data integrity design", "Neon/Postgres operations"],
    ["LLM application engineering", "Requirements elicitation", "Structured output validation", "Prompt design"],
    ["Backend engineering", "Organizational data modeling", "CRUD API design", "Access control"],
    ["Test infrastructure engineering", "Container or sandbox operations", "CI integration", "Log management"],
    ["Distributed systems reliability", "Concurrency control", "Idempotency design", "Failure recovery engineering"],
    ["Technical writing", "Operational record keeping", "Git workflow", "Evidence management"],
    ["Reporting engineering", "Evidence traceability", "Technical writing", "Data aggregation"],
    ["Test engineering", "End-to-end automation", "Acceptance criteria mapping", "Evidence reporting"],
    ["Security engineering", "Access control design", "Audit logging", "Secrets management"],
  ];
  for (const competencies of requirements) {
    const task = { requiredCompetencies: competencies };
    assert.ok(
      specialists.some(specialist => competencyCoverage(task, specialist) > 0),
      "every planned task must have at least one compatible active specialist: " + competencies.join(", "),
    );
  }
});

test("requires every explicit task tool to be granted to the specialist", () => {
  const task = { requiredTools: ["write_repo_file", "read_repo_file"] };
  assert.equal(hasRequiredToolCoverage(task, { allowedTools: ["write_repo_file", "read_repo_file"] }), true);
  assert.equal(hasRequiredToolCoverage(task, { allowedTools: ["read_repo_file"] }), false);
  assert.equal(hasRequiredToolCoverage(task, { allowedTools: [] }), false);
  assert.equal(hasRequiredToolCoverage({ requiredTools: [] }, { allowedTools: [] }), true);
  const inferredTask = { requiredCompetencies: ["Extensibility engineering"], requiredTools: [] };
  assert.deepEqual(requiredToolsForTask(inferredTask), ["write_repo_file", "read_repo_file"]);
  assert.equal(hasRequiredToolCoverage(inferredTask, { allowedTools: ["read_repo_file"] }), false);
  assert.equal(hasRequiredToolCoverage(inferredTask, { allowedTools: ["write_repo_file", "read_repo_file"] }), true);
});
