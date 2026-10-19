# AI-ОФИС: reliability and product roadmap

This roadmap is based on the source audit of the current runtime. It is a working checklist, not a claim that every item has been completed.

## Product decision

Do not build the user-facing interface yet. First make the existing runtime reliable and observable. The first real task assigned to the office after this foundation is stable should be to design and implement its own user interface against documented backend contracts.

## P0 — correctness and safe operation

- [x] Browser requests must reach a terminal blocked state when execution is disabled or credentials are absent.
- [x] Add unit tests for browser readiness, approval gating, and unsupported actions.
- [x] Add CI execution for the Node.js test suite.
- [ ] Make verification fail closed when the verifier output lacks required evidence or contradicts authoritative task state.
- [ ] Add tests for task-state transitions, watchdog recovery, retries, and root-task completion.
- [ ] Verify all sensitive API routes require appropriate authentication and never expose credentials.
- [ ] Fix browser status semantics and ensure pending requests are recoverable after restart, or explicitly document them as ephemeral.

## P1 — model quality and resource scout

- [x] Keep model discovery separate from model qualification: discovered does not mean tested.\n- [ ] Add explicit per-model probe results and prevent unqualified models from becoming preferred routes.
- [ ] Add repeatable benchmark tasks for reasoning, code, structured output, tool calling, long context, and verifier behavior.
- [ ] Track latency, empty responses, error rates, rate limits, and last successful probe per model.
- [x] Add a PostgreSQL-backed registry for known catalog sources with availability, HTTP status, last-check time, and safe metadata.\n- [ ] Expand catalog parsing into individual API records with authentication requirements, pricing evidence, terms, rate limits, privacy notes, and qualification tests.
- [x] Add APINEX as an optional OpenAI-compatible provider and discover only IDs explicitly prefixed free/.\n- [ ] Verify APINEX account quota and terms with the owner before adding an API key or using it in production.
- [ ] Require explicit approval before adding a provider to production routing or changing billing/security configuration.

## P1 — reliability and observability

- [ ] Create a small deterministic end-to-end suite that runs against a safe test task.
- [ ] Add success-rate, time-to-completion, provider-fallback, and stuck-task metrics.
- [ ] Confirm task snapshots survive restart and reconcile correctly with in-memory state.
- [ ] Test concurrent tasks and recovery from provider/browser outages.

## P2 — developer experience

- [ ] Document API contracts and task lifecycle.
- [ ] Improve human-readable error messages and diagnostics.
- [ ] Keep the internal architecture extensible without exposing its complexity to end users.

## Deferred by design

- [ ] Build the user interface only after the runtime reliability gates pass. The first product task should be for AI-ОФИС to create its own UI, using the stable API contract and the audit findings.
