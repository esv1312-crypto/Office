const ROLE_TASKS = {
  analyst: "Analyze the original task and identify the main checks, risks, dependencies, and expected evidence.",
  developer: "Inspect the implementation relevant to the original task and identify concrete technical failures or fixes.",
  verifier: "Independently verify the implementation and proposed results; list PASS/FAIL evidence.",
  executor: "Run safe operational checks and recovery/replacement actions available to the runtime; report actual outcomes only."
};

const DEFAULT_ROLES = ["analyst", "developer", "verifier", "executor"];

function parseExplicitRoleConstraint(task) {
  const match = String(task || "").match(/\bdelegate exactly\s+(\d+)\s+subtasks?\s*:\s*([^\r\n.!?]+)/i);
  if (!match) return null;

  const count = Number(match[1]);
  const roleList = match[2];
  const roles = Object.keys(ROLE_TASKS)
    .map(role => ({ role, index: roleList.search(new RegExp("\\b" + role + "\\b", "i")) }))
    .filter(item => item.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map(item => item.role);

  if (!Number.isInteger(count) || count < 1 || count > 4 || roles.length !== count) return null;
  return roles;
}

export function buildDeterministicRecoveryPlan(task) {
  const roles = parseExplicitRoleConstraint(task) || DEFAULT_ROLES;
  return {
    summary: "Deterministic recovery plan created because the Chief response was not valid planner JSON.",
    subtasks: roles.map(employeeId => ({ employeeId, task: ROLE_TASKS[employeeId] })),
    verificationChecklist: [
      "All planned roles produced results",
      "Provider/model fallback behavior was exercised or observed",
      "Independent verification produced evidence",
      "Final root state is consistent with the evidence"
    ]
  };
}
