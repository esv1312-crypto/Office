# Free LLM provider scouting — 2026-10-21

## Purpose

Expand the AI-ОФИС provider pool only after verifying real API responses. A catalog entry, a model name, or a "free" label is not proof of usable capacity. Keep this work on an audit branch until CI and live tests pass; do not change production credentials or routing automatically.

## Current code baseline

- `src/model-scout.js` on `main` already discovers free OpenRouter routes, Hugging Face Inference Providers, and APInex models.
- APInex discovery uses `APINEX_API_KEY`, calls `https://api.apinex.bond/v1/models`, and only accepts model IDs prefixed `free/`.
- Runtime APInex calls already use the OpenAI-compatible chat-completions route and reject non-`free/` model IDs.
- `src/free-ai-resource-manager.js` already lists APINEX, Gemini, OpenRouter, Cloudflare, and Hugging Face.
- Do not treat APINEX as verified until its API key is configured and a live test succeeds.

## Provider candidates

| Provider | Access class | Official endpoint/docs | Assessment |
|---|---|---|---|
| Google Gemini API | Recurring free quota, model/account limits | https://ai.google.dev/gemini-api/docs/rate-limits | Already integrated. Keep as one channel, not a single point of failure. Free-tier data-use terms must be reviewed. |
| Groq | Free developer tier with per-model request/token caps | https://console.groq.com/docs/rate-limits | High-priority direct provider to add; OpenAI-compatible endpoint: `https://api.groq.com/openai/v1/chat/completions`. Inspect response rate-limit headers. |
| SambaNova Cloud | Public docs advertise API access; account-specific free quota must be confirmed | https://docs.sambanova.ai/docs/en/integrations/vscode | High-priority candidate to verify in the actual account before coding assumptions about quota. Chat endpoint documented as `https://api.sambanova.ai/v1/chat/completions`. |
| APINEX | Third-party aggregator; free model IDs use `free/*` in current integration | https://apinex.bond/developers/models/chat | Already integrated on main; test real access, limits, terms, and data handling. |
| OpenRouter | Free routes subject to model/provider limits | https://openrouter.ai/pricing/ | Already integrated; keep as an aggregator fallback, not the only provider. |
| Cloudflare Workers AI | 10,000 Neurons/day free allocation; selected models require paid plan | https://developers.cloudflare.com/workers-ai/platform/pricing/ | Already integrated; use only models allowed by the account's current free allocation. |
| Mistral | Free Experiment mode with restrictions | https://docs.mistral.ai/ | Candidate; verify current account eligibility and evaluation-only/non-production conditions before routing real tasks. |
| Cohere | Free evaluation key; trial limits include 1,000 API calls/month | https://docs.cohere.com/v2/docs/rate-limits | Useful test/verification channel, but small monthly budget means not a primary worker pool. |
| NVIDIA NIM API Catalog | Free access for prototyping/research; production requires appropriate license | https://docs.api.nvidia.com/nim/docs/product | Candidate for development tests only unless licensing is confirmed. |
| Hugging Face Inference Providers | Provider/model-dependent access and pricing | https://huggingface.co/docs/inference-providers | Already integrated; only routes explicitly marked free and live should be considered. |

## Required acceptance test for each provider

1. Confirm the account's terms, free quota, commercial-use permission, and data-use policy.
2. Store only a user-owned API key in the deployment secret manager; never commit or log it.
3. Fetch the provider's live model catalog, if available.
4. Send the same minimal harmless chat-completion prompt 3 times with a strict timeout.
5. Record HTTP status, latency, model ID, finish reason, returned text length, and quota headers; redact credentials and prompt content.
6. Test timeout, HTTP 401, 403, 404, 429, and 5xx behavior using mocks in CI. Do not intentionally burn live quotas.
7. Mark a model eligible only after a real response is valid and the model meets the role's output contract. Discovery alone is not qualification.
8. On quota/auth/policy failure, cool down the affected provider or model appropriately and move to a different provider. Never loop on the same unavailable route.
9. Compare task completion and evidence quality, not just HTTP 200 or speed.

## Important finding from production audit run #29

The run failed; no artifact was attached. Render logs show that provider/model fallback did occur, including successful model calls, but the end-to-end office task still failed because worker responses lacked the required `EVIDENCE INDEX` and independent verification failed. Therefore, adding more API endpoints alone will not make the office pass its audit. Provider reliability and the output/evidence contract must be tested separately.

Run: https://github.com/esv1312-crypto/Office/actions/runs/39588757529

## Next steps

1. Confirm APINEX credentials are configured without exposing the secret; run APINEX model discovery and a harmless live preflight.
2. Add a Groq adapter on this audit branch using the existing OpenAI-compatible call path; add unit tests for key-missing, rate-limit, timeout, and malformed responses.
3. Verify SambaNova's free-tier terms and account quota before adding its adapter.
4. Add provider-specific diagnostics and latency/success counters to the existing scout/evidence flow.
5. Run CI and isolated live preflights. Do not merge or deploy to production until the owner explicitly approves after evidence review.
