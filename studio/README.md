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

## Application composition root

- `application/create-studio-runtime.js` now assembles the PostgreSQL domain, assignment, execution, and QA stores with Director, approval, dispatch, Worker, QA, and plan-workflow services.
- Construction requires explicit injection of a migrated PostgreSQL pool, ID generators, governance authorization, and three provider-neutral gateways (planning, Worker generation, and QA review).
- The composition root performs no connection, query, migration, provider call, or deployment by itself. This makes dependency wiring explicit and testable.
- `application/create-studio-runtime.test.js` verifies all services are composed and construction does not connect to the database. Tests are authored but have not been executed.
- The composition root is not yet exposed through an HTTP API or connected to the running legacy Office server. A real deployment still requires an approved dedicated database, configured gateways, route-level authentication, and isolated integration tests.

## Isolated CI verification

- `.github/workflows/studio-isolated-tests.yml` runs on pushes to `studio-v1-foundation` affecting Studio files, pull requests affecting Studio files, or manual dispatch.
- It uses Node.js 22, checks JavaScript syntax under `studio/`, then runs `node --test studio`.
- The workflow has read-only repository permissions and does not read secrets, connect to Neon/Render, invoke model providers, or touch the legacy Office runtime.
- The workflow has been added but its execution result has not yet been confirmed in this session. Do not treat authored tests as passing until a completed Actions run is inspected.

## Reliable event delivery — transactional outbox foundation

- `storage/migrations/004_transactional_outbox.sql` adds an isolated outbox ledger for reliable delivery of domain events to Workers, monitoring, and future integrations.
- The schema stores a stable event ID, organization/project scope, aggregate identity, event type, payload, schema version, correlation ID, retry timing, attempt count, publication timestamp, and a time-limited claim token.
- The pending-event index supports a future dispatcher using PostgreSQL `FOR UPDATE SKIP LOCKED`; expired claims can be safely reclaimed by a lease-aware dispatcher.
- Event producers must insert the domain journal event and matching outbox row in the same database transaction. Consumers must deduplicate by `event_id`; delivery is at-least-once, not exactly-once.
- Migration 004 depends on migrations 001-003 and has not been applied to any database. No dispatcher is wired yet, and no live event has been published.


## Worker leases, fencing, and recovery — foundation v1

- `storage/migrations/005_worker_leases_and_fencing.sql` adds a monotonic task fencing token and execution lease metadata. Apply it only after migrations 001-004 to a dedicated Studio database; it has not been applied anywhere.
- Starting an execution increments the task fencing token and creates a unique lease token with an expiry. The Worker receives both credentials.
- `heartbeatExecution()` renews a lease only while the same execution/token is current and the previous lease has not expired.
- Completion and failure require the matching fencing token and lease token and reject expired or superseded executions. This prevents a stale Worker from committing after recovery or reassignment.
- `recoverExpiredExecutions()` locks expired executions/tasks with `FOR UPDATE SKIP LOCKED`, marks the old execution failed, returns its task to `assigned`, and writes an audit event plus outbox event in the same transaction.
- `governance/recover-expired-executions.js` places recovery behind the separate `execution.recover` authorization action. The composition root exposes this as `runtime.recovery.recover()`.
- Lease heartbeat is an explicit capability; a long-running Worker host must call it periodically while generation is in progress. No timer/worker host or periodic recovery scheduler is wired yet.
- These changes are code and isolated tests only. Migration 005 has not been applied, no real Worker has claimed a task, and no database recovery has been exercised.

- Worker Runtime now renews the lease while a model gateway call is in progress, passes an abort signal to gateways, and refuses to persist output if heartbeat reports a lost lease. The worker host still needs a separate governed maintenance invocation to recover expired tasks.


## Bounded Worker Pool

- `agents/worker-pool.js` consumes Director-approved assignments and runs a configurable number of Workers concurrently (default 2, maximum 32).
- Each assignment is re-read from the durable directory immediately before execution; stale task/specialist assignments are rejected before a Worker starts.
- Individual Worker failures are isolated and reported without cancelling unrelated assignments.
- The approved-plan workflow now delegates execution to this pool, then sends successful artifacts to independent QA.
- The pool is an in-process execution coordinator, not yet a separate always-on service. PostgreSQL remains responsible for atomic task claim, lease/fencing, and durable state. A hosted Worker process and scheduled recovery/outbox loops remain to be wired.
- Unit tests cover concurrency limits, failure isolation, and stale assignment rejection.

## Provider-neutral model gateway adapter

- `gateways/openai-compatible-gateways.js` adapts an explicitly supplied OpenAI-compatible client to the Director, Worker, and QA gateway contracts.
- Planner and QA requests use structured JSON mode; Worker requests return text artifacts.
- Each response carries a provider/model/instruction-version/parameter snapshot for execution audit.
- Empty and malformed structured responses receive stable error codes; Worker calls receive the execution abort signal.
- The adapter does not create an SDK client, read environment variables, retrieve credentials, or call a provider during construction. The host application must supply a configured client and distinct model settings for planner, Worker, and QA.
- `application/create-configured-studio-runtime.js` composes these gateways with the existing Studio runtime. It does not connect to PostgreSQL or invoke models until a workflow method is called.
- Gateway and composition tests have been authored; their execution has not been confirmed in this branch.

## Owner workflow HTTP application boundary

- `http/studio-http-handlers.js` provides HTTP-framework-neutral handlers for creating a Director plan, approving a persisted plan, and executing an approved plan.
- Authentication context and secure project/plan lookups are injected by the host application. Client-supplied project/plan objects are not trusted.
- Execution is rejected unless the server-loaded plan is already approved by the owner.
- These are application handlers, not mounted Express routes. No endpoint is currently exposed by the running Office service.
- The host still needs to supply route authentication, project/plan lookup adapters, request limits, error mapping, and rate limiting before mounting these handlers.
- Handler tests have been authored but have not been executed in this branch.

## Current integration boundary and next gate

The new Studio now has a composition path from model gateways through Director, Worker, and QA, plus owner workflow handlers. It is still an isolated foundation and is **not yet an autonomous running office**.

Before any live task:
1. Confirm the exact dedicated database target and apply migrations 001-005 only after explicit owner approval.
2. Supply the existing approved model-provider credential through the host's secret manager; never copy it into source code, commits, logs, or chat.
3. Configure and verify distinct planner, Worker, and QA models with bounded output and cost controls.
4. Implement a real authorization policy and authenticated route mounting; the current handlers intentionally require these dependencies.
5. Provision initial project and independent specialists, including a QA specialist with `qa.review` competency.
6. Run isolated PostgreSQL integration tests and a deliberately small, owner-approved end-to-end task before claiming autonomous execution.

No Studio migration has been applied, no live model call has been made through this new adapter, no new Studio task has been executed, and no production service has been changed.


## Express owner workflow adapter

- `http/create-studio-express-router.js` adapts the framework-neutral owner handlers to Express routes for plan creation, owner approval, and approved-plan execution.
- Every route requires injected authentication middleware and rate-limit middleware. The authenticated actor is passed through the secure project/plan lookup functions and governance checks.
- Handler failures are forwarded to the host application's centralized Express error middleware; the adapter does not expose stack traces or invent an error response format.
- The host application must still configure bounded JSON request bodies and a centralized safe error handler.
- This router is not mounted in the legacy Express server. It has isolated adapter tests only; no database, model provider, production route, or deployment was touched.


## Organization identity and access boundary

- Migration `006_organizations_and_memberships.sql` adds organizations and explicit owner/admin/member/observer memberships. It adds organization foreign keys to projects and specialists.
- `governance/postgres-access-control.js` provides membership-scoped project and plan lookup plus a deny-by-default authorization policy.
- The identity provider remains an injected host responsibility. Its verified, stable subject must be mapped to `request.auth.actor.id`; the shared legacy audit token is not an end-user identity.
- Plan approval, dispatch, and execution are owner-only. Plan creation is available to active members; task assignment and QA review are limited to owners/admins.
- Global studio recovery is denied by this project-scoped policy until a separately scoped administrative recovery workflow exists.
- Migration 006 has not been applied. No identity provider, credentials, production route, database, or deployment has been connected.


## Composed Studio control plane

- `application/create-studio-control-plane.js` now composes the PostgreSQL membership policy, configured planning/Worker/QA gateways, Studio runtime, and guarded Express router.
- The host must inject a verified identity-provider middleware that maps the provider's stable subject to `request.auth.actor.id`, plus a rate limiter and bounded request/error middleware.
- Apply migrations in order: 001 initial schema, 002 plans, 003 QA reviews, 004 transactional outbox, 005 worker leases/fencing, then 006 organizations/memberships. These migrations have not been applied.
- Before creating projects, provision an organization row and an `owner` membership whose `actor_id` exactly matches the verified identity-provider subject. Do this through a separately reviewed administrative provisioning step; the runtime does not self-assign ownership.
- The returned router is not mounted automatically. The caller must mount it only in an approved isolated host after migrations 001-006 have been applied to a dedicated database and initial organization/owner membership have been provisioned.
- Composition performs no database query, migration, model request, server mount, or deployment. The provider client and pool are injected by the host.
- This completes code-level dependency composition, not live deployment or autonomous execution.
