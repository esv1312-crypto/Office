import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresStudioAccessControl } from "./postgres-access-control.js";

function fixture({ role = "owner", membershipStatus = "active", organizationStatus = "active" } = {}) {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM studio.organization_memberships m") &&
          sql.includes("JOIN studio.organizations o") &&
          !sql.includes("JOIN studio.projects p")) {
        return { rows: [{ role, status: membershipStatus, organization_status: organizationStatus }] };
      }
      if (sql.includes("FROM studio.projects p") && sql.includes("JOIN studio.organization_memberships m")) {
        if (sql.includes("SELECT p.id")) return { rows: [{
          id: "project-1", organization_id: "org-1", name: "Pilot",
          product_profile_id: "roblox", status: "active", version: 1, payload: {},
        }] };
        return membershipStatus === "active" && organizationStatus === "active"
          ? { rows: [{ role, status: membershipStatus, organization_status: organizationStatus }] }
          : { rows: [] };
      }
      if (sql.includes("FROM studio.plans pl")) return {
        rows: membershipStatus === "active" && organizationStatus === "active" ? [{
          id: "plan-1", project_id: "project-1", organization_id: "org-1",
          status: "proposed", version: 1, payload: { title: "Pilot plan" },
        }] : [],
      };
      return { rows: [] };
    },
  };
  return { access: createPostgresStudioAccessControl({ pool }), calls };
}

const actor = { id: "identity-provider-subject-42" };

test("requires a database pool and never accepts a missing actor identity", async () => {
  assert.throws(() => createPostgresStudioAccessControl({ pool: {} }), /pool/);
  const { access } = fixture();
  await assert.rejects(access.loadProject({ projectId: "project-1", actor: null }), /actor.id/);
});

test("loads projects only through an active organization membership", async () => {
  const { access, calls } = fixture();
  const project = await access.loadProject({ projectId: "project-1", actor });
  assert.equal(project.organizationId, "org-1");
  assert.match(calls[0].sql, /m\.actor_id = \$2/);
  assert.deepEqual(calls[0].params, ["project-1", actor.id]);
});

test("loads plans only through an active membership in their project organization", async () => {
  const { access, calls } = fixture();
  const plan = await access.loadPlan({ planId: "plan-1", actor });
  assert.equal(plan.projectId, "project-1");
  assert.equal(plan.organizationId, "org-1");
  assert.match(calls[0].sql, /JOIN studio\.organization_memberships/);
});

test("allows members to create plans but reserves approval and execution for owners", async () => {
  const { access: memberAccess } = fixture({ role: "member" });
  const project = { id: "project-1" };
  const plan = { id: "plan-1", projectId: "project-1" };
  assert.equal(await memberAccess.authorize({ actor, action: "director.plan.create", project }), true);
  assert.equal(await memberAccess.authorize({ actor, action: "director.plan.approve", plan }), false);
  assert.equal(await memberAccess.authorize({ actor, action: "director.plan.dispatch", plan }), false);

  const { access: ownerAccess } = fixture({ role: "owner" });
  assert.equal(await ownerAccess.authorize({ actor, action: "director.plan.approve", plan }), true);
  assert.equal(await ownerAccess.authorize({ actor, action: "director.plan.dispatch", plan }), true);
});

test("denies revoked memberships, suspended organizations, global scopes and unknown actions", async () => {
  const revoked = fixture({ membershipStatus: "revoked" });
  assert.equal(await revoked.access.loadProject({ projectId: "project-1", actor }), null);
  const suspended = fixture({ organizationStatus: "suspended" });
  assert.equal(await suspended.access.loadPlan({ planId: "plan-1", actor }), null);
  const { access } = fixture();
  assert.equal(await access.authorize({ actor, action: "execution.recover", scope: "studio" }), false);
  assert.equal(await access.authorize({ actor, action: "unknown.action", project: { id: "project-1" } }), false);
});
