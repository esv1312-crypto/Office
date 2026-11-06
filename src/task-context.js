export const MAX_WORKER_CONTEXT_CHARS = 300000;
export const MAX_ROLE_WORKER_CONTEXT_CHARS = 160000;

const ROLE_SOURCE_FILES = {
  analyst: ["src/model-scout.js","src/free-ai-resource-manager.js","src/runtime-config.js","src/task-context.js","src/provider-candidate-order.js","src/provider-retry-policy.js","RUNTIME BROWSER SNAPSHOT"],
  developer: ["src/server.js","src/provider-response.js","src/provider-candidate-order.js","src/provider-retry-policy.js","src/task-state.js","src/task-context.js","src/runtime-config.js","package.json",".github/workflows/office-live-test.yml"],
  verifier: ["src/server.js","src/evidence-index.js","src/verification.js","src/task-state.js","src/worker-watchdog.js","src/database.js","src/provider-response.js",".github/workflows/office-live-test.yml","RUNTIME BROWSER SNAPSHOT"],
  executor: ["src/server.js","src/database.js","src/worker-watchdog.js","src/task-state.js",".github/workflows/office-live-test.yml","RUNTIME BROWSER SNAPSHOT"]
};

export function buildWorkerTaskContext(task, maxChars = MAX_WORKER_CONTEXT_CHARS) {
  const text = String(task || "");
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[WORKER SOURCE CONTEXT TRUNCATED: supplied " + text.length + " characters; runtime included " + maxChars + ". Split the source dossier into smaller tasks before claiming a complete audit.]";
}

export function buildRoleScopedWorkerContext(task, role, maxChars = MAX_ROLE_WORKER_CONTEXT_CHARS) {
  const text = String(task || "");
  const marker = "\n===== SOURCE DOSSIER =====\n";
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return buildWorkerTaskContext(text, maxChars);
  const prefix = text.slice(0, markerIndex).trim();
  const dossier = text.slice(markerIndex + marker.length);
  const headers = [...dossier.matchAll(/^=====\s*(.+?)\s*=====\s*$/gm)];
  if (!headers.length) return buildWorkerTaskContext(text, maxChars);
  const sections = new Map();
  headers.forEach((header, index) => {
    const name = header[1].trim();
    const start = header.index + header[0].length;
    const end = index + 1 < headers.length ? headers[index + 1].index : dossier.length;
    sections.set(name, dossier.slice(start, end).trim());
  });
  const allowed = new Set(ROLE_SOURCE_FILES[String(role || "").toLowerCase()] || ROLE_SOURCE_FILES.executor);
  const selected = [...sections.entries()].filter(([name]) => allowed.has(name)).map(([name, content]) => "===== " + name + " =====\n" + content);
  if (!selected.length) return buildWorkerTaskContext(text, maxChars);
  const scoped = [prefix, "", "[ROLE-SCOPED SOURCE DOSSIER: " + String(role || "executor") + ". Only relevant source files are included; do not infer behavior from omitted files.]", ...selected].join("\n");
  if (scoped.length <= maxChars) return scoped;
  return scoped.slice(0, maxChars) + "\n[ROLE-SCOPED SOURCE CONTEXT TRUNCATED: supplied " + scoped.length + " characters; runtime included " + maxChars + ". Mark findings requiring omitted content UNPROVEN.]";
}

export function buildPlanningTaskBrief(task, maxChars = 12000) {
  const text = String(task || "");
  const dossierMarkers = [text.indexOf("\nSOURCE DOSSIER:"), text.indexOf("\n===== SOURCE DOSSIER =====")].filter(index => index >= 0);
  const dossierStart = dossierMarkers.length ? Math.min(...dossierMarkers) : -1;
  if (dossierStart >= 0) {
    const instructions = text.slice(0, dossierStart).trim();
    const dossier = text.slice(dossierStart);
    const files = [...dossier.matchAll(/(?:^|\n)=====\s*([^=\n]+?)\s*=====/g)].map(match => match[1].trim()).filter(Boolean);
    const uniqueFiles = [...new Set(files)];
    return [instructions, "", "[SOURCE DOSSIER OMITTED FROM PLANNING PROMPT TO KEEP MODEL INPUT BOUNDED.]", "The full source dossier remains attached to the parent task; workers receive role-scoped source files.", "Dossier size: " + dossier.length + " characters.", "Dossier files: " + (uniqueFiles.length ? uniqueFiles.join(", ") : "file headings not detected")].join("\n").slice(0, maxChars);
  }
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[PLANNING CONTEXT TRUNCATED BY RUNTIME; full task remains attached to parent task.]";
}
