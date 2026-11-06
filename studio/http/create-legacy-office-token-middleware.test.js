import test from "node:test";
import assert from "node:assert/strict";
import { createLegacyOfficeTokenMiddleware } from "./create-legacy-office-token-middleware.js";

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test("legacy owner token authenticates Studio requests and sets a stable owner actor", () => {
  const middleware = createLegacyOfficeTokenMiddleware({ token: "existing-office-owner-secret" });
  const req = { headers: { "x-ai-office-audit-token": "existing-office-owner-secret" } };
  const res = response();
  let called = false;
  middleware(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.auth.actor.id, "legacy-office-owner");
  assert.equal(req.auth.actor.name, "AI-OFFICE owner");
});

test("legacy owner token rejects missing and incorrect credentials", () => {
  const middleware = createLegacyOfficeTokenMiddleware({ token: "existing-office-owner-secret" });
  for (const headers of [{}, { "x-ai-office-audit-token": "wrong" }]) {
    const req = { headers };
    const res = response();
    let called = false;
    middleware(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "UNAUTHENTICATED" });
  }
});

test("legacy owner token also accepts the existing Bearer header convention", () => {
  const middleware = createLegacyOfficeTokenMiddleware({ token: "existing-office-owner-secret" });
  const req = { headers: { authorization: "Bearer existing-office-owner-secret" } };
  const res = response();
  let called = false;
  middleware(req, res, () => { called = true; });
  assert.equal(called, true);
});
