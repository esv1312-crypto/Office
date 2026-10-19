# AI-OFFICE Runtime

This is the executable control-plane for AI-OFFICE.

Flow:
INTAKE -> RECON -> PLAN -> DELEGATE -> EXECUTE -> VERIFY -> FIX -> RETEST -> EVIDENCE

The runtime starts without an API key in control-plane mode and switches to AI mode when a supported provider is configured.

## Internal API access

Control-plane endpoints that expose task state, tool availability, provider configuration, model pools, or resource diagnostics require the existing `OFFICE_AUDIT_TOKEN` through the `x-ai-office-audit-token` header. Query-token compatibility remains for existing internal smoke/audit calls; avoid query tokens in new integrations because URLs may be logged.

Public health endpoints should remain minimal and must not expose secret values.

## Browser automation

Browser execution is blocked unless all required settings are present:
- `BROWSER_AUTOMATION_ENABLED=true`
- `TINYFISH_API_KEY`
- `BROWSER_WEBHOOK_SECRET`
- `OFFICE_PUBLIC_URL` pointing to this runtime's public HTTPS URL

The runtime includes the webhook secret in the callback URL because the external asynchronous browser API accepts a callback URL rather than a custom callback header. Treat this as a bearer secret: use a long random value, never expose it to models or users, and rotate it if logs or provider records may have disclosed it. Sensitive browser actions still require explicit approval through the authenticated control plane.

## Model discovery

Catalog discovery is not a live capability test. A model appearing in the scout does not prove that it is currently reachable, fast, or reliable. APINEX discovery is limited to model IDs explicitly prefixed with `free/`; actual quota and provider behavior must be verified before production use.

The live monitor remains a separate observability service.
