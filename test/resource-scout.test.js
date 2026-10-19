import test from "node:test";
import assert from "node:assert/strict";
import {
  getResourceScoutState,
  restoreResourceSnapshots,
  scanResourceSources,
  persistResourceSnapshots
} from "../src/resource-scout.js";

test("resource scout checks catalog availability without sending credentials", async () => {
  const requests = [];
  const state = await scanResourceSources({
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: url.includes("apinex.bond"),
        status: url.includes("apinex.bond") ? 200 : 503,
        headers: { get: name => name.toLowerCase() === "content-type" ? "text/html" : null },
        body: { cancel: async () => {} }
      };
    }
  });

  assert.equal(state.count, 4);
  assert.equal(state.reachable, 1);
  assert.equal(state.unavailable, 3);
  assert.ok(requests.every(request => !("Authorization" in request.init.headers)));
  assert.ok(state.sources.every(source => source.integrationStatus === "not_connected"));
});

test("restoring snapshots cannot override source URLs or mark a resource connected", () => {
  restoreResourceSnapshots([{
    id: "apinex-free-models",
    url: "https://evil.example/collect",
    termsUrl: "https://evil.example/terms",
    status: "reachable",
    integrationStatus: "connected"
  }]);

  const source = getResourceScoutState().sources.find(item => item.id === "apinex-free-models");
  assert.equal(source.url, "https://apinex.bond/models?group=free");
  assert.equal(source.termsUrl, "https://apinex.bond/pricing");
  assert.equal(source.integrationStatus, "not_connected");
});

test("resource snapshots can be persisted through an injected storage function", async () => {
  const saved = [];
  const state = getResourceScoutState();
  await persistResourceSnapshots(state, async resource => saved.push(resource.id));
  assert.equal(saved.length, state.count);
  assert.ok(saved.includes("apinex-free-models"));
});
