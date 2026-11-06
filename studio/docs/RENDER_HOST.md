# Isolated Studio host

This entrypoint is intended for a dedicated Render Web Service. It does not import or start the legacy `src/server.js` runtime.

## Runtime

- Start command: `node studio/server.js`
- Node.js: 22
- Health: `/health/live` and `/health/ready`
- Owner API prefix: `/api/studio`
- The host mounts the authenticated Studio control plane only after all required configuration is present.
- No migrations are run at startup. The dedicated Neon database must already contain migrations 001–006.

## Required Render secrets / environment

Set these in the dedicated service's secret environment configuration; never commit values:

- `STUDIO_DATABASE_URL` — connection string for the isolated Neon `studio_db`.
- `STUDIO_MODEL_API_KEY` — API key for an explicitly approved OpenAI-compatible provider.
- `STUDIO_PLANNER_MODEL`, `STUDIO_WORKER_MODEL`, `STUDIO_QA_MODEL` — separate model routes. Choose routes with known pricing and owner-approved limits.
- `STUDIO_AUTH_JWKS_URL` — `https://ep-dark-snow-bavufmug.neonauth.c-8.eu-central-1.aws.neon.tech/studio_db/auth/.well-known/jwks.json`.
- `STUDIO_AUTH_ISSUER` and `STUDIO_AUTH_AUDIENCE` — both set to the Neon Auth base URL `https://ep-dark-snow-bavufmug.neonauth.c-8.eu-central-1.aws.neon.tech/studio_db/auth` (Better Auth JWT defaults).
- `STUDIO_GITHUB_TOKEN` — narrowly scoped token with Contents write access to the `Office` repository. The artifact writer is hard-limited to `studio/projects/` on `studio-v1-foundation`.

Optional configuration:

- `STUDIO_MODEL_BASE_URL` — provider-compatible API base URL.
- `STUDIO_MODEL_PROVIDER` — audit label (default `openai-compatible`).
- `STUDIO_RATE_LIMIT_PER_MINUTE` — per-IP API limit (default 60, maximum 600).
- `STUDIO_WORKER_CONCURRENCY` — in-process Worker concurrency (default 2, maximum 8).
- `PORT` — supplied by Render.

## Safety boundaries

- Startup fails closed when any required secret/configuration is missing.
- Startup never migrates the database or makes a model request.
- The owner identity is derived only from a verified RS256 Neon Auth token.
- Database membership and role authorization remain enforced by Studio's PostgreSQL access-control adapter.
- Generated repository artifacts can only be written under `studio/projects/` on the dedicated working branch.
- The entrypoint does not start the legacy server, modify Render, or publish a Roblox experience.
- A successful health check proves host/database availability only; it does not prove an autonomous task has completed.

## Remaining prerequisites

Neon Auth is provisioned on the isolated `universal-ai-studio` project's `main` branch. Public email/password sign-up is disabled and email verification is required. The host must use the branch's base URL as both issuer and audience and the published JWKS URL. The model provider and three model routes require explicit owner-approved credentials/pricing. A narrowly scoped GitHub token must be supplied through Render secrets. None of those secrets are stored in this repository.
