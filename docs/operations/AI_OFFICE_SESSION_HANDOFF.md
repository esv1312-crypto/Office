# AI Office — Session handoff

Last reconciled: 2026-11-11 (UTC; bounded-run preflight)
Primary repository: https://github.com/esv1312-crypto/Office
Primary branch: `studio-v1-foundation`
Master notebook: [docs/UNIVERSAL_AI_STUDIO_MASTER_NOTEBOOK.md](../UNIVERSAL_AI_STUDIO_MASTER_NOTEBOOK.md)

## Current status after owner approval

- Owner approved one fresh live validation run, exactly two tasks, internal budget ceiling USD 0.936184362, no cap increase. No Render deploy or production env/config change is included.
- **The run has NOT STARTED.** No model calls, reservations, plan/task mutations, or spend occurred.
- Budget re-read: cap USD 3.000000000; spent USD 2.063815638; reserved USD 0; remaining USD 0.936184362. External OpenRouter balance unverified.
- Render service `ai-office-runtime` is not suspended and latest deploy remains `dep-dbponeon74is73cp3eo0`, source `1ba7608fe2851ce09a0db2b1a6b3dac562e2fea0`. First readiness request returned 503; second returned 200 `{"status":"ready","database":"connected"}`. Render logs show a new instance start at 2026-11-11T11:13:05Z; correlation with the transient 503 is plausible but causality is NOT VERIFIED.
- The self-development launch route is unsuitable for this approval: it can update specialist profiles and creates/resumes a hard-coded three-task Sprint 2 plan before execution. Do not call it.
- Standard Studio routes exist for plan creation, approval and execution, with an execution batch cap of 1–3, but require owner authentication. Production reports `auth=legacy-owner-token`; middleware uses the secret `OFFICE_AUDIT_TOKEN`. Do not ask the owner to paste this secret into chat and do not expose it.
- Existing Actions workflows are not compatible with the exact approved run: current live runtime smoke performs multiple legacy checks; four-employee workflow submits four legacy tasks; Pognali audit is read-only and legacy API. Do not substitute them.
- No compatible invocation path is currently available through connected read-only tools.

## Next safe step

Prepare (not merge) a temporary GitHub Actions workflow on an isolated branch and open a PR. It must use the existing GitHub Actions secret without printing it, call only the standard authenticated Studio plan → approve → execute endpoints, constrain the plan to exactly two tasks, enforce the internal budget cap/remaining amount, record plan/task IDs and execution evidence, and stop on scope mismatch, missing artifact, QA failure, or budget gate. It must not call legacy `/api/tasks`, change Render environment, or deploy.
Review the PR and all side effects. **Do not merge** without separate owner approval because a production-branch merge may interact with Render auto-deploy. Do not execute the run until the workflow is merged and the exact two-task and budget safeguards are verified.

## Operating rules

- Read the master notebook before continuing; verify GitHub, Render and Neon live state before each significant action.
- Record only observed results; mark missing evidence NOT VERIFIED.
- Keep code and artifacts in GitHub/cloud storage, not the management chat.
- Never print, request in chat, or store secrets/tokens.
- Never exceed the owner's one-run authorization or the existing USD 3 hard cap.
