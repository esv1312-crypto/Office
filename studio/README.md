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
- `director/` — planning and delegation (next phase).
- `agents/` — specialist, worker, and QA runtimes (later phases).
- `gateways/` — model and tool adapters (later phases).
- `governance/` — permissions and approvals (later phases).
- `product-profiles/` — Roblox, web, mobile, SaaS, and future product domains.

## Local verification

Run the initial domain tests from the repository root:

```sh
node --test studio/core/task-state.test.js
```

This is a deliberately small first slice. It is not yet connected to HTTP routes, PostgreSQL, model providers, or production workers.
