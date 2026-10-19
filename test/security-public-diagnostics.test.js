import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

function routeBody(route) {
  const start = source.indexOf(route);
  assert.notEqual(start, -1, `missing route: ${route}`);
  const next = source.indexOf("\napp.", start + route.length);
  return source.slice(start, next === -1 ? source.length : next);
}

test("public health endpoints disclose no provider, model, employee, tool, or browser configuration", () => {
  const health = routeBody('app.get("/health"');
  const backendHealth = routeBody('app.get("/api/backend/health"');
  for (const body of [health, backendHealth]) {
    assert.doesNotMatch(body, /providerOrder|configuredProviders|aiConfigured|freeOnly|employees\(\)|TOOL_REGISTRY|githubToolsEnabled|browser\.summary|resolveBrain/);
  }
  assert.match(health, /status:"online"/);
  assert.match(backendHealth, /status:"online"/);
});

test("employee diagnostics require internal or audit-token authorization", () => {
  const employees = routeBody('app.get("/api/employees"');
  assert.match(employees, /requireInternalOrAudit\(req,res\)/);
  assert.match(employees, /return;[\s\S]*employees\(\)\.map/);
});

test("audit token is accepted only from the dedicated request header, never a URL query", () => {
  const start = source.indexOf("function requireInternalOrAudit");
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf("\n}", start) + 2);
  assert.match(body, /req\.headers\["x-ai-office-audit-token"\]/);
  assert.doesNotMatch(body, /req\.query|query\?\.token/);
  assert.match(body, /expected && supplied===expected/);
});
