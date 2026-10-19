import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";

const { Client } = pg;

test("persisted tasks survive a real runtime restart and interrupted work is marked failed", async () => {
  const databaseUrl = String(process.env.TEST_DATABASE_URL || "").trim();
  assert.ok(databaseUrl, "TEST_DATABASE_URL is required");
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "").toLowerCase();
  assert.ok(/test|integration/.test(databaseName), "refusing to use a database not clearly named test/integration");

  const token = "runtime-restart-test-token-not-a-secret";
  const port = 23000 + (process.pid % 16000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    OFFICE_AUDIT_TOKEN: token,
    OFFICE_TEST_DISABLE_BACKGROUND_SCOUTS: "true",
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

  let child = null;
  let output = "";
  let waitForExit = null;
  async function startRuntime() {
    child = spawn(process.execPath, ["src/server.js"], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    output = "";
    child.stdout.on("data", chunk => { output = (output + chunk.toString()).slice(-12000); });
    child.stderr.on("data", chunk => { output = (output + chunk.toString()).slice(-12000); });
    waitForExit = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));

    let health;
    let lastError;
    for (let i = 0; i < 60; i += 1) {
      if (child.exitCode !== null) throw new Error(`runtime exited before health check: ${output}`);
      try {
        const response = await fetch(baseUrl + "/health", { signal: AbortSignal.timeout(3000) });
        if (response.ok) { health = await response.json(); break; }
      } catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(health?.ok, true, `runtime failed to start: ${lastError?.message || ""}\n${output}`);
    assert.equal(health.persistence?.enabled, true);
    assert.equal(health.persistence?.ready, true);
    return health;
  }

  async function stopRuntime() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([waitForExit, new Promise(resolve => setTimeout(resolve, 7000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }

  async function request(path, options = {}) {
    return fetch(baseUrl + path, {
      ...options,
      headers: { ...(options.headers || {}), "x-ai-office-audit-token": token },
      signal: AbortSignal.timeout(4000)
    });
  }

  async function createWaitingTask(task) {
    const response = await request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task, employeeId: "chief" })
    });
    const text = await response.text();
    assert.equal(response.status, 202, text);
    const body = JSON.parse(text);
    assert.equal(body.task.status, "waiting");
    assert.equal(body.task.waitingReason, "ai_not_configured");
    return body.task;
  }

  try {
    await startRuntime();
    const interruptedTask = await createWaitingTask("Restart integration: task will simulate an interrupted running root.");
    const waitingTask = await createWaitingTask("Restart integration: configuration-blocked task should remain waiting.");

    await stopRuntime();

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const updated = await client.query(
        "UPDATE ai_office_tasks SET payload = jsonb_set(jsonb_set(payload, '{status}', to_jsonb($2::text), true), '{startedAt}', to_jsonb($3::text), true), updated_at = NOW() WHERE id = $1",
        [interruptedTask.id, "running", new Date(Date.now() - 5000).toISOString()]
      );
      assert.equal(updated.rowCount, 1, "expected to find the persisted task snapshot before simulating a crash");
    } finally {
      await client.end();
    }

    await startRuntime();

    const interruptedResponse = await request(`/api/tasks/${encodeURIComponent(interruptedTask.id)}`);
    assert.equal(interruptedResponse.status, 200);
    const interrupted = (await interruptedResponse.json()).task;
    assert.equal(interrupted.status, "failed");
    assert.equal(interrupted.error, "SERVICE_RESTART_INTERRUPTED");
    assert.equal(interrupted.restartInterrupted, true);

    const waitingResponse = await request(`/api/tasks/${encodeURIComponent(waitingTask.id)}`);
    assert.equal(waitingResponse.status, 200);
    const waiting = (await waitingResponse.json()).task;
    assert.equal(waiting.status, "waiting");
    assert.equal(waiting.waitingReason, "ai_not_configured");

    const stateResponse = await request("/api/state");
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.ok(state.events.some(event => event.type === "task.restart_interrupted" && event.taskId === interruptedTask.id));
  } finally {
    await stopRuntime();
  }
});
