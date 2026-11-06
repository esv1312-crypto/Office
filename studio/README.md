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
- `governance/` — permissions and approvals.
- `product-profiles/` — Roblox, web, mobile, SaaS, and future product domains.
- `projects/` — product-specific briefs, plans, and build artifacts.

## Implemented in this foundation

- Project creation with explicit organization and product-profile ownership.
- Task creation in the initial `draft` state.
- A deterministic task lifecycle state machine.
- Versioned task status-change domain events.
- First product project: `projects/football-fans/`, with a map design brief and a Roblox Studio blockout generator.

## First product assignment: Football Fans

The first Roblox pilot is a social football-fan district, not just a football pitch.
Its first blockout includes Arrival Plaza, Fan Street, Supporters' Square, Fan Shop, Café, Mini Pitch, Stadium Forecourt, and Main Stadium.

See:
- `projects/football-fans/README.md`
- `projects/football-fans/map-design-v1.md`
- `projects/football-fans/roblox/BuildMap.server.lua`

## Local verification

Run all current domain tests from the repository root:

```sh
node --test studio/core/*.test.js
```

The map generator must be run and visually inspected in Roblox Studio before the map can be called play-tested. It does not publish or change a live Roblox experience.

This foundation is not yet connected to HTTP routes, PostgreSQL, model providers, or production workers.

## Existing runtime integration

- `gateways/office-runtime-client.js` is a thin, injectable HTTP client for the existing Office runtime.
- It submits root tasks to `POST /api/tasks`, reads task status from `GET /api/tasks/:id`, and can inspect `GET /api/state`.
- It sends the existing audit header but never stores or prints the token.
- It deliberately does not retry task submission: the current API has no idempotency key, so retrying a POST could create duplicate work.
- The adapter does not translate legacy runtime statuses into the new Studio task lifecycle. That mapping must be designed explicitly at the orchestration boundary.
- The adapter is not yet wired into the production Express server and has not been tested against the live runtime. Its unit tests use an injected fake fetch implementation.

This is the first integration seam. The next step is to add an isolated orchestration service that uses this client, validates permissions and project scope, and records the legacy runtime task ID without changing the production database or deployment.
