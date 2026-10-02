const PROVIDERS = [
  {
    id:"gemini",
    name:"Google Gemini API",
    freeAccess:"official free tier may be available; current limits vary by model/account; verify before use",
    credentialEnv:["GEMINI_API_KEY"],
    docs:"https://ai.google.dev/gemini-api/docs/pricing"
  },
  {
    id:"openrouter",
    name:"OpenRouter",
    freeAccess:"free models/access may be available subject to current provider limits",
    credentialEnv:["OPENROUTER_API_KEY"],
    docs:"https://openrouter.ai/pricing/"
  },
  {
    id:"cloudflare",
    name:"Cloudflare Workers AI",
    freeAccess:"free allocation may be available subject to current account limits",
    credentialEnv:["CLOUDFLARE_API_TOKEN","CLOUDFLARE_ACCOUNT_ID"],
    docs:"https://developers.cloudflare.com/workers-ai/platform/pricing/"
  }
];

function configured(provider) {
  return provider.credentialEnv.every(key => Boolean(process.env[key]));
}

function status(provider) {
  const missing = provider.credentialEnv.filter(key => !process.env[key]);
  return {
    id:provider.id,
    name:provider.name,
    configured:missing.length === 0,
    missing,
    freeAccess:provider.freeAccess,
    docs:provider.docs
  };
}

export function inspectFreeProviders() {
  const providers = PROVIDERS.map(status);
  return {
    freeOnly:String(process.env.AI_FREE_ONLY ?? "true").toLowerCase() !== "false",
    providers,
    configuredProviders:providers.filter(x=>x.configured).map(x=>x.id),
    nextAction:providers.some(x=>x.configured)
      ? "Use configured providers through the AI Gateway and fail over on quota/provider errors."
      : "Owner action required: add at least one legal provider credential in the service secret environment."
  };
}

export function chooseNextProvider(failedProvider) {
  const order=(process.env.AI_PROVIDER_ORDER || "gemini,openrouter,cloudflare")
    .split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  return order.find(id => id !== failedProvider && PROVIDERS.some(p=>p.id===id) && configured(PROVIDERS.find(p=>p.id===id))) || null;
}
