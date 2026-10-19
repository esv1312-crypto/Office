import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

test("runtime smoke: public health is minimal, control routes require auth, and tasks are observable", async () => {
  const port = 20000 + (process.pid % 20000);
  const token = "runtime-smoke-test-token-not-a-secret";
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PORT: String(port),
    OFFICE_AUDIT_TOKEN: token,
    DATABASE_URL: "",
    AI_PROVIDER_ORDER: "openrouter",
    AI_FREE_ONLY: "true",
    AI_PAID_TEST_ONLY: "false",
    OPENROUTER_API_KEY: "",
    OPENROUTER_MODEL: "",
    GEMINI_API_KEY: "",
    HUGGINGFACE_API_KEY: "",
    CLOUDFLARE_API_TOKEN: "",
    CLOUDFLARE_ACCOUNT_ID: "",
    APINEX_API_KEY: "",
    AI_EMPLOYEES_JSON: "",
    RUN_FINAL_AUDIT_ON_START: "false",
    MODEL_SCOUT_INTERVAL_MS: "86400000",
    RESOURCE_SCOUT_INTERVAL_MS: "86400000",
    WORKER_WATCHDOG_INTERVAL_MS: "3600000"
  };
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output = (output + chunk.toString()).slice(-12000); });
  child.stderr.on("data", chunk => { output = (output + chunk.toString()).slice(-12000); });

  const waitForExit = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  async function request(path, options = {}) {
    return fetch(baseUrl + path, { ...options, signal: AbortSignal.timeout(3000) });
  }

  try {
    let healthResponse;
    let lastError;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error(`runtime exited before becoming healthy: ${output}`);
      }
      try {
        healthResponse = await request("/health");
        if (healthResponse.ok) break;
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(healthResponse?.ok, `runtime did not become healthy: ${lastError?.message || ""}\n${output}`);
    const health = await healthResponse.json();
    assert.equal(health.ok, true);
    assert.equal(health.service, "ai-office-runtime");
    assert.equal(health.status, "online");
    assert.deepEqual(Object.keys(health).sort(), ["ok", "persistence", "service", "startedAt", "status"]);

    for (const path of ["/api/employees", "/api/tools", "/api/state"]) {
      const response = await request(path);
      assert.equal(response.status, 401, `${path} must reject unauthenticated access`);
    }

    const unauthenticatedTask = await request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "must not be accepted without auth" })
    });
    assert.equal(unauthenticatedTask.status, 401);

    const acceptedResponse = await request("/api/tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-office-audit-token": token
      },
      body: JSON.stringify({ task: "Runtime smoke test: no external provider calls", employeeId: "chief" })
    });
    assert.equal(acceptedResponse.status, 202, await acceptedResponse.text());
    const acceptedBody = await acceptedResponse.json();
    assert.equal(acceptedBody.ok, true);
    assert.equal(acceptedBody.task.status, "waiting");
    assert.equal(acceptedBody.task.waitingReason, "ai_not_configured");
    assert.ok(acceptedBody.task.id);

    const taskResponse = await request(`/api/tasks/${encodeURIComponent(acceptedBody.task.id)}`, {
      headers: { "x-ai-office-audit-token": token }
    });
    assert.equal(taskResponse.status, 200);
    const taskBody = await taskResponse.json();
    assert.equal(taskBody.task.id, acceptedBody.task.id);
    assert.equal(taskBody.task.status, "waiting");
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      waitForExit,
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
