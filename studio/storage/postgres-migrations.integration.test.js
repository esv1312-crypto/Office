import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createStudioRuntime } from "../application/create-studio-runtime.js";
import { createStudioBootstrap } from "../application/create-studio-bootstrap.js";
import { createPostgresWorkspaceBootstrapStore } from "./postgres-workspace-bootstrap-store.js";
import { createRobloxStarterTeam } from "../product-profiles/roblox/starter-team.js";
import { createPostgresStudioAccessControl } from "../governance/postgres-access-control.js";

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


test("real PostgreSQL workflow completes Director plan -> approval -> Worker -> artifact -> independent QA", {
  skip: !databaseUrl,
}, async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const createId = () => randomUUID();
  const actor = { id: `integration-owner-${createId()}` };
  const at = "2026-11-07T01:00:00.000Z";
  const writtenArtifacts = [];

  try {
    const access = createPostgresStudioAccessControl({ pool });
    const runtime = createStudioRuntime({
      pool,
      createId,
      createWorkerId: createId,
      authorize: access.authorize,
      now: () => at,
      workerConcurrency: 2,
      planningGateway: {
        async generatePlan() {
          return {
            title: "Football Fans vertical slice",
            objective: "Produce the first testable Roblox football-fans district package",
            summary: "Build one independently reviewable Roblox deliverable.",
            acceptanceCriteria: ["A Luau deliverable is saved with provenance", "Independent QA accepts the result"],
            tasks: [{
              title: "Build the first Roblox district module",
              description: "Create the first bounded, documented Luau module for the football-fans district.",
              requiredCompetencies: ["roblox.lua"],
              requiredTools: [],
              acceptanceCriteria: ["Output contains a Luau module", "Output explains setup and validation"],
            }],
            modelSnapshot: { provider: "integration-test", model: "planner-fake", instructionVersion: 1 },
          };
        },
      },
      workerModelGateway: {
        async generate() {
          return {
            text: "-- Roblox Luau module\nreturn { Name = \"Football Fans District\" }\n",
            modelSnapshot: { provider: "integration-test", model: "worker-fake", instructionVersion: 1 },
          };
        },
      },
      qaGateway: {
        async review() {
          return {
            verdict: "accepted",
            findings: ["Artifact meets the integration acceptance criteria."],
            modelSnapshot: { provider: "integration-test", model: "qa-fake", instructionVersion: 1 },
          };
        },
      },
      artifactWriter: {
        async writeTextArtifact(input) {
          writtenArtifacts.push(input);
          return {
            path: input.path,
            branch: "integration-test",
            sha256: "integration-checksum",
            commitSha: "integration-commit",
            provenance: input.provenance,
          };
        },
      },
    });

    const bootstrap = createStudioBootstrap({
      store: createPostgresWorkspaceBootstrapStore({ pool, createId }),
      director: runtime.director,
      createId,
      now: () => at,
      createSpecialistsForProfile: ({ productProfileId, organizationId: newOrganizationId, createId: nextId, at: timestamp }) => {
        assert.equal(productProfileId, "roblox-experience");
        return createRobloxStarterTeam({ organizationId: newOrganizationId, createId: nextId, at: timestamp });
      },
    });
    const created = await bootstrap.bootstrap({
      organizationName: "Integration Test Studio",
      projectName: "Football Fans",
      productProfileId: "roblox-experience",
      brief: "Create the first football-fans Roblox district module.",
      actor,
    });
    assert.equal(created.status, "plan_proposed");
    const project = created.workspace.project;
    const organizationId = created.workspace.organization.id;
    const proposed = created.plan;
    assert.equal(proposed.status, "proposed");
    assert.equal(proposed.tasks.length, 1);

    const approved = await runtime.approval.approve({ plan: proposed.plan, actor });
    assert.equal(approved.plan.status, "approved");

    const report = await runtime.workflow.run({ planId: proposed.plan.id, actor });
    assert.equal(report.status, "completed");
    assert.equal(report.executions.length, 1);
    assert.equal(report.executions[0].status, "qa");
    assert.equal(report.qaReviews.length, 1);
    assert.equal(report.qaReviews[0].verdict, "accepted");
    assert.equal(writtenArtifacts.length, 1);
    assert.equal(writtenArtifacts[0].provenance.projectId, project.id);

    const taskRows = await pool.query(
      "SELECT status FROM studio.tasks WHERE plan_id = $1",
      [proposed.plan.id],
    );
    assert.deepEqual(taskRows.rows.map(row => row.status), ["completed"]);

    const artifactRows = await pool.query(
      "SELECT content FROM studio.artifacts WHERE task_id = $1",
      [proposed.tasks[0].id],
    );
    assert.equal(artifactRows.rows.length, 1);
    assert.equal(artifactRows.rows[0].content.external.path, writtenArtifacts[0].path);

    const events = await pool.query(
      "SELECT event_type FROM studio.events WHERE project_id = $1 OR organization_id = $2",
      [project.id, organizationId],
    );
    const eventTypes = new Set(events.rows.map(row => row.event_type));
    for (const expected of [
      "project.created", "specialist.created", "plan.created", "task.assigned",
      "execution.started", "artifact.created", "qa.passed",
    ]) {
      assert.ok(eventTypes.has(expected), `missing event ${expected}`);
    }
  } finally {
    await pool.end();
  }
});
