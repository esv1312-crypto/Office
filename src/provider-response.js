export function extractFinalAssistantText(message = {}, choiceText = null) {
  const content = message?.content;
  const finalContent = typeof content === "string"
    ? content.trim()
    : Array.isArray(content)
      ? content.map(part => typeof part === "string" ? part : part?.text || "").filter(Boolean).join("\n").trim()
      : "";
  if (finalContent) return finalContent;

  // Some OpenAI-compatible providers return internal reasoning separately from
  // the final assistant message. Reasoning is not a user-facing answer and must
  // never be promoted to task output or accepted as a successful preflight.
  return typeof choiceText === "string" ? choiceText.trim() : "";
}
