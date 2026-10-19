import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const planner = {
  summary: "Delegate the request to two independent workers and verify their results.",
  subtasks: [
    { employeeId: "analyst", task: "Analyze the supplied request and return a concise finding with evidence." },
    { employeeId: "developer", task: "Inspect the supplied request and return a technical finding with evidence." }
  ],
  verificationChecklist: [
    "Analyst worker completed with a result",
    "Developer worker completed with a result"
  ]
};

function mockCompletion(body) {
  const user = String(body?.messages?.at(-1)?.content || "");
  let content;
  if (user.includes('Schema: {"summary":"string","subtasks"')) {
    content = JSON.stringify(planner);
  } else if (user.includes('Schema: {"status":"PASS|FAIL","checks"')) {
    content = JSON.stringify({
      status: "PASS",
      summary: "Both worker results are supported by runtime completion events.",
      checks: planner.verificationChecklist.map(requirement => ({
        name: requirement,
        requirement,
        passed: true,
        evidence: "The authoritative runtime event stream contains task.completed for worker execution.",
        classification: "FACT",
        source: "runtime event",
        locator: "task.completed"
      }))
    });
  } else if (user.includes("Synthesize the worker results")) {
    content = "Both delegated workers returned results. The independent verifier checked the required completion evidence.";
  } else if (user.includes("EVIDENCE-FIRST RULES")) {
    content = "FACT: The assigned worker completed its bounded analysis.\nEVIDENCE INDEX:\nworker completion | FACT | runtime event | task.completed | the worker task completed successfully";
  } else if (user.includes("AI-OFFICE PREFLIGHT.")) {
    content = "PREFLIGHT_OK";
  } else {
    content = "READY";
  }
  return {
    id: "mock-completion",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body?.model || "mock/test-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}

test("full root-task lifecycle completes with delegated workers and independent verification using a loopback mock model", async () => {
  const token = "runtime-e2e-token-not-a-secret";
  let mockRequests = 0;
  const mockAi = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk.toString();
    let body;
    try { body = JSON.parse(raw); } catch {
      res.writeHead(400).end(JSON.stringify({ error: { message: "invalid json" } }));
      return;
    }
    mockRequests += 1;
    const response = mockCompletion(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve, reject) => {
    mockAi.once("error", reject);
    mockAi.listen(0, "127.0.0.1", resolve);
  });
  const mockAddress = mockAi.address();
  const port = 21000 + (process.pid % 18000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    OFFICE_AUDIT_TOKEN: token,
    DATABASE_URL: "",
    AI_PROVIDER_ORDER: "openrouter",
    AI_FREE_ONLY: "true",
    AI_PAID_TEST_ONLY: "false",
    OPENROUTER_API_KEY: "sk-or-test-not-a-real-secret",
    OPENROUTER_MODEL: "",
    OFFICE_TEST_ALLOW_LOCAL_AI_ENDPOINT: "true",
    OFFICE_TEST_OPENROUTER_URL: `http://127.0.0.1:${mockAddress.port}/v1/chat/completions`,
    GEMINI_API_KEY: "",
    HUGGINGFACE_API_KEY: "",
    CLOUDFLARE_API_TOKEN: "",
    CLOUDFLARE_ACCOUNT_ID: "",
    APINEX_API_KEY: "",
    AI_EMPLOYEES_JSON: JSON.stringify([
      { id: "chief", name: "Test Chief", role: "coordinator", provider: "openrouter", model: "mock/chief", skills: ["planning", "delegation"] },
      { id: "developer", name: "Test Developer", role: "developer", provider: "openrouter", model: "mock/developer", skills: ["coding"] },
      { id: "analyst", name: "Test Analyst", role: "analyst", provider: "openrouter", model: "mock/analyst", skills: ["analysis"] },
      { id: "verifier", name: "Test Verifier", role: "verifier", provider: "openrouter", model: "mock/verifier", skills: ["verification"] },
      { id: "executor", name: "Test Executor", role: "executor", provider: "openrouter", model: "mock/executor", skills: ["execution"] }
    ]),
    RUN_FINAL_AUDIT_ON_START: "false",
    MODEL_SCOUT_INTERVAL_MS: "86400000",
    RESOURCE_SCOUT_INTERVAL_MS: "86400000",
    WORKER_WATCHDOG_INTERVAL_MS: "3600000",
    AI_REQUEST_TIMEOUT_MS: "5000",
    PREFLIGHT_TIMEOUT_MS: "3000",
    MAX_WORKER_REPLACEMENTS: "0",
    MAX_RECOVERY_ATTEMPTS: "0"
  };
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output = (output + chunk.toString()).slice(-16000); });
  child.stderr.on("data", chunk => { output = (output + chunk.toString()).slice(-16000); });
  const waitForExit = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));

  async function request(path, options = {}) {
    return fetch(baseUrl + path, { ...options, signal: AbortSignal.timeout(4000) });
  }

  try {
    let health;
    let lastError;
    for (let i = 0; i < 50; i += 1) {
      if (child.exitCode !== null) throw new Error(`runtime exited early: ${output}`);
      try {
        const response = await request("/health");
        if (response.ok) { health = await response.json(); break; }
      } catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(health?.ok, true, `runtime did not start: ${lastError?.message || ""}\n${output}`);

    const acceptedResponse = await request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", "x-ai-office-audit-token": token },
      body: JSON.stringify({ task: "Test a complete delegated AI-OFFICE task using only a local mock model.", employeeId: "chief" })
    });
    const acceptedText = await acceptedResponse.text();
    assert.equal(acceptedResponse.status, 202, acceptedText);
    const accepted = JSON.parse(acceptedText);
    assert.ok(accepted.task?.id);

    let finalTask;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const response = await request(`/api/tasks/${encodeURIComponent(accepted.task.id)}`, {
        headers: { "x-ai-office-audit-token": token }
      });
      assert.equal(response.status, 200);
      finalTask = (await response.json()).task;
      if (["completed", "failed"].includes(finalTask.status)) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    assert.equal(finalTask?.status, "completed", `root task did not complete; state=${JSON.stringify({
      status: finalTask?.status,
      error: finalTask?.error,
      verification: finalTask?.verification,
      workerResults: finalTask?.workerResults
    })}\n${output}`);
    assert.equal(finalTask.verification?.status, "PASS");
    assert.equal(finalTask.verification.checks.length, 2);
    assert.ok(finalTask.verification.checks.every(check => check.passed === true && check.referenceGrounded === true));
    assert.equal(finalTask.workerResults.length, 2);
    assert.ok(finalTask.workerResults.every(worker => worker.status === "completed" && worker.result));
    assert.ok(finalTask.subtaskIds.length === 2);
    assert.ok(mockRequests >= 6, `expected preflight + planner + workers + synthesis + verifier requests, got ${mockRequests}`);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([waitForExit, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await new Promise(resolve => mockAi.close(resolve));
  }
});
