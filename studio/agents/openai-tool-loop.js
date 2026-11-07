/**
 * Bounded OpenAI-compatible tool-calling loop.
 * Tool execution is delegated to an injected, permission-filtered executor.
 */
export async function runOpenAiToolLoop({
  client,
  model,
  messages,
  tools,
  executeTool,
  temperature = 0.2,
  maxTokens = 6000,
  maxRounds = 8,
  signal,
}) {
  if (typeof client?.chat?.completions?.create !== "function") throw new TypeError("chat.completions.create is required");
  if (typeof model !== "string" || !model.trim()) throw new TypeError("model is required");
  if (!Array.isArray(messages) || !messages.length) throw new TypeError("messages are required");
  if (!Array.isArray(tools) || !tools.length) throw new TypeError("at least one tool definition is required");
  if (typeof executeTool !== "function") throw new TypeError("executeTool is required");
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 20) throw new TypeError("maxRounds must be between 1 and 20");

  const allowed = new Set(tools.map(item => item?.function?.name).filter(name => typeof name === "string"));
  if (allowed.size !== tools.length) throw new TypeError("tool definitions must have unique function names");
  const conversation = [...messages];
  let executed = 0;

  for (let round = 0; round <= maxRounds; round += 1) {
    const response = await client.chat.completions.create({
      model,
      messages: conversation,
      temperature,
      max_tokens: maxTokens,
      tools,
      tool_choice: "auto",
    }, signal ? { signal } : undefined);
    const message = response?.choices?.[0]?.message;
    if (!message || typeof message !== "object") {
      throw Object.assign(new Error("Model returned an invalid tool-loop response"), { code: "INVALID_TOOL_RESPONSE" });
    }
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) {
      const text = typeof message.content === "string" ? message.content.trim()
        : Array.isArray(message.content) ? message.content.map(part => part?.text || "").join("").trim() : "";
      if (!text) throw Object.assign(new Error("Worker model returned empty content"), { code: "EMPTY_MODEL_OUTPUT" });
      return { text, toolCallsExecuted: executed, toolRounds: round };
    }
    if (round === maxRounds) {
      throw Object.assign(new Error("Worker exceeded the configured tool-call round limit"), { code: "TOOL_ROUND_LIMIT" });
    }

    conversation.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: calls,
    });
    for (const call of calls) {
      const name = call?.function?.name;
      const callId = call?.id;
      if (!allowed.has(name) || typeof callId !== "string" || !callId) {
        throw Object.assign(new Error("Model requested a tool outside the worker's granted permissions"), { code: "TOOL_NOT_ALLOWED" });
      }
      let result;
      try {
        result = await executeTool({ name, arguments: call.function.arguments });
      } catch (error) {
        result = { error: error?.code || "TOOL_EXECUTION_FAILED", message: String(error?.message || "Tool execution failed").slice(0, 500) };
      }
      conversation.push({
        role: "tool",
        tool_call_id: callId,
        content: JSON.stringify(result),
      });
      executed += 1;
    }
  }
  throw Object.assign(new Error("Worker tool loop ended without a final answer"), { code: "TOOL_LOOP_INCOMPLETE" });
}
