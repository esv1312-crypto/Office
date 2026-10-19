# AI-ОФИС: reliability and product roadmap

A checked item means the code change and its stated automated checks exist in the audit branch. It does **not** mean the code is deployed or that a live external-provider workflow has been proven.

## Product decision

Do not build the user-facing interface yet. First make the existing runtime reliable and observable. Once the reliability gates pass, the first product task assigned to AI-ОФИС should be to design and implement its own user interface against documented backend contracts.

## P0 — correctness and safe operation

- [x] Browser requests reach a terminal blocked state when automation or credentials are unavailable.
- [x] Browser callbacks use per-request random tokens, hidden from snapshots and consumed after a valid callback; token replay is rejected.
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
- [x] Root recovery installs the replacement result before re-verifying it.
- [x] Worker recovery is single-flight to prevent duplicate replacement tasks.
- [x] Accepted, planning, and running tasks without a persisted resumable queue become explicitly interrupted after restart; configuration-blocked tasks remain waiting.
- [x] Remote backend calls send the required audit header, skip unauthenticated calls, and always clear timeout timers.
- [x] Event IDs remain monotonic across capped in-memory history and database restores.
- [x] PostgreSQL event history is retained and loaded by event timestamp rather than insertion timing.
- [x] Database writes are serialized and drained when the process shuts down gracefully.
- [x] Refuse startup when `DATABASE_URL` is configured but PostgreSQL initialization fails, instead of silently running without persistence.
- [x] Persist root-task acceptance before returning HTTP 202; return HTTP 503 if the initial snapshot cannot be stored.
- [x] Persist API-created and internally planned subtask batches transactionally before starting workers; roll back the batch and reject acceptance if persistence fails.
- [x] Persist replacement workers and root-recovery tasks before execution, including the recovery task’s parent link.
- [x] CI syntax checks cover runtime, test, and script files; `npm test` runs syntax checks before unit tests.
- [x] Protected audit/control routes now accept audit credentials through headers rather than query strings; the one-time browser callback token remains supported because the browser provider receives a callback URL and the token is per-request.
- [x] The manual `office-live-test.yml` workflow now requires `secrets.OFFICE_AUDIT_TOKEN` and sends it in `x-ai-office-audit-token`; a unit test guards this contract.
- [ ] Finish the route-by-route authorization review, including every remaining manual workflow and external callback configuration.
- [x] Validate the entire subtask batch before creating any children, so one malformed item cannot leave partial work running.
- [x] Bound numeric runtime settings so invalid environment values cannot produce a NaN worker limit or near-zero recurring timer.
- [x] Expose PostgreSQL enabled/ready state in `/health` and authenticated `/api/state` diagnostics.
- [ ] Add deterministic integration tests for watchdog recovery, retries, and root-task completion.
- [ ] Add explicit checks for contradictions between verifier claims and authoritative runtime state.
- [ ] Persist pending browser requests or document the exact recovery behavior when the process restarts mid-browser workflow.
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
- [ ] Add repeatable role-specific benchmarks for reasoning, code, structured output, tool calling, long context, and verifier behavior.
- [ ] Track latency, empty responses, errors, rate limits, and last successful probe per model in the scout registry.
- [ ] Complete APINEX account quota, terms, privacy, and successful real-request verification before enabling it as a default route.
- [ ] Require explicit operator approval before promoting a newly discovered provider into normal production routing.

## P1 — reliability and observability

- [ ] Create a deterministic end-to-end suite that runs against a safe test task and isolated/test database.
- [ ] Add success-rate, time-to-completion, provider-fallback, and stuck-task metrics.
- [ ] Test concurrent tasks and recovery from provider/browser outages.
- [ ] Verify PostgreSQL restart recovery and event ordering against a real test database.
- [x] Await persistence for critical task-state transitions; revert in-memory state if the snapshot write fails.
- [x] Persist internal office-audit, evidence-smoke, recovery-smoke, and Pognali-audit task acceptance before starting workers or returning acceptance.

## P2 — developer experience

- [ ] Document API contracts and the complete task lifecycle.
- [ ] Improve human-readable error messages and diagnostics.
- [ ] Keep the internal architecture extensible without exposing its complexity to end users.

## Deferred by design

- [ ] Build the user interface only after runtime reliability gates pass. The first product task should be for AI-ОФИС to build its own UI, using the stable API contract and audit findings.
