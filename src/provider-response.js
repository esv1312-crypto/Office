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

/**
 * Structural provider-response diagnostics only; never includes answer or reasoning text.
 */
export function summarizeProviderResponse(data = {}, httpStatus = null, requestId = null) {
  const choice = data?.choices?.[0] || null;
  const message = choice?.message || {};
  const content = message?.content;
  const contentParts = Array.isArray(content) ? content : [];
  const contentText = typeof content === "string" ? content : contentParts.map(part => typeof part === "string" ? part : part?.text || "").join("\n");
  const usage = data?.usage || {};
  const tokenValue = (...values) => { const value = values.find(item => item !== undefined && item !== null); return Number.isFinite(Number(value)) ? Number(value) : null; };
  return {
    httpStatus: Number.isFinite(Number(httpStatus)) ? Number(httpStatus) : null,
    requestId: requestId ? String(requestId).slice(0, 160) : null,
    responseKeys: Object.keys(data || {}).slice(0, 30),
    choicesCount: Array.isArray(data?.choices) ? data.choices.length : 0,
    choiceKeys: choice ? Object.keys(choice).slice(0, 30) : [],
    finishReason: choice?.finish_reason ?? null,
    messageKeys: Object.keys(message || {}).slice(0, 30),
    contentType: content === null ? "null" : Array.isArray(content) ? "array" : typeof content,
    contentChars: contentText.length,
    contentPartTypes: contentParts.map(part => typeof part === "object" ? String(part?.type || "object") : typeof part).slice(0, 20),
    reasoningChars: typeof message?.reasoning === "string" ? message.reasoning.length : null,
    reasoningDetailsCount: Array.isArray(message?.reasoning_details) ? message.reasoning_details.length : null,
    refusalChars: typeof message?.refusal === "string" ? message.refusal.length : null,
    toolCallsCount: Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0,
    legacyChoiceTextChars: typeof choice?.text === "string" ? choice.text.length : null,
    usage: { promptTokens: tokenValue(usage.prompt_tokens, usage.input_tokens), completionTokens: tokenValue(usage.completion_tokens, usage.output_tokens), totalTokens: tokenValue(usage.total_tokens) },
    responseModel: data?.model ? String(data.model).slice(0, 160) : null
  };
}
