# AI-ОФИС: reliability and product roadmap

A checked item means the code change and its stated automated checks exist in the audit branch. It does **not** mean the code is deployed or that a live external-provider workflow has been proven.

## Product decision

Do not build the user-facing interface yet. First make the existing runtime reliable and observable. Once the reliability gates pass, the first product task assigned to AI-ОФИС should be to design and implement its own user interface against documented backend contracts.

## P0 — correctness and safe operation

- [x] Browser requests reach a terminal blocked state when automation or credentials are unavailable.
- [x] Browser callbacks use per-request random tokens, hidden from snapshots and consumed after a valid callback; token replay is rejected.
- [x] Browser callbacks reject unknown/non-terminal status values without consuming the one-time token; only recognized terminal outcomes can finalize a request.
- [x] The Pognali audit workflow is manual-dispatch only; audit-branch pushes are not intended to submit tasks to production. GitHub nevertheless reports a push run with no jobs exposed, so the workflow's manual execution remains unverified and no live task is assumed to have been sent.
- [x] Sensitive browser approvals cannot be bypassed merely by labeling a sensitive goal as research.
- [x] Browser audit events redact URL query strings and task goals; callback tokens are redacted from provider errors.
- [x] Browser request history is bounded; when all slots are active, new work is rejected instead of evicting active requests.
- [x] Tool logs omit raw tool arguments, and task acceptance events log task length rather than raw task text.
- [x] Worker prompts mark repository contents, web pages, and tool results as untrusted data.
- [x] GitHub writes require an explicit working branch; model-provided branch overrides and protected branches are rejected by default.
- [x] Public health endpoints return minimal service status rather than provider/tool/browser configuration.
- [x] The independent verifier receives the candidate final answer on both initial and retry checks.
- [x] The verifier must use a preflighted model distinct from planner, synthesis, and worker models; verification fails closed if no independent candidate exists.
- [x] Strict verifier calls disable tools and do not fall back to another model after selection.
- [x] Verification requires one-to-one checklist coverage; duplicate, missing, or unmapped requirements fail closed.
- [x] Removed the hard-coded task-phrase override so production planning does not replace a user task with a special smoke-test plan.
- [x] Empty provider responses are rejected; preflight requires the exact `PREFLIGHT_OK` sentinel.
- [x] OpenRouter calls use defined timeout/tool policy; APINEX honors the no-tools preflight and request timeout.
- [x] OpenAI SDK calls have a bounded timeout; catalog requests time out.
- [x] Provider-wide authentication/quota failures stop repeated model attempts; rate-limit responses suppress the provider briefly.
- [x] The controlled provider-fallback smoke test uses request-scoped model overrides, does not mutate process-wide provider/model configuration, and fails unless its expected provider-fallback trace is observed.
- [x] Root recovery installs the replacement result before re-verifying it.
- [x] Worker recovery is single-flight to prevent duplicate replacement tasks.
- [x] Accepted, planning, and running tasks without a persisted resumable queue become explicitly interrupted after restart; configuration-blocked tasks remain waiting.
- [x] Remote backend calls send the required audit header, skip unauthenticated calls, and always clear timeout timers.
- [x] Event IDs remain monotonic across capped in-memory history and database restores.
- [x] PostgreSQL event history is retained and loaded by event timestamp rather than insertion timing.
- [x] Database writes are serialized and drained when the process shuts down gracefully.
- [x] Refuse startup when `DATABASE_URL` is configured but PostgreSQL initialization fails, instead of silently running without persistence.
- [x] Persist root-task acceptance before returning HTTP 202; return HTTP 503 if the initial snapshot cannot be stored.
- [x] Persist API-created subtask batches transactionally before starting workers.
- [x] Persist internally planned subtask batches together with the parent’s child links in one transaction; restore in-memory links if persistence fails.
- [x] Persist replacement workers and root-recovery tasks before execution, including the recovery task’s parent link.
- [x] CI syntax checks cover runtime, test, and script files; `npm test` runs syntax checks before unit tests.
- [x] Protected audit/control routes now accept audit credentials through headers rather than query strings; the one-time browser callback token remains supported because the browser provider receives a callback URL and the token is per-request.
- [x] The manual `office-live-test.yml` workflow now requires `secrets.OFFICE_AUDIT_TOKEN` and sends it in `x-ai-office-audit-token`; a unit test guards this contract.
- [x] Finish the route-by-route authorization review: control-plane routes use the shared guard, smoke/audit routes use their dedicated audit token, public health endpoints expose minimal status, and browser callbacks require one-time request tokens. Manual workflows use headers and are explicitly dispatched.
- [x] Validate the entire subtask batch before creating any children, so one malformed item cannot leave partial work running.
- [x] Bound numeric runtime settings so invalid environment values cannot produce a NaN worker limit or near-zero recurring timer.
- [x] Expose PostgreSQL enabled/ready state in `/health` and authenticated `/api/state` diagnostics.
- [x] Add deterministic integration coverage for root-task completion and verification recovery/retest using a loopback mock provider.
  - The runtime integration test exercises normal Chief → two specialist subtasks → synthesis → independent verifier PASS, plus a deliberate first-verification failure followed by a persisted recovery task, successful retest, and root completion.
  - Root completion has an explicit fail-closed gate: verifier status must be `PASS`, checks must be non-empty, and every check must have `passed === true`; unit tests cover absent, degraded, failed, empty, partial, malformed, and successful verification.
  - The verifier now receives the correctly named exclusion set for planner, synthesis, and worker models. Static role-specific candidates are also preflight-tested when dynamic model discovery is empty.
- [ ] Extend watchdog coverage to a full runtime timeout/recovery race and provider-fallback/retry exhaustion. Unit tests currently verify timeout eligibility and persistence-before-recovery ordering.
- [x] Reject passing verifier claims that contradict an identified task’s authoritative final state or claim all workers completed when any worker result remains unresolved; regression tests cover both cases.
- [x] Document browser-request restart behavior: in-memory requests and one-time callback tokens are lost; never replay potentially side-effecting browser actions automatically after restart.
- [x] Authenticate `.github/workflows/office-smoke.yml` and send the required `task` field to `/api/tasks`.
- [x] Authenticate `.github/workflows/office-live-test.yml` with `OFFICE_AUDIT_TOKEN` and send the required audit header to `/api/tasks`.

## P1 — model quality and resource scout

- [x] Keep model discovery separate from qualification; discovered APINEX models remain excluded from the default role pools.
- [x] Reject missing pricing fields as proof of free access.
- [x] Restrict APINEX model IDs to explicit `free/*` IDs.
- [x] Require a no-tools runtime preflight before an explicitly configured APINEX model is used.
- [x] Add bounded catalog fetches so a stalled source cannot hold Model Scout refresh indefinitely.
- [x] Add a PostgreSQL-backed registry for known catalog sources with availability, HTTP status, last-check time, and safe metadata.
- [ ] Persist per-model preflight outcomes in Model Scout state and make qualification stages visible through diagnostics.
- [x] Preserve each provider's last successful Model Scout snapshot when catalog discovery fails transiently; a successful empty catalog still correctly removes missing models.
  - Unit coverage checks rate-limit/error preservation versus a successful empty response.
- [ ] Add repeatable role-specific benchmarks for reasoning, code, structured output, tool calling, long context, and verifier behavior.
- [ ] Track latency, empty responses, errors, rate limits, and last successful probe per model in the scout registry.
- [ ] Complete APINEX account quota, terms, privacy, and successful real-request verification before enabling it as a default route.
- [ ] Require explicit operator approval before promoting a newly discovered provider into normal production routing.

## P1 — reliability and observability

- [x] Create a deterministic end-to-end suite that runs against safe test tasks, a loopback mock provider, and an isolated test database where needed.
  - Runtime CI validates health/auth/task acceptance, full delegated execution, independent verification, and verification-failure recovery/retest without contacting real AI providers.
- [ ] Add success-rate, time-to-completion, provider-fallback, and stuck-task metrics.
- [ ] Test concurrent tasks and recovery from provider/browser outages.
- [x] Verify PostgreSQL restart recovery and event ordering against a real test database.
  - PostgreSQL 18 CI verifies durable task snapshots, atomic rollback of a partially failing batch, event-time ordering, and an actual Node runtime process restart. A persisted running task is normalized to `failed / SERVICE_RESTART_INTERRUPTED`, while a configuration-blocked task remains `waiting`.
- [x] Await persistence for critical task-state transitions; revert in-memory state if the snapshot write fails.
- [x] Persist internal office-audit, evidence-smoke, recovery-smoke, and Pognali-audit task acceptance before starting workers or returning acceptance.

## P2 — developer experience

- [ ] Document API contracts and the complete task lifecycle.
- [ ] Improve human-readable error messages and diagnostics.
- [ ] Keep the internal architecture extensible without exposing its complexity to end users.

## Deferred by design

- [ ] Build the user interface only after runtime reliability gates pass. The first product task should be for AI-ОФИС to build its own UI, using the stable API contract and audit findings.


## Live baseline observed during the October 20, 2026 audit

- The deployed Render service still points at `main` commit `9f0a90c27d5b387b451a2856babdec27422528ff`; the audit branch is not deployed.
- A read-only request to the deployed `/health` endpoint exposed provider order, AI configuration state, tool counts, GitHub-tool state, and browser bridge/automation configuration. A read-only request to deployed `/api/employees` returned full employee model pools without authentication. The audit branch guards `/api/employees` and keeps public health responses minimal; regression tests cover both boundaries.
- Render logs from October 19 show a real root task whose first independent verification failed, followed by recovery, successful re-verification, and root completion with persisted evidence count 3. Another root task reached verification pass and completion with evidence count 6. This is evidence of a live task/recovery lifecycle, but not a current-day deployment validation.
- Current-day read-only endpoint checks initially returned HTTP 503, then `/health` responded successfully. Render metrics/logs for October 20 were empty at audit time; the service may have been idle or waking from the free-tier sleep cycle. A fresh authenticated end-to-end task run has not been executed against the deployed service.
- Direct read-only SQL verification of persisted task rows remains blocked because the PostgreSQL IP allowlist is empty. No allowlist, database, plan, or deployment settings were changed.
- The Render PostgreSQL instance `ai-office-monitor-db` has a reported expiration date of October 31, 2026. Back up/export or extend/upgrade the database before that deadline; this repository audit cannot perform that account-level change.

These observations are evidence from the deployed `main` runtime and must not be interpreted as proof that the audit-branch fixes are live.
