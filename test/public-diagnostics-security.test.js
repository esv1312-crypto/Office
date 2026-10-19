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

test("diagnostic routes are protected and root status is minimal", () => {
  const protectedPaths = [
    'app.get("/api/tools",',
    'app.get("/api/browser",',
    'app.get("/api/browser/requests/:id",',
    'app.get("/api/resource-manager",',
    'app.get("/api/model-scout",',
    'app.post("/api/model-scout/refresh",',
    'app.get("/api/model-pools",',
    'app.get("/api/env-diagnostic",',
    'app.get("/api/gateway",'
  ];
  for (const marker of protectedPaths) {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, marker + " exists");
    const end = source.indexOf("\\napp.", start + 5);
    const route = source.slice(start, end < 0 ? source.length : end);
    assert.match(route, /requireInternalOrAudit\\(req,res\\)/, marker + " is protected");
  }
  const rootStart = source.indexOf('app.get("/",');
  const rootEnd = source.indexOf("\\napp.", rootStart + 5);
  const root = source.slice(rootStart, rootEnd);
  assert.doesNotMatch(root, /provider:|employees:|tasks:|events:/);
});

test("audit endpoints accept tokens in headers rather than query strings", () => {
  for (const marker of ['app.get("/api/smoke/fallback"', 'app.get("/api/smoke/recovery"', 'app.get("/api/smoke/evidence"', 'app.get("/api/office-check"']) {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1);
    const end = source.indexOf("\\napp.", start + 5);
    const route = source.slice(start, end < 0 ? source.length : end);
    assert.match(route, /x-ai-office-audit-token/);
    assert.doesNotMatch(route, /req\\.query\\?\\.token/);
  }
  const pognaliStart = source.indexOf('app.get("/api/pognali/audit"');
  const pognaliEnd = source.indexOf("\\napp.", pognaliStart + 5);
  const pognali = source.slice(pognaliStart, pognaliEnd);
  assert.match(pognali, /x-pognali-audit-token/);
  assert.doesNotMatch(pognali, /req\\.query\\?\\.token/);
});
