import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const databaseUrl = process.env.STUDIO_TEST_DATABASE_URL;

test("all Studio migrations apply cleanly to an isolated PostgreSQL database", {
  skip: !databaseUrl,
}, async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const migrationDirectory = path.join(directory, "migrations");
    const files = (await readdir(migrationDirectory))
      .filter(name => /^\d+_.+\.sql$/.test(name))
      .sort();

    assert.deepEqual(files, [
      "001_initial.sql",
      "002_director_plans.sql",
      "003_qa_reviews.sql",
      "004_transactional_outbox.sql",
      "005_worker_leases_and_fencing.sql",
      "006_organizations_and_memberships.sql",
    ]);

    for (const file of files) {
      const sql = await readFile(path.join(migrationDirectory, file), "utf8");
      await pool.query(sql);
    }

    const result = await pool.query(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'studio'
       ORDER BY table_name
    `);
    const tables = result.rows.map(row => row.table_name);
    for (const table of [
      "artifacts", "events", "executions", "organization_memberships",
      "organizations", "outbox_events", "plans", "projects", "qa_reviews",
      "specialists", "tasks",
    ]) {
      assert.ok(tables.includes(table), `missing studio.${table}`);
    }

    const columns = await pool.query(`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'studio'
         AND (table_name, column_name) IN (
           ('tasks', 'fencing_token'),
           ('executions', 'lease_token'),
           ('executions', 'lease_expires_at'),
           ('executions', 'heartbeat_at')
         )
    `);
    assert.equal(columns.rows.length, 4);
  } finally {
    await pool.end();
  }
});
