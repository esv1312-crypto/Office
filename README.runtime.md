# AI-OFFICE Runtime

This is the executable control-plane for AI-OFFICE.

Flow:
INTAKE -> RECON -> PLAN -> DELEGATE -> EXECUTE -> VERIFY -> FIX -> RETEST -> EVIDENCE

The runtime starts without an API key in control-plane mode and switches to AI mode when a supported provider is configured.

## Internal API access

Control-plane endpoints that expose task state, tool availability, provider configuration, model pools, or resource diagnostics require the existing `OFFICE_AUDIT_TOKEN` through the `x-ai-office-audit-token` header. Query-token compatibility remains for existing internal smoke/audit calls; avoid query tokens in new integrations because URLs may be logged.

Public health endpoints should remain minimal and must not expose secret values.

## GitHub write safety

The GitHub write tool requires an explicitly configured `GITHUB_BRANCH` dedicated to work. Model-provided branch overrides are rejected. Protected branches (`main`, `master`, `production`) are blocked unless an operator explicitly enables protected-branch writes.

## Browser automation

Browser execution is blocked unless all required settings are present:
- `BROWSER_AUTOMATION_ENABLED=true`
- `TINYFISH_API_KEY`
- `OFFICE_PUBLIC_URL` pointing to this runtime's public HTTPS URL

The runtime creates a cryptographically random, one-time token for each browser request and includes it in the callback URL because the external asynchronous browser API accepts a callback URL rather than a custom callback header. The token is removed from public request snapshots and consumed after the first valid callback; replayed or unknown tokens are rejected. Sensitive browser actions still require explicit approval through the authenticated control plane.\n\nBrowser request state is currently process-local and is not restored from PostgreSQL. If the runtime restarts mid-workflow, the old request ID will no longer resolve and its one-time callback token will no longer authenticate. Do not automatically replay browser actions after restart: a request may have reached the external browser provider before the runtime lost state, and replaying a sensitive action could duplicate a purchase, message, account change, or other side effect. The operator must inspect external state as appropriate, then submit a new browser request and obtain fresh approval for sensitive actions.

## Model discovery

Catalog discovery is not a live capability test. A model appearing in the scout does not prove that it is currently reachable, fast, or reliable. APINEX discovery is limited to model IDs explicitly prefixed with `free/`; actual quota and provider behavior must be verified before production use.

The live monitor remains a separate observability service.
