# Universal AI Studio — Neon Foundation

Status: provisioned and schema-verified on 2026-11-07.

## Isolated database

- Neon project: `universal-ai-studio`
- Project ID: `flat-grass-65416312`
- Region: `aws-eu-central-1` (Frankfurt)
- PostgreSQL: 17
- Default branch: `main`
- Branch ID: `br-quiet-dust-bal99f66`
- Database: `studio_db`
- Database role: `studio_owner`

This is a new standalone Neon project. It is not a child branch of the legacy `ai-office` project and contains no copied application records. The existing `ai-office` and `pognali` projects were not modified.

## Applied migrations

The six checked-in migrations from `studio/storage/migrations/` were applied atomically in one transaction to the new database:

1. `001_initial.sql` — projects, specialists, tasks, executions, artifacts, events.
2. `002_director_plans.sql` — Director plans and task-plan association.
3. `003_qa_reviews.sql` — independent QA review records.
4. `004_transactional_outbox.sql` — transactional outbox.
5. `005_worker_leases_and_fencing.sql` — leases and fencing tokens.
6. `006_organizations_and_memberships.sql` — organizations, owner/admin/member memberships and scope constraints.

## Verification evidence

Read-only verification after commit returned:

- 11 tables in schema `studio`
- 105 columns
- 26 indexes
- 16 foreign-key constraints
- 0 organization rows
- 0 event rows

The database was empty before migration. No production records were copied or seeded. The six migration files are the source of truth; the Neon database is the isolated provisioned target.

## Security and deployment boundary

- Do not commit connection strings, passwords, API keys, or tokens.
- Do not replace the legacy `DATABASE_URL`. The new runtime must use a distinct secret such as `STUDIO_DATABASE_URL`.
- Neon Auth is not provisioned or wired.
- No Render service or environment variable has been changed.
- No production deployment has been performed.
- No model provider credentials have been configured.
- The new schema is ready for the next integration step, but the live Studio runtime is not yet connected.

## Next controlled steps

1. Configure an identity provider and verified owner identity for the Studio control plane.
2. Configure a dedicated Render service for the Studio branch, with `STUDIO_DATABASE_URL` stored as a secret.
3. Wire the Express control plane, authenticated routes, model gateway, repository artifact adapter, and outbox dispatcher into that service.
4. Run a non-billable health/readiness check, then request explicit approval before any live model execution or product artifact creation.
