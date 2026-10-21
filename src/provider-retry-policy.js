export function shouldStopOpenRouterFallback(status) {
  // Authentication failures invalidate the shared credential. HTTP 402/429 can be
  // route/model-specific on free aggregators, so try the next candidate before
  // suppressing the entire provider.
  return Number(status) === 401;
}

export function shouldSuppressProviderForStatus(provider, status) {
  const name=String(provider || "").trim().toLowerCase();
  const code=Number(status);
  // OpenRouter serves many independently metered free routes behind one API key.
  // A model-specific 402/429 must cool down that model, not disable every model.
  if(name === "openrouter" && (code === 402 || code === 429)) return false;
  // A 401 indicates the shared provider credential is rejected.
  return code === 401 || code === 402 || code === 429;
}

export function providerCooldownMs(provider, status, message = "") {
  const name=String(provider || "").trim().toLowerCase();
  const code=Number(status);
  const text=String(message || "");
  // Gemini free-tier quota errors can include a reset many hours away.
  // A 60-second cooldown just replays the same doomed request on every task.
  if(name === "gemini" && (code === 429 || /quota exceeded|rate.?limit|resource.?exhausted/i.test(text))) {
    return 12 * 60 * 60 * 1000;
  }
  return code === 429 ? 60 * 1000 : 15 * 60 * 1000;
}

export function modelCooldownMs(status, message = "") {
  const code=Number(status);
  const text=String(message || "");
  // Explicit route-policy denials and stale free slugs will not heal after a short retry.
  if(code===403 && /only available on agentic harnesses|not available to this application|not permitted/i.test(text)) return 6*60*60*1000;
  if(code===404 || /model.*(not found|does not exist|unavailable for free)|unknown model|invalid model/i.test(text)) return 6*60*60*1000;
  // Bad-request route failures should not be retried on every task; retain a bounded cooldown.
  if(code===400) return 15*60*1000;
  if(/empty response/i.test(text)) return 60*1000;
  if(code===408 || (code>=500 && code<=599)) return 2*60*1000;
  return code===429 ? 60*1000 : 15*60*1000;
}
