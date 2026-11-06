import test from "node:test";
import assert from "node:assert/strict";
import { createSpecialist } from "./create-specialist.js";

test("creates a validated, active specialist with configurable competencies", () => {
  const specialist = createSpecialist({
    id: "spec-1", organizationId: "org-1", name: "Builder", role: "developer",
    instructions: "Build assigned work", competencies: ["roblox", "lua"],
    allowedTools: ["github.read"], at: "2026-11-07T10:00:00.000Z",
  });
  assert.equal(specialist.status, "active");
  assert.deepEqual(specialist.competencies, ["roblox", "lua"]);
  assert.equal(specialist.version, 1);
});

test("rejects missing instructions and malformed competencies", () => {
  assert.throws(() => createSpecialist({
    id: "s", organizationId: "o", name: "N", role: "r",
    at: "2026-11-07T10:00:00.000Z",
  }), /instructions/);
  assert.throws(() => createSpecialist({
    id: "s", organizationId: "o", name: "N", role: "r", instructions: "Do",
    competencies: [" "], at: "2026-11-07T10:00:00.000Z",
  }), /competencies/);
});
