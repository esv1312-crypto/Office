# PostgreSQL backup and restore runbook

**Priority: urgent.** The Render database `ai-office-monitor-db` was reported as a Free PostgreSQL 18 instance expiring at `2026-10-31T18:13:43Z`. Confirm the current expiry/status in Render before acting. This runbook does not create a backup and must not be treated as proof that one exists.

## Safety rules

- Do not paste database URLs, passwords, dumps, or production rows into GitHub, issues, chat, logs, or CI artifacts.
- Do not run a dump against a guessed URL. Copy the external connection string from the database's Render Dashboard.
- Do not widen the IP allowlist to `0.0.0.0/0`. Add only the operator's current public IP as a `/32`, and remove that temporary entry after the backup if it is no longer needed.
- A successful `pg_dump` is not enough: verify the archive and perform a test restore before considering the backup usable.
- Do not delete, suspend, upgrade, or replace the source database until a restore has been verified and the runtime's database connection has been planned.

## 1. Confirm the source database

In Render Dashboard, open **ai-office-monitor-db** and confirm:
- status is available;
- the current expiry/plan;
- PostgreSQL major version;
- the database name and region;
- whether Render offers a native backup/export option for this instance.

Record the checked time and outcome in the operations log, but never record the connection string or password.

## 2. Allow a temporary, narrow external connection if needed

If using a local machine and the Render external connection string:
1. Determine the machine's current public IPv4 address.
2. In the database's **Networking / IP allowlist**, add only that address as `x.x.x.x/32`.
3. Copy the **External Database URL** from Render's Connect panel into a local shell environment variable. Do not commit it or save it in shell history.
4. If the database does not provide an external URL, stop and use a Render-supported backup/export path instead; do not invent a connection string.

An empty allowlist blocks external tools, including the hosted Render MCP connection. This repository's automation cannot bypass that network boundary.

## 3. Create a custom-format dump locally

Install PostgreSQL client tools compatible with PostgreSQL 18, then run in a private directory with enough free disk space:

```bash
umask 077
mkdir -p "$HOME/private-db-backups"
cd "$HOME/private-db-backups"
read -rsp "Paste Render External Database URL: " DATABASE_URL
echo
export DATABASE_URL
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --verbose --file="ai-office-monitor-$(date -u +%Y%m%dT%H%M%SZ).dump"
unset DATABASE_URL
```

If the connection URL supplied by Render does not already specify TLS and the server requires it, use Render's documented SSL connection settings; do not disable certificate verification as a workaround.

## 4. Verify the archive

Run these commands against the exact dump path:

```bash
pg_restore --list "ai-office-monitor-YYYYMMDDTHHMMSSZ.dump" > /tmp/ai-office-restore-list.txt
test -s /tmp/ai-office-restore-list.txt
sha256sum "ai-office-monitor-YYYYMMDDTHHMMSSZ.dump" > "ai-office-monitor-YYYYMMDDTHHMMSSZ.dump.sha256"
```

Keep the checksum next to the backup. Store at least one additional encrypted copy in a separate trusted location; do not place the dump in this repository.

## 5. Test restore into an isolated PostgreSQL 18 database

Use a separate local PostgreSQL 18 instance or a separately provisioned temporary database. Never restore over the production database.

```bash
createdb ai_office_restore_test
pg_restore --exit-on-error --no-owner --no-acl --dbname="postgresql://localhost/ai_office_restore_test" "ai-office-monitor-YYYYMMDDTHHMMSSZ.dump"
psql "postgresql://localhost/ai_office_restore_test" -v ON_ERROR_STOP=1 -c "SELECT current_database(), count(*) AS public_tables FROM information_schema.tables WHERE table_schema='public';"
```

Confirm the expected application tables exist and inspect representative task/event counts without exposing row contents. A successful restore into an isolated database is the minimum acceptance criterion.

## 6. Close out

- Confirm the dump exists, has a non-zero size, passes `pg_restore --list`, and has a recorded SHA-256 checksum.
- Confirm the isolated restore succeeded.
- Store backup location, checksum, restore-test time, and operator in a secure operations record.
- Remove the temporary IP allowlist entry if it is no longer required.
- Only after a verified backup exists, decide whether to extend/upgrade the source database or migrate to a new PostgreSQL instance. Update the runtime's `DATABASE_URL` through Render's secret/environment settings; never commit credentials.

## Current known blocker

At the time of the audit, Render reported the database as available, PostgreSQL 18, Free plan, with an expiry of **2026-10-31 18:13:43 UTC**, but the IP allowlist was empty. The hosted Render MCP query was rejected because no external IP was allowlisted. No dump or restore has been created or verified by this repository audit.
