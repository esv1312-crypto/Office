/**
 * Bounded OpenAI-compatible tool loop with strict call and context budgets.
 * Keeps the protocol history required by tool calling, but caps tool output
 * and records provider-reported usage instead of guessing token costs.
 */
function usageFrom(response) {
  const usage = response?.usage || {};
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const cached = Number(
    usage.prompt_tokens_details?.cached_tokens ??
    usage.input_tokens_details?.cached_tokens ??
    usage.cached_tokens ?? 0
  ) || 0;
  const rawCost = usage.cost ?? response?.cost;
  const cost = Number.isFinite(Number(rawCost)) ? Number(rawCost) : null;
  return { promptTokens: prompt, completionTokens: completion, cachedInputTokens: cached, providerCost: cost };
}

function evidenceForTool({ name, arguments: rawArguments, result }) {
  let args = {};
  try {
    args = typeof rawArguments === "string" ? JSON.parse(rawArguments) : (rawArguments || {});
  } catch {}
  const evidence = {
    name,
    status: result && typeof result === "object" && result.error ? "error" : "ok",
  };
  const path = typeof result?.path === "string" ? result.path : args.path;
  if (typeof path === "string") evidence.path = path;
  for (const key of ["branch", "sha", "blobSha", "commitSha"]) {
    if (typeof result?.[key] === "string") evidence[key] = result[key];
  }
  if (result?.range && typeof result.range === "object") {
    const { startLine, endLine, totalLines } = result.range;
    if ([startLine, endLine, totalLines].every(Number.isInteger)) {
      evidence.range = { startLine, endLine, totalLines };
    }
  }
  const sourceEvidencePaths = new Set([
    "studio/server.js",
    "studio/agents/github-workspace-tools.js",
    "studio/agents/worker-runtime.js",
  ]);
  const isWorkspaceEvidenceReadback = typeof path === "string" &&
    path.startsWith("studio/agent-workspace/verification/");
  const isWorkspaceProductReadback = typeof path === "string" &&
    path.startsWith("studio/agent-workspace/") && !isWorkspaceEvidenceReadback;
  const isAllowlistedSourceRead = typeof path === "string" && sourceEvidencePaths.has(path);
  if (name === "read_repo_file" &&
      (isWorkspaceEvidenceReadback || isWorkspaceProductReadback || isAllowlistedSourceRead) &&
      typeof result?.content === "string") {
    const contentBytes = Buffer.byteLength(result.content, "utf8");
    evidence.contentKind = isWorkspaceEvidenceReadback
      ? "workspace-verification-readback"
      : isWorkspaceProductReadback ? "workspace-product-readback" : "source-snippet";
    if (contentBytes <= 8192) evidence.content = result.content;
    else {
      evidence.contentTruncated = true;
      evidence.contentBytes = contentBytes;
    }
  }
  if (typeof result?.error === "string") evidence.error = result.error;
  return evidence;
}

function compactToolResult(result, maxBytes) {
  let serialized;
  try { serialized = JSON.stringify(result); }
  catch { serialized = JSON.stringify({ error: "TOOL_RESULT_NOT_SERIALIZABLE" }); }
  if (typeof serialized !== "string") serialized = "null";
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= maxBytes) return serialized;
  const previewBudget = Math.max(128, maxBytes - 180);
  let preview = serialized.slice(0, previewBudget);
  while (Buffer.byteLength(preview, "utf8") > previewBudget) preview = preview.slice(0, -16);
  return JSON.stringify({
    truncated: true,
    originalBytes: bytes,
    preview,
    hint: "Result was shortened to protect the context budget. Request a narrower range or a specific field."
  });
}

export async function runOpenAiToolLoop({
  client,
  model,
  messages,
  tools,
  executeTool,
  temperature = 0.2,
  maxTokens = 6000,
  maxRounds = 8,
  maxToolCalls = 12,
  maxToolResultBytes = 12 * 1024,
  maxTotalToolResultBytes = 48 * 1024,
  maxTotalOutputTokens = 12000,
  maxTotalPromptTokens = 120000,
  requestTimeoutMs = 90_000,
  modelBudget = null,
  signal,
}) {
  if (typeof client?.chat?.completions?.create !== "function") throw new TypeError("chat.completions.create is required");
  if (typeof model !== "string" || !model.trim()) throw new TypeError("model is required");
  if (!Array.isArray(messages) || !messages.length) throw new TypeError("messages are required");
  if (!Array.isArray(tools) || !tools.length) throw new TypeError("at least one tool definition is required");
  if (typeof executeTool !== "function") throw new TypeError("executeTool is required");
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 20) throw new TypeError("maxRounds must be between 1 and 20");
  if (!Number.isInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 100) throw new TypeError("maxToolCalls must be between 1 and 100");
  if (!Number.isInteger(maxToolResultBytes) || maxToolResultBytes < 256) throw new TypeError("maxToolResultBytes must be at least 256");
  if (!Number.isInteger(maxTotalToolResultBytes) || maxTotalToolResultBytes < maxToolResultBytes) throw new TypeError("maxTotalToolResultBytes must be at least maxToolResultBytes");
  if (!Number.isInteger(maxTotalOutputTokens) || maxTotalOutputTokens < 1) throw new TypeError("maxTotalOutputTokens must be positive");
  if (!Number.isInteger(maxTotalPromptTokens) || maxTotalPromptTokens < 1) throw new TypeError("maxTotalPromptTokens must be positive");
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 300_000) {
    throw new TypeError("requestTimeoutMs must be between 1000 and 300000");
  }

  const allowed = new Set(tools.map(item => item?.function?.name).filter(name => typeof name === "string"));
  if (allowed.size !== tools.length) throw new TypeError("tool definitions must have unique function names");
  const conversation = [...messages];
  let executed = 0;
  const toolEvidence = [];
  let totalToolResultBytes = 0;
  const usage = { promptTokens: 0, completionTokens: 0, cachedInputTokens: 0, providerCost: null, requests: 0 };

  for (let round = 0; round <= maxRounds; round += 1) {
    const remainingOutput = maxTotalOutputTokens - usage.completionTokens;
    if (remainingOutput <= 0) {
      throw Object.assign(new Error("Worker reached its total output-token budget"), { code: "OUTPUT_TOKEN_BUDGET" });
    }
    const requestMaxTokens = Math.min(maxTokens, remainingOutput);
    const reservation = modelBudget ? await modelBudget.reserve({ model, role: "worker", messages: conversation, maxTokens: requestMaxTokens }) : null;
    console.info("[studio-model] tool-loop request started", { model, round, executedTools: executed, budgetReservation: Boolean(reservation) });
    let response;
    try {
      response = await client.chat.completions.create({
        model,
        messages: conversation,
        temperature,
        max_tokens: requestMaxTokens,
        tools,
        tool_choice: "auto",
      }, { timeout: requestTimeoutMs, ...(signal ? { signal } : {}) });
    } catch (error) {
      console.warn("[studio-model] tool-loop request failed", {
        model, round,
        code: error?.code || "MODEL_REQUEST_FAILED",
        status: Number.isInteger(error?.status) ? error.status : null,
      });
      throw error;
    }
    if (reservation) await modelBudget.settle(reservation, { usage: response?.usage, response });
    const requestUsage = usageFrom(response);
    usage.promptTokens += requestUsage.promptTokens;
    usage.completionTokens += requestUsage.completionTokens;
    usage.cachedInputTokens += requestUsage.cachedInputTokens;
    if (requestUsage.providerCost !== null) usage.providerCost = (usage.providerCost || 0) + requestUsage.providerCost;
    usage.requests += 1;
    console.info("[studio-model] tool-loop response received", {
      model, round, toolCalls: Array.isArray(response?.choices?.[0]?.message?.tool_calls)
        ? response.choices[0].message.tool_calls.length : 0,
      promptTokens: requestUsage.promptTokens,
      completionTokens: requestUsage.completionTokens,
    });
    if (usage.promptTokens > maxTotalPromptTokens) {
      throw Object.assign(new Error("Worker reached its cumulative prompt-token budget"), {
        code: "PROMPT_TOKEN_BUDGET", usage
      });
    }

    const message = response?.choices?.[0]?.message;
    if (!message || typeof message !== "object") {
      throw Object.assign(new Error("Model returned an invalid tool-loop response"), { code: "INVALID_TOOL_RESPONSE" });
    }
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) {
      const text = typeof message.content === "string" ? message.content.trim()
        : Array.isArray(message.content) ? message.content.map(part => part?.text || "").join("").trim() : "";
      if (!text) throw Object.assign(new Error("Worker model returned empty content"), { code: "EMPTY_MODEL_OUTPUT" });
      return {
        text,
        toolCallsExecuted: executed,
        toolEvidence,
        toolRounds: round,
        usage,
        budget: { maxToolCalls, maxToolResultBytes, maxTotalToolResultBytes, maxTotalOutputTokens, maxTotalPromptTokens }
      };
    }
    if (round === maxRounds) {
      throw Object.assign(new Error("Worker exceeded the configured tool-call round limit"), { code: "TOOL_ROUND_LIMIT" });
    }
    if (executed + calls.length > maxToolCalls) {
      throw Object.assign(new Error("Worker reached its total tool-call budget"), { code: "TOOL_CALL_BUDGET" });
    }

    conversation.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const name = call?.function?.name;
      const callId = call?.id;
      if (!allowed.has(name) || typeof callId !== "string" || !callId) {
        throw Object.assign(new Error("Model requested a tool outside the worker's granted permissions"), { code: "TOOL_NOT_ALLOWED" });
      }
      let result;
      try {
        result = await executeTool({ name, arguments: call.function.arguments, signal });
      } catch (error) {
        result = {
          error: error?.code || "TOOL_EXECUTION_FAILED",
          message: String(error?.message || "Tool execution failed").slice(0, 500)
        };
      }
      toolEvidence.push(evidenceForTool({ name, arguments: call.function.arguments, result }));
      const content = compactToolResult(result, maxToolResultBytes);
      const resultBytes = Buffer.byteLength(content, "utf8");
      totalToolResultBytes += resultBytes;
      if (totalToolResultBytes > maxTotalToolResultBytes) {
        throw Object.assign(new Error("Worker reached its cumulative tool-result context budget"), {
          code: "TOOL_CONTEXT_BUDGET",
          usage,
          toolCallsExecuted: executed
        });
      }
      conversation.push({ role: "tool", tool_call_id: callId, content });
      executed += 1;
    }
  }
  throw Object.assign(new Error("Worker tool loop ended without a final answer"), { code: "TOOL_LOOP_INCOMPLETE" });
}
