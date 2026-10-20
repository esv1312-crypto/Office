import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isZeroPrice, isUsableFreeModel, resolveProviderDiscovery, recordModelQualification, getModelScoutState, isModelQualifiedForRole } from "../src/model-scout.js";

test("explicit zero input and output pricing is free", () => {
  assert.equal(isZeroPrice({ input: "0", output: "0" }), true);
  assert.equal(isZeroPrice({ prompt: 0, completion: 0 }), true);
});

test("missing or null prices are not proof of a free model", () => {
  assert.equal(isZeroPrice({}), false);
  assert.equal(isZeroPrice({ input: null, output: null }), false);
  assert.equal(isZeroPrice({ input: 0 }), false);
  assert.equal(isZeroPrice(null), false);
});

test("explicit free model suffix is accepted unless expired", () => {
  assert.equal(isUsableFreeModel({ id: "vendor/model:free" }), true);
  assert.equal(isUsableFreeModel({ id: "vendor/model:free", expiration_date: "2000-01-01" }), false);
});

test("zero pricing requires both input and output prices", () => {
  assert.equal(isUsableFreeModel({ id: "vendor/model", pricing: { input: 0, output: 0 } }), true);
  assert.equal(isUsableFreeModel({ id: "vendor/model", pricing: { input: 0 } }), false);
});

test("explicit nonzero catalog pricing overrides a stale :free model suffix", () => {
  assert.equal(isUsableFreeModel({ id: "vendor/model:free", pricing: { input: "0.000001", output: "0.000002" } }), false);
  assert.equal(isUsableFreeModel({ id: "vendor/model:free", pricing: { input: 0, output: 0 } }), true);
  assert.equal(isUsableFreeModel({ id: "vendor/model:free" }), true);
});

import { normalizeApinexModels } from "../src/model-scout.js";

test("APINEX discovery includes only explicitly free model IDs", () => {
  const models = normalizeApinexModels({ data: [
    { id: "free/gpt-6-luna", context_length: 100000 },
    { id: "free/kimi-k3" },
    { id: "gpt-6-astra" },
    { id: "deepseek-v4-flash", pricing: { input: 0, output: 0 } },
    { id: "free/expired-model", expiration_date: "2000-01-01" }
  ] });

  assert.deepEqual(models.map(model => model.id), ["free/gpt-6-luna", "free/kimi-k3"]);
  assert.ok(models.every(model => model.provider === "apinex"));
  assert.ok(models.every(model => model.qualification === "discovered_unverified"));
});

test("model catalog fetch aborts when the configured timeout elapses", async () => {
  const { fetchJson } = await import("../src/model-scout.js");
  await assert.rejects(
    fetchJson("https://catalog.example/models", {
      timeoutMs: 1000,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("request aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      })
    }),
    error => error.name === "AbortError"
  );
});


test("provider discovery failure preserves the last successful model snapshot", () => {
  const previous = [{ id: "provider/model:free" }];
  const failed = resolveProviderDiscovery(previous, { status: "rejected", reason: new Error("HTTP 429 rate limit") });
  assert.equal(failed.ok, false);
  assert.equal(failed.models, previous);
  assert.match(failed.error, /429/);

  const succeeded = resolveProviderDiscovery(previous, { status: "fulfilled", value: [] });
  assert.equal(succeeded.ok, true);
  assert.deepEqual(succeeded.models, []);
  assert.equal(succeeded.error, null);
});


test("Model Scout routes provider refreshes through the last-good-snapshot policy", async () => {
  const source = await readFile(new URL("../src/model-scout.js", import.meta.url), "utf8");
  assert.match(source, /const outcome=resolveProviderDiscovery\(state\.providers\[provider\],result\)/);
  assert.match(source, /if\(!outcome\.ok\)\{[\s\S]*?state\.errors\.push\(provider\+": "\+outcome\.error\);[\s\S]*?continue;/);
  assert.match(source, /const seen=new Set\(models\.map\(x=>x\.routeModel \|\| x\.id\)\)/);
});

test("Model Scout stores bounded preflight qualification results", () => {
  assert.equal(recordModelQualification({
    provider: "OpenRouter", model: "vendor/model:free", role: "verifier",
    ok: true, latencyMs: 123, checkedAt: "2026-10-20T12:00:00.000Z",
    expiresAt: "2026-10-20T12:10:00.000Z"
  }), true);
  assert.equal(recordModelQualification({
    provider: "openrouter", model: "vendor/bad-model", role: "verifier",
    ok: false, latencyMs: 250, errorCategory: "rate_limited", transient: true,
    checkedAt: "2026-10-20T12:00:00.000Z"
  }), true);
  const state = getModelScoutState();
  const passed = state.qualification.find(x => x.model === "vendor/model:free");
  const failed = state.qualification.find(x => x.model === "vendor/bad-model");
  assert.equal(passed.status, "passed");
  assert.equal(passed.latencyMs, 123);
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCategory, "rate_limited");
  assert.equal(failed.transient, true);
  assert.equal("error" in failed, false);
});

test("Model Scout normalizes qualification categories and limits retained history", () => {
  recordModelQualification({
    provider: "openrouter", model: "vendor/model-a", role: "developer",
    ok: false, errorCategory: "unexpected provider response", checkedAt: "invalid-date"
  });
  const item = getModelScoutState().qualification.find(x => x.model === "vendor/model-a");
  assert.equal(item.errorCategory, "provider_error");
  assert.ok(Number.isFinite(Date.parse(item.checkedAt)));
  for (let i = 0; i < 105; i++) {
    recordModelQualification({
      provider: "test-provider", model: "entry-" + i, role: "test",
      ok: i % 2 === 0, checkedAt: new Date(Date.UTC(2026, 9, 20, 12, 0, i)).toISOString()
    });
  }
  const state = getModelScoutState();
  assert.equal(state.qualificationSummary.retained, 100);
  assert.ok(state.qualification.length <= 100);
  assert.equal(state.qualification.some(x => x.model === "entry-0"), false);
});

test("runtime reports model preflight results to Model Scout", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /recordModelQualification/);
  assert.match(source, /ok:true,latencyMs:entry\.latencyMs/);
  assert.match(source, /ok:false,latencyMs:Date\.now\(\)-started/);
});


test("production model qualification requires a passed, unexpired probe for the same provider, model, and role", () => {
  const now = Date.parse("2026-10-20T16:00:00.000Z");
  const qualifications = new Map([
    ["openrouter:vendor/good:verifier", { status: "passed", expiresAt: "2026-10-20T16:10:00.000Z" }],
    ["openrouter:vendor/expired:verifier", { status: "passed", expiresAt: "2026-10-20T15:59:00.000Z" }],
    ["huggingface:vendor/good:developer", { status: "passed", expiresAt: "2026-10-20T16:10:00.000Z" }],
    ["openrouter:vendor/failed:verifier", { status: "failed", expiresAt: "2026-10-20T16:10:00.000Z" }]
  ]);
  assert.equal(isModelQualifiedForRole({provider:"openrouter",id:"vendor/good"}, "verifier", qualifications, now), true);
  assert.equal(isModelQualifiedForRole({provider:"openrouter",id:"vendor/expired"}, "verifier", qualifications, now), false);
  assert.equal(isModelQualifiedForRole({provider:"openrouter",id:"vendor/failed"}, "verifier", qualifications, now), false);
  assert.equal(isModelQualifiedForRole({provider:"huggingface",id:"vendor/good"}, "verifier", qualifications, now), false);
  assert.equal(isModelQualifiedForRole({provider:"huggingface",id:"vendor/good"}, "developer", qualifications, now), true);
});

test("catalog discovery is explicitly unverified for OpenRouter and Hugging Face", async () => {
  const source = await readFile(new URL("../src/model-scout.js", import.meta.url), "utf8");
  assert.match(source, /provider:"openrouter",[\s\S]{0,100}qualification:"discovered_unverified"/);
  assert.match(source, /provider:"huggingface",[\s\S]{0,120}qualification:"discovered_unverified"/);
  assert.match(source, /\.filter\(m=>isModelQualifiedForRole\(m,role\)\)/);
  assert.match(source, /export function getCandidatePool/);
  assert.match(source, /rankRoles\(\);[\s\S]*?const pool=state\.rolePools\[role\]/);
});


test("OpenRouter free catalog excludes known non-chat models when modality metadata is absent", async () => {
  const source = await readFile(new URL("../src/model-scout.js", import.meta.url), "utf8");
  assert.match(source, /const modalities=m\?\.architecture\?\.output_modalities/);
  assert.match(source, /if \(\/\(lyria\|image\|video\|audio\|tts\|whisper\|embed/);
});


test("a real successful OpenRouter task qualifies its model for the employee role", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const success = source.indexOf('emit("gateway.model_success",{employeeId:employee?.id || null,role,provider:"openrouter",model});');
  const qualification = source.indexOf('recordModelQualification({provider:"openrouter",model,role,ok:true', success);
  const returned = source.indexOf("return result;", success);
  assert.ok(success >= 0, "OpenRouter real-task success event must exist");
  assert.ok(qualification > success, "successful real task must qualify the exact model and role");
  assert.ok(returned > qualification, "qualification must be recorded before returning the successful result");
});
