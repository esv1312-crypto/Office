# Universal AI Studio — foundation v1

This directory is an isolated foundation for the next-generation universal studio.
It does not replace or import the existing production Office runtime.

## Guardrails

- The existing Express runtime, Neon database, and Render services are unchanged.
- This foundation is a modular monolith first; no premature microservices.
- Product-specific behavior belongs in product profiles, not in the core.
- AI providers and tools are accessed through gateways; domain logic must not depend on a vendor SDK.
- Workers produce artifacts and evidence; QA is a separate role and cannot self-approve.
- Actions with external cost, production impact, destructive effects, or permission changes require owner approval.
- Durable execution, leases, audit events, and database persistence must be designed before autonomous production work.

## First vertical slice

The first end-to-end workflow is:

1. Create a project.
2. Create a task and a plan.
3. Assign a specialist.
4. Start a worker execution.
5. Record an artifact and evidence.
6. Run independent QA.
7. Complete or return the task for revision.

## Initial layout

- `contracts/` — stable domain contracts.
- `core/` — deterministic domain logic with no provider or database dependency.
- `director/` — planning and delegation.
- `agents/` — specialist, worker, and QA runtimes.
- `gateways/` — model and tool adapters.
- `storage/` — database migrations and persistence adapters.
- `governance/` — permissions and approvals.
- `product-profiles/` — Roblox, web, mobile, SaaS, and future product domains.
- `projects/` — product-specific briefs, plans, and build artifacts.

## Implemented in this foundation

- Project creation with explicit organization and product-profile ownership.
- Task creation in the initial `draft` state.
- A deterministic task lifecycle state machine.
- Versioned task status-change domain events.
- A provider-neutral Worker Runtime contract with injected durable-store and model-gateway dependencies.
- A PostgreSQL migration for an isolated `studio` schema.
- A transactional PostgreSQL execution-store adapter for claiming assigned tasks, persisting executions, storing artifacts, and writing events.
- Tests authored for Worker Runtime behavior and PostgreSQL task-claim transaction behavior. They have not yet been executed in this branch.
- First product project: `projects/football-fans/`, with a map design brief and a Roblox Studio blockout generator.

## Worker Runtime boundary

`agents/worker-runtime.js` is the first independent execution component of the new Studio. It:

1. Requires the durable store to atomically claim an already-assigned task and create an execution.
2. Calls an injected `modelGateway.generate()`; it does not depend on OpenAI, OpenRouter, or another vendor SDK.
3. Rejects empty model output.
4. Sends successful output and a text artifact to the durable store.
5. Requires the store to confirm that the task entered `qa` and the artifact was persisted.
6. Records model execution failures through the store.

## PostgreSQL persistence boundary

- `storage/migrations/001_initial.sql` creates an isolated `studio` schema with projects, specialists, tasks, executions, artifacts, and events.
- `storage/postgres-execution-store.js` accepts an injected pg-compatible pool and uses transactions and row locks to claim assigned work and persist execution outcomes.
- The adapter does not create a pool, read environment variables, apply migrations, or silently fall back to memory.
- A dedicated Studio database/schema must be provisioned and migration 001 explicitly applied before this adapter can be used.
- The migration has not been applied to Neon or any other database. No database was connected or modified.
- Project, specialist, task creation repositories and lease expiry/recovery are still to be implemented.

## First product assignment: Football Fans

The first Roblox pilot is a social football-fan district, not just a football pitch.
Its first blockout includes Arrival Plaza, Fan Street, Supporters' Square, Fan Shop, Café, Mini Pitch, Stadium Forecourt, and Main Stadium.

See:
- `projects/football-fans/README.md`
- `projects/football-fans/map-design-v1.md`
- `projects/football-fans/roblox/BuildMap.server.lua`

## Local verification

Run the current tests from the repository root:

```sh
node --test studio/**/*.test.js
```

Tests have been authored but are not yet confirmed as executed in this branch. Do not describe them as passing until they have actually run.

The map generator must be run and visually inspected in Roblox Studio before the map can be called play-tested. It does not publish or change a live Roblox experience.

The new foundation is not yet connected to HTTP routes, a live database, live model providers, or production workers.

## Legacy Office adapter — isolated and optional

The following files are retained as an experimental integration seam, not as the foundation of the new execution architecture:

- `gateways/office-runtime-client.js` — HTTP client for the existing Office runtime.
- `orchestration/submit-office-task.js` — governed hand-off to the legacy Chief/root-task endpoint.

They are not wired into the new Worker Runtime, production Express server, Neon, or Render. No live legacy task has been submitted. The new Studio must be able to execute independently; the legacy adapter may be removed or used only for a separately approved migration.

## Dynamic specialists and governed assignment

- `contracts/specialist.js` defines a validated, versioned specialist contract with organization ownership, competencies, instructions, allowed tools, model profile, and lifecycle status.
- `core/create-specialist.js` creates specialist definitions deterministically without selecting a model or connecting to infrastructure.
- `orchestration/assign-task.js` checks active status, organization/project scope, required competencies, and an injected authorization decision before asking the durable store to assign work.
- `storage/postgres-assignment-store.js` performs assignment in a PostgreSQL transaction, locks the task and specialist rows, checks the task version and organization boundary, validates competencies again at the persistence boundary, and records `task.assigned`.
- Tests have been added for specialist creation and assignment policy. They have not been executed in this branch.
- Specialist records and task records still need creation/repository adapters; no database has been provisioned or changed.

## Durable domain repositories

- `storage/postgres-domain-store.js` persists projects, specialists, and draft tasks using an injected PostgreSQL pool.
- Each creation operation writes its corresponding `*.created` event in the same transaction.
- Task creation verifies that its parent project exists and is active; specialist competencies and allowed tools are stored in the specialist JSONB payload.
- Tasks can declare `requiredCompetencies`; assignment checks these requirements both in the orchestration policy and again in the database adapter.
- `storage/postgres-domain-store.test.js` covers transactional creation and rejection when the parent project is missing. Tests are authored, not yet executed.
- This is a repository adapter, not a connected database: no Neon schema, Render service, production runtime, or live AI provider has been touched.

## AI Director — proposed planning

- `director/director-runtime.js` accepts an owner request, checks authorization and project status, and calls an injected `planningGateway.generatePlan()`.
- The Director validates the structured proposal, captures a model snapshot, and creates a proposed plan plus draft tasks with explicit required competencies and acceptance criteria.
- `storage/migrations/002_director_plans.sql` adds durable plan records and a nullable task-to-plan relationship. Apply migration 001 first; neither migration has been applied to any database.
- `createPlanWithTasks()` in `storage/postgres-domain-store.js` persists the plan, all draft tasks, and their events in one transaction.
- A plan remains `proposed`: the Director does not approve it, assign specialists, or start Workers. Owner approval and a governed dispatch workflow are the next required controls.
- Director runtime and plan-persistence tests are authored but have not been executed.

## Owner approval gate

- `governance/approve-plan.js` requires a separate authorization decision for `director.plan.approve`; the Director cannot approve its own proposal.
- `approvePlan()` locks the proposed plan and all its draft tasks in one transaction, changes the plan to `approved`, moves its tasks to `planned`, and writes audit events.
- A plan cannot be approved twice or if its tasks are no longer all in draft.
- The approval gate and PostgreSQL transaction tests are authored but have not been executed.
- Approval is implemented as a capability; no plan has actually been approved and no task has been dispatched.

## Director dispatch

- `director/director-dispatch.js` loads only approved plans in active projects, checks a separate `director.plan.dispatch` authorization decision, and retrieves active specialists from the same organization.
- Specialist selection is deterministic: all required competencies and project scope must match; ties prefer the specialist with fewer unrelated competencies, then stable ID order.
- Tasks without a compatible specialist remain planned and are reported as blocked. Already assigned or later-stage tasks are skipped.
- A selected task is transactionally moved from `planned` to `ready`, then passed through the governed assignment service; the PostgreSQL assignment adapter performs final organization, project, competency, and version checks before assigning it.
- If assignment fails after readiness, the task remains `ready` for safe retry; dispatch reports the failure rather than pretending it was assigned.
- Dispatch does not start Workers or call model providers. Worker execution and independent QA remain separate steps.
- `director/director-dispatch.test.js` covers deterministic matching, missing skills, denied authorization, and idempotent skipping behavior. Tests are authored but have not been executed.

## Independent QA gate

- `agents/qa-runtime.js` accepts a task, artifact, and active reviewer, checks `task.qa.review` authorization, and invokes an injected QA gateway with the task acceptance criteria and artifact evidence.
- The producer cannot review their own artifact. The runtime accepts only explicit `accepted` or `revision_required` verdicts and requires a model snapshot and structured findings.
- `storage/migrations/003_qa_reviews.sql` adds a durable QA review ledger. Apply migrations 001, 002, then 003 to a dedicated Studio database before using the adapter; none has been applied.
- `storage/postgres-qa-review-store.js` records the verdict, reviewer, producer, findings, model snapshot, and audit event in one transaction. It independently verifies that the artifact belongs to the task, the reviewer is active, belongs to the same organization, has the `qa.review` competency, and is not the producer.
- An accepted result moves the task from `qa` to `completed`. A revision request moves it back to `ready`, clears the assignee, and preserves findings so it can be assigned for another attempt.
- QA runtime tests cover approval, revision, self-review prevention, authorization denial, and invalid verdicts. They are authored but have not been executed.
- The QA gateway and database adapter are not wired to a live model, HTTP endpoint, or database. The end-to-end workflow is not yet running.

## Approved-plan execution coordinator

- `orchestration/run-approved-plan.js` coordinates the existing Director Dispatch, Worker Runtime, and independent QA Runtime in sequence for each assigned task.
- It loads the assigned task and specialist from the domain directory, starts the Worker, and only hands successful artifacts to QA.
- QA reviewer selection is deterministic and requires an active specialist in the same organization, with project access, the `qa.review` competency, and an ID different from the producer.
- Missing reviewers, failed Workers, and revision-required QA verdicts are reported as `needs_attention`; the coordinator does not falsely mark the plan complete.
- `storage/postgres-domain-store.js` now exposes task and specialist read methods used by this coordinator.
- Tests cover a successful Worker-to-QA pass, Worker failure, missing QA reviewer, and QA-requested revision. Tests are authored but have not been executed.
- This is an orchestration component, not a live service: no API endpoint, model gateway implementation, worker process, or database connection has been wired. It still requires an application composition root and a safe integration test environment.
