import test from "node:test";
import assert from "node:assert/strict";
import { createRobloxStarterTeam } from "./starter-team.js";

test("creates a validated Roblox pilot team with independent QA", () => {
  let sequence = 0;
  const team = createRobloxStarterTeam({
    organizationId: "org-1",
    createId: () => `specialist-${++sequence}`,
    at: "2026-11-07T12:00:00.000Z",
  });
  assert.equal(team.length, 6);
  assert.equal(new Set(team.map(item => item.id)).size, 6);
  assert.ok(team.every(item => item.organizationId === "org-1" && item.status === "active"));
  assert.ok(team.some(item => item.competencies.includes("roblox.lua")));
  const qa = team.find(item => item.role === "roblox_qa");
  assert.ok(qa);
  assert.ok(qa.competencies.includes("qa.review"));
  assert.ok(!qa.competencies.includes("roblox.lua"));
  assert.ok(team.every(item => item.allowedTools.length === 0));
});

test("rejects missing organization or ID generator", () => {
  assert.throws(() => createRobloxStarterTeam({ createId: () => "x" }), /organizationId/);
  assert.throws(() => createRobloxStarterTeam({ organizationId: "org-1" }), /createId/);
});
