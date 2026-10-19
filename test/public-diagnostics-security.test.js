import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

test("public health responses contain only minimal service status", () => {
  const start = source.indexOf('app.get("/health"');
  const end = source.indexOf('app.get("/api/employees"', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const route = source.slice(start, end);
  assert.match(route, /status:"online"/);
  assert.doesNotMatch(route, /providerOrder|configuredProviders|aiConfigured|employees\(\)\.length|TOOL_REGISTRY|githubToolsEnabled|browser\.summary|freeOnly/);

  const backendStart = source.indexOf('app.get("/api/backend/health"');
  const backendEnd = source.indexOf("\napp.", backendStart + 1);
  const backend = source.slice(backendStart, backendEnd);
  assert.match(backend, /status:"online"/);
  assert.doesNotMatch(backend, /providerOrder|configuredProviders|aiConfigured|freeOnly|browser/);
});

test("employee diagnostic route requires internal or audit authorization", () => {
  const start = source.indexOf('app.get("/api/employees"');
  const end = source.indexOf("\napp.", start + 1);
  const route = source.slice(start, end);
  assert.match(route, /requireInternalOrAudit\(req,res\)/);
});

test("audit authorization accepts its token only in a header, not a query string", () => {
  const start = source.indexOf("function requireInternalOrAudit");
  const end = source.indexOf("\nconst workerQueue", start);
  const auth = source.slice(start, end);
  assert.match(auth, /req\.headers\["x-ai-office-audit-token"\]/);
  assert.doesNotMatch(auth, /req\.query/);
});
