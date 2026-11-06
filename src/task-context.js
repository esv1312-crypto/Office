export const MAX_WORKER_CONTEXT_CHARS = 300000;

export function buildWorkerTaskContext(task, maxChars = MAX_WORKER_CONTEXT_CHARS) {
  const text = String(task || "");
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars)
    + "\n[WORKER SOURCE CONTEXT TRUNCATED: supplied "
    + text.length
    + " characters; runtime included "
    + maxChars
    + ". Split the source dossier into smaller tasks before claiming a complete audit.]";
}

export function buildPlanningTaskBrief(task, maxChars = 12000) {
  const text = String(task || "");
  const dossierMarkers = [
    text.indexOf("\nSOURCE DOSSIER:"),
    text.indexOf("\n===== SOURCE DOSSIER =====")
  ].filter(index => index >= 0);
  const dossierStart = dossierMarkers.length ? Math.min(...dossierMarkers) : -1;

  if (dossierStart >= 0) {
    const instructions = text.slice(0, dossierStart).trim();
    const dossier = text.slice(dossierStart);
    const files = [...dossier.matchAll(/(?:^|\n)=====\s*([^=\n]+?)\s*=====/g)]
      .map(match => match[1].trim())
      .filter(Boolean);
    const uniqueFiles = [...new Set(files)];
    return [
      instructions,
      "",
      "[SOURCE DOSSIER OMITTED FROM PLANNING PROMPT TO KEEP MODEL INPUT BOUNDED.]",
      "The full source dossier remains attached to the parent task; worker prompts receive the runtime's bounded parent-task context.",
      "Dossier size: " + dossier.length + " characters.",
      "Dossier files: " + (uniqueFiles.length ? uniqueFiles.join(", ") : "file headings not detected")
    ].join("\n").slice(0, maxChars);
  }

  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[PLANNING CONTEXT TRUNCATED BY RUNTIME; full task remains attached to parent task.]";
}
