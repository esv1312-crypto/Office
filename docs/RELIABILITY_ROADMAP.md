# AI-ОФИС: reliability and product roadmap

This roadmap tracks the current runtime hardening work. A checked item means a code change or test exists; it does not imply production deployment or successful live-provider operation.

## Product decision

Do not build the user-facing interface yet. First make the existing runtime reliable and observable. Once the reliability gates pass, the first product task assigned to AI-ОФИС should be to design and implement its own user interface against documented backend contracts.

## P0 — correctness and safe operation

- [x] Browser requests reach a terminal blocked state when automation, credentials, or webhook authentication are unavailable.
- [x] Sensitive browser approvals are not exposed to model-facing tool results.
- [x] Browser completion callbacks require authentication.
- [x] Add unit tests for browser readiness, approval gating, and unsupported actions.
- [x] Add CI execution for dependency-free unit tests and JavaScript syntax checks.
- [x] Make verification fail closed when required evidence fields are missing or a claim is classified as an assumption/unproven.
- [x] Extract task-state transition rules and add lifecycle tests.
- [x] Normalize interrupted planning/running tasks after restart, persist the corrected snapshots, and retain interruption events in newest-first order.
- [x] Protect internal gateway, employee, tool, browser, model, and resource diagnostics with the existing auth guard.
- [ ] Add deterministic tests for watchdog recovery, retries, and root-task completion.
- [ ] Add explicit checks for contradictions between verifier claims and authoritative runtime state.
- [ ] Finish a route-by-route authorization review, including all webhook and query-token handling.
- [ ] Confirm task snapshots survive restart and reconcile with in-memory state; document or persist pending browser requests.

## P1 — model quality and resource scout

- [x] Keep model discovery separate from model qualification: discovered does not mean tested.
- [x] Tighten free-model classification so missing pricing fields are not treated as proof of free access.
- [x] Add APINEX as an optional OpenAI-compatible provider, restricted to explicit `free/*` model IDs.
- [x] Add a PostgreSQL-backed registry for known catalog sources with availability, HTTP status, last-check time, and safe metadata.
- [ ] Add explicit per-model probe results and prevent unqualified models from becoming preferred routes.
- [ ] Add repeatable benchmarks for reasoning, code, structured output, tool calling, long context, and verifier behavior.
- [ ] Track latency, empty responses, errors, rate limits, and last successful probe per model.
- [ ] Expand catalog parsing into individual API records with authentication requirements, pricing evidence, terms, rate limits, privacy notes, and qualification tests.
- [ ] Verify APINEX account quota and terms with the owner before adding an API key or using it in production.
- [ ] Require explicit approval before adding a provider to production routing or changing billing/security configuration.

## P1 — reliability and observability

- [ ] Create a deterministic end-to-end suite that runs against a safe test task.
- [ ] Add success-rate, time-to-completion, provider-fallback, and stuck-task metrics.
- [ ] Test concurrent tasks and recovery from provider/browser outages.

## P2 — developer experience

- [ ] Document API contracts and task lifecycle.
- [ ] Improve human-readable error messages and diagnostics.
- [ ] Keep the internal architecture extensible without exposing its complexity to end users.

## Deferred by design

- [ ] Build the user interface only after runtime reliability gates pass. The first product task should be for AI-ОФИС to build its own UI, using the stable API contract and audit findings.
