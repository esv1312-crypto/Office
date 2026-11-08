# AI Office cost-efficiency and execution policy

This policy is part of the Universal AI Studio runtime. It applies to every product profile, not only Roblox.

## Operating principle

The model is the decision and generation layer. The cloud runtime is the execution layer.

Use model tokens only when a task needs interpretation, planning, code/content generation, or a genuinely ambiguous decision. Use deterministic cloud tools for repository operations, file reads/writes, database queries, formatting, builds, tests, validators, checksums, diffing, artifact read-back, and evidence collection.

A successful tool call or a model statement is not proof of completion. Persisted output must be read back and independently checked against acceptance criteria.

## Default worker limits

- 8 model/tool rounds per task.
- 16 total tool calls per task.
- 12 KiB maximum per tool result.
- 128 KiB cumulative tool-result context.
- 12,000 cumulative output tokens per task.
- 100,000 cumulative prompt tokens per task.
- Keep worker concurrency at 2 unless measured queue latency justifies a change.
- Large assignments must be decomposed into smaller independently verifiable tasks; never raise limits as a substitute for decomposition.

These are safety ceilings, not targets. A healthy task should normally finish well below them.

## Model budget rules

- Every model request reserves budget before it is sent.
- The reservation ledger is the source of truth; denormalized account totals are refreshed from it.
- Record the provider-reported cost when available, even if it exceeds the estimate. Never clamp real cost to the reservation.
- If a request fails ambiguously after it may have reached the provider, settle its reservation at the reserved maximum. Do not silently release potentially billable work.
- Reservations older than 15 minutes are conservatively reconciled as spent, protecting against crashes between provider completion and database settlement.
- Keep a hard owner-approved cap. Exhaustion blocks new paid requests; no automatic cap increase or model fallback is permitted.
- Configure `STUDIO_MODEL_INPUT_USD_PER_MILLION` and `STUDIO_MODEL_OUTPUT_USD_PER_MILLION` from the current selected provider/model rates. The defaults are intentionally conservative and must not be represented as the provider's invoice price.

## Startup and recovery

Startup owner tasks are one-shot. A Render deploy must never implicitly restart an already claimed owner task. Resuming interrupted work requires a separately governed recovery action that checks task leases, idempotency, existing artifacts, remaining budget, and prior attempts before dispatching anything.

Never start a second copy of a plan while its existing execution is active. Expired worker leases may be recovered only through the durable execution recovery mechanism and must retain fencing-token checks.

## Verification gates

1. Validate task scope and acceptance criteria before dispatch.
2. Read only the source files needed for the assigned change.
3. Execute repository writes directly through cloud tools with branch and SHA checks.
4. Read back every persisted artifact.
5. Run deterministic syntax checks, unit tests, integration tests, and CI where applicable.
6. Require independent QA to inspect persisted evidence, not worker narrative.
7. Retry only a specific failed criterion, with a bounded attempt count.
8. Report exact changed paths, commit/PR, test evidence, remaining blockers, and measured model usage/cost.

## Efficiency metrics

Track per task: provider requests, input/output tokens, provider-reported cost, reserved amount, tool calls, retries, wall-clock duration, files changed, tests run, QA verdict, and whether the deliverable passed read-back.

Optimize for cost per accepted deliverable, not cost per model call or number of agent messages.
