import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserManager } from "../src/browser-manager.js";

const originalEnabled = process.env.BROWSER_AUTOMATION_ENABLED;
const originalKey = process.env.TINYFISH_API_KEY;

function restoreEnv() {
  if (originalEnabled === undefined) delete process.env.BROWSER_AUTOMATION_ENABLED;
  else process.env.BROWSER_AUTOMATION_ENABLED = originalEnabled;
  if (originalKey === undefined) delete process.env.TINYFISH_API_KEY;
  else process.env.TINYFISH_API_KEY = originalKey;
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
