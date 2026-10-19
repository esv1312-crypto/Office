import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserManager } from "../src/browser-manager.js";

const originalEnabled = process.env.BROWSER_AUTOMATION_ENABLED;
const originalKey = process.env.TINYFISH_API_KEY;
const originalWebhookSecret = process.env.BROWSER_WEBHOOK_SECRET;
const originalFetch = globalThis.fetch;

function restoreEnv() {
  if (originalEnabled === undefined) delete process.env.BROWSER_AUTOMATION_ENABLED;
  else process.env.BROWSER_AUTOMATION_ENABLED = originalEnabled;
  if (originalKey === undefined) delete process.env.TINYFISH_API_KEY;
  else process.env.TINYFISH_API_KEY = originalKey;
  if (originalWebhookSecret === undefined) delete process.env.BROWSER_WEBHOOK_SECRET;
  else process.env.BROWSER_WEBHOOK_SECRET = originalWebhookSecret;
}

test("safe browser request is blocked, not left queued, when automation is disabled", async () => {
  try {
    process.env.BROWSER_AUTOMATION_ENABLED = "false";
    process.env.TINYFISH_API_KEY = "test-key";
    const events = [];
    const manager = createBrowserManager({ emit: (type, data) => events.push({ type, ...data }) });
    const request = await manager.request({ url: "https://example.com", goal: "Read the public page", actionClass: "research" });

    assert.equal(request.status, "blocked");
    assert.match(request.error, /disabled/i);
    assert.ok(request.completedAt);
    assert.equal(manager.status(request.id).status, "blocked");
    assert.equal(manager.summary().queued, 0);
    assert.equal(manager.summary().enabled, false);
    assert.ok(events.some(event => event.type === "browser.blocked"));
  } finally {
    restoreEnv();
  }
});

test("safe browser request is blocked, not left queued, when credentials are missing", async () => {
  try {
    process.env.BROWSER_AUTOMATION_ENABLED = "true";
    delete process.env.TINYFISH_API_KEY;
    const events = [];
    const manager = createBrowserManager({ emit: (type, data) => events.push({ type, ...data }) });
    const request = await manager.request({ url: "https://example.com", goal: "Read the public page", actionClass: "research" });

    assert.equal(request.status, "blocked");
    assert.match(request.error, /not configured/i);
    assert.ok(request.completedAt);
    assert.equal(manager.summary().queued, 0);
    assert.equal(manager.summary().enabled, false);
    assert.ok(events.some(event => event.type === "browser.blocked"));
  } finally {
    restoreEnv();
  }
});

test("sensitive browser actions still require explicit approval", async () => {
  try {
    process.env.BROWSER_AUTOMATION_ENABLED = "false";
    delete process.env.TINYFISH_API_KEY;
    const manager = createBrowserManager({ emit: () => {} });
    const request = await manager.request({ url: "https://example.com", goal: "Create an account", actionClass: "signup" });

    assert.equal(request.status, "waiting_approval");
    assert.equal(request.requiresApproval, true);
    assert.equal(request.approvalToken, undefined);
    assert.equal(manager.status(request.id).approvalToken, undefined);
    assert.equal(typeof manager.approve, "undefined");
    assert.equal(typeof manager.approveAuthorized, "function");
  } finally {
    restoreEnv();
  }
});

test("unsupported browser actions are rejected", async () => {
  try {
    process.env.BROWSER_AUTOMATION_ENABLED = "false";
    delete process.env.TINYFISH_API_KEY;
    const manager = createBrowserManager({ emit: () => {} });
    await assert.rejects(
      manager.request({ url: "https://example.com", goal: "Do something", actionClass: "magic" }),
      error => error.code === "BROWSER_POLICY_DENIED"
    );
  } finally {
    restoreEnv();
  }
});

test("browser webhooks use one-time per-request tokens without exposing them in snapshots", async () => {
  const originalFetchBeforeTest = globalThis.fetch;
  try {
    process.env.BROWSER_AUTOMATION_ENABLED = "true";
    process.env.TINYFISH_API_KEY = "test-key";
    delete process.env.BROWSER_WEBHOOK_SECRET;
    let submittedBody = null;
    globalThis.fetch = async (_url, options) => {
      submittedBody = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ run_id: "run-123" }) };
    };
    const manager = createBrowserManager({ emit: () => {} });
    const request = await manager.request({ url: "https://example.com", goal: "Read the public page", actionClass: "research" });

    assert.equal(request.status, "running");
    assert.equal(request.webhookToken, undefined);
    assert.equal(manager.status(request.id).webhookToken, undefined);
    assert.equal(manager.summary().enabled, true);

    const callback = new URL(submittedBody.webhook_url);
    const token = callback.searchParams.get("token");
    assert.ok(token);
    assert.equal(callback.pathname, "/api/browser/webhook");

    const result = manager.webhook({ run_id: "run-123", status: "completed", result: "done" }, token);
    assert.equal(result.authenticated, true);
    assert.equal(result.matched, true);
    assert.equal(manager.status(request.id).status, "completed");
    assert.equal(manager.status(request.id).webhookToken, undefined);

    const replay = manager.webhook({ run_id: "run-123", status: "completed", result: "replay" }, token);
    assert.equal(replay.authenticated, false);
    assert.equal(replay.matched, false);
  } finally {
    globalThis.fetch = originalFetchBeforeTest;
    restoreEnv();
  }
});

test("browser audit events redact URL query strings and task goals", async () => {
  try {
    process.env.BROWSER_AUTOMATION_ENABLED = "false";
    process.env.TINYFISH_API_KEY = "test-key";
    const events = [];
    const manager = createBrowserManager({ emit: (type, data) => events.push({ type, ...data }) });
    await manager.request({
      url: "https://example.com/private/path?token=secret-value",
      goal: "Use secret-value to inspect the page",
      actionClass: "research"
    });

    const requested = events.find(event => event.type === "browser.requested");
    assert.equal(requested.url, "https://example.com");
    assert.equal(requested.goal, "[redacted]");
    assert.equal(requested.goalLength, "Use secret-value to inspect the page".length);
    assert.equal(JSON.stringify(events).includes("secret-value"), false);
    assert.equal(JSON.stringify(events).includes("/private/path"), false);
  } finally {
    restoreEnv();
  }
});

test("browser provider errors cannot leak a per-request callback token", async () => {
  const originalFetchBeforeTest = globalThis.fetch;
  try {
    process.env.BROWSER_AUTOMATION_ENABLED = "true";
    process.env.TINYFISH_API_KEY = "test-key";
    let token = "";
    const events = [];
    globalThis.fetch = async (_url, options) => {
      const submitted = JSON.parse(options.body);
      token = new URL(submitted.webhook_url).searchParams.get("token");
      throw new Error("provider rejected callback " + submitted.webhook_url);
    };
    const manager = createBrowserManager({ emit: (type, data) => events.push({ type, ...data }) });
    const request = await manager.request({ url: "https://example.com", goal: "Read the public page", actionClass: "research" });

    assert.equal(request.status, "failed");
    assert.ok(token);
    assert.equal(request.error.includes(token), false);
    assert.equal(JSON.stringify(events).includes(token), false);
    assert.equal(request.webhookToken, undefined);
  } finally {
    globalThis.fetch = originalFetchBeforeTest;
    restoreEnv();
  }
});
