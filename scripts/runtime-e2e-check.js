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

let recoveryVerifierFailedOnce = false;
let missingEvidenceSentOnce = false;

function mockCompletion(body) {
  const user = String(body?.messages?.at(-1)?.content || "");
  let content;
  if (user.includes('Schema: {"summary":"string","subtasks"')) {
    content = JSON.stringify(planner);
  } else if (user.includes('Schema: {"status":"PASS|FAIL","checks"')) {
    const forceRecovery = user.includes("FORCE_RECOVERY_TEST");
    const failThisCheck = forceRecovery && !recoveryVerifierFailedOnce;
    if (failThisCheck) recoveryVerifierFailedOnce = true;
    content = JSON.stringify({
      status: failThisCheck ? "FAIL" : "PASS",
      summary: failThisCheck
        ? "Deliberately fail the first verification to exercise recovery and retest."
        : "Both worker results are supported by runtime completion events.",
      checks: planner.verificationChecklist.map(requirement => ({
        name: requirement,
        requirement,
        passed: !failThisCheck,
        evidence: "The authoritative runtime event stream contains task.completed for worker execution.",
        classification: "FACT",
        source: "runtime event",
        locator: "task.completed"
      }))
    });
  } else if (user.includes("Synthesize the worker results")) {
    content = "Both delegated workers returned results. The independent verifier checked the required completion evidence.";
  } else if (user.includes("EVIDENCE-FIRST RULES")) {
    if (user.includes("FORCE_MISSING_EVIDENCE_TEST") && !missingEvidenceSentOnce) {
      missingEvidenceSentOnce = true;
      content = "FACT: The assigned worker completed its bounded analysis, but deliberately omitted the required evidence index.";
    } else {
      content = "FACT: The assigned worker completed its bounded analysis.\nEVIDENCE INDEX:\nworker completion | FACT | runtime event | task.completed | the worker task completed successfully";
    }
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
    MAX_WORKER_REPLACEMENTS: "1",
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

    const stateResponse = await request("/api/state", { headers: { "x-ai-office-audit-token": token } });
    const runtimeState = stateResponse.ok ? await stateResponse.json() : null;
    const relevantEvents = (runtimeState?.events || []).filter(event => /preflight|model_scout|gateway\.route/.test(event.type || ""));
    assert.equal(finalTask?.status, "completed", `root task did not complete; state=${JSON.stringify({
      status: finalTask?.status,
      error: finalTask?.error,
      model: finalTask?.model,
      plannerModel: finalTask?.plannerModel,
      verification: finalTask?.verification,
      workerResults: finalTask?.workerResults,
      relevantEvents
    })}\n${output}`);
    assert.equal(finalTask.verification?.status, "PASS");
    assert.equal(finalTask.verification.checks.length, 2);
    assert.ok(finalTask.verification.checks.every(check => check.passed === true && check.referenceGrounded === true));
    assert.equal(finalTask.workerResults.length, 2);
    assert.ok(finalTask.workerResults.every(worker => worker.status === "completed" && worker.result));
    assert.ok(finalTask.subtaskIds.length === 2);
    assert.ok(mockRequests >= 5, `expected planner + workers + synthesis + verifier requests, got ${mockRequests}`);

    // A worker that returns prose but omits the mandatory evidence index must fail,
    // then the parent must recover with a replacement instead of treating it as success.
    const missingEvidenceResponse = await request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", "x-ai-office-audit-token": token },
      body: JSON.stringify({ task: "FORCE_MISSING_EVIDENCE_TEST: require a worker replacement after missing evidence.", employeeId: "chief" })
    });
    const missingEvidenceText = await missingEvidenceResponse.text();
    assert.equal(missingEvidenceResponse.status, 202, missingEvidenceText);
    const missingEvidenceAccepted = JSON.parse(missingEvidenceText);
    let missingEvidenceRoot;
    const missingEvidenceEventMap = new Map();
    const missingEvidenceDeadline = Date.now() + 25000;
    while (Date.now() < missingEvidenceDeadline) {
      const response = await request(`/api/tasks/${encodeURIComponent(missingEvidenceAccepted.task.id)}`, {
        headers: { "x-ai-office-audit-token": token }
      });
      assert.equal(response.status, 200);
      missingEvidenceRoot = (await response.json()).task;

      // /api/state intentionally exposes only the latest 100 runtime events.
      // Capture this security-relevant rejection while the task runs so a busy
      // replacement/recovery sequence cannot evict it before the final assertion.
      const stateResponse = await request("/api/state", {
        headers: { "x-ai-office-audit-token": token }
      });
      if (stateResponse.ok) {
        const state = await stateResponse.json();
        for (const event of state.events || []) {
          if (event.type === "worker.evidence_index_missing") {
            missingEvidenceEventMap.set(event.id, event);
          }
        }
      }

      if (["completed", "failed"].includes(missingEvidenceRoot.status)) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const missingEvidenceStateResponse = await request("/api/state", { headers: { "x-ai-office-audit-token": token } });
    const missingEvidenceState = missingEvidenceStateResponse.ok ? await missingEvidenceStateResponse.json() : null;
    for (const event of missingEvidenceState?.events || []) {
      if (event.type === "worker.evidence_index_missing") {
        missingEvidenceEventMap.set(event.id, event);
      }
    }
    const missingEvidenceEvents = [...missingEvidenceEventMap.values()];
    assert.equal(missingEvidenceRoot?.status, "completed", `missing-evidence worker was not recovered: ${JSON.stringify({
      status: missingEvidenceRoot?.status,
      error: missingEvidenceRoot?.error,
      workerResults: missingEvidenceRoot?.workerResults,
      missingEvidenceEvents
    })}\n${output}`);
    assert.ok(missingEvidenceEvents.length >= 1, "runtime did not record the missing evidence index");
    assert.ok(missingEvidenceRoot.workerResults.some(worker =>
      worker.status === "failed" && String(worker.error || "").includes("missing required EVIDENCE INDEX")
    ), "worker missing evidence was incorrectly marked completed");
    assert.ok(missingEvidenceRoot.workerResults.some(worker =>
      worker.status === "completed" && worker.replacesTaskId
    ), "a replacement worker did not complete after missing evidence");

    const recoveryAcceptedResponse = await request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", "x-ai-office-audit-token": token },
      body: JSON.stringify({ task: "FORCE_RECOVERY_TEST: exercise root recovery and independent retest.", employeeId: "chief" })
    });
    const recoveryAcceptedText = await recoveryAcceptedResponse.text();
    assert.equal(recoveryAcceptedResponse.status, 202, recoveryAcceptedText);
    const recoveryAccepted = JSON.parse(recoveryAcceptedText);
    let recoveredRoot;
    const recoveryDeadline = Date.now() + 25000;
    while (Date.now() < recoveryDeadline) {
      const response = await request(`/api/tasks/${encodeURIComponent(recoveryAccepted.task.id)}`, {
        headers: { "x-ai-office-audit-token": token }
      });
      assert.equal(response.status, 200);
      recoveredRoot = (await response.json()).task;
      if (["completed", "failed"].includes(recoveredRoot.status)) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const recoveryStateResponse = await request("/api/state", { headers: { "x-ai-office-audit-token": token } });
    const recoveryState = recoveryStateResponse.ok ? await recoveryStateResponse.json() : null;
    const recoveryEvents = (recoveryState?.events || []).filter(event =>
      event.taskId === recoveryAccepted.task.id && ["verification.failed", "recovery.requested", "recovery.success", "retest.requested", "retest.passed"].includes(event.type)
    );
    assert.equal(recoveredRoot?.status, "completed", `root recovery/retest did not complete: ${JSON.stringify({
      status: recoveredRoot?.status,
      error: recoveredRoot?.error,
      verification: recoveredRoot?.verification,
      recoveryAttempts: recoveredRoot?.recoveryAttempts,
      recoveryHistory: recoveredRoot?.recoveryHistory,
      recoveryEvents
    })}\n${output}`);
    assert.equal(recoveredRoot.verification?.status, "PASS");
    assert.equal(recoveredRoot.recoveryAttempts, 1);
    assert.ok(recoveredRoot.recoveryHistory.some(item => item.status === "completed"));
    assert.ok(recoveryEvents.some(event => event.type === "recovery.success"));
    assert.ok(recoveryEvents.some(event => event.type === "retest.passed"));

    // Submit two independent roots together to catch shared mutable state and task-ID collisions.
    const concurrentAccepted = await Promise.all(["CONCURRENT_A", "CONCURRENT_B"].map(async marker => {
      const response = await request("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ai-office-audit-token": token },
        body: JSON.stringify({ task: `${marker}: verify independent concurrent task handling.`, employeeId: "chief" })
      });
      const responseText = await response.text();
      assert.equal(response.status, 202, responseText);
      const body = JSON.parse(responseText);
      assert.ok(body.task?.id);
      return { marker, id: body.task.id };
    }));
    assert.notEqual(concurrentAccepted[0].id, concurrentAccepted[1].id);
    const concurrentDeadline = Date.now() + 30000;
    const concurrentFinal = new Map();
    while (Date.now() < concurrentDeadline && concurrentFinal.size < concurrentAccepted.length) {
      await Promise.all(concurrentAccepted.map(async item => {
        if (concurrentFinal.has(item.id)) return;
        const response = await request(`/api/tasks/${encodeURIComponent(item.id)}`, {
          headers: { "x-ai-office-audit-token": token }
        });
        assert.equal(response.status, 200);
        const task = (await response.json()).task;
        if (["completed", "failed"].includes(task.status)) concurrentFinal.set(item.id, task);
      }));
      if (concurrentFinal.size < concurrentAccepted.length) await new Promise(resolve => setTimeout(resolve, 200));
    }
    for (const item of concurrentAccepted) {
      const task = concurrentFinal.get(item.id);
      assert.equal(task?.status, "completed", `concurrent task ${item.marker} did not complete: ${JSON.stringify({
        status: task?.status,
        error: task?.error,
        verification: task?.verification,
        workerResults: task?.workerResults
      })}\n${output}`);
      assert.equal(task.verification?.status, "PASS");
      assert.equal(task.workerResults?.length, 2);
      assert.ok(task.workerResults.every(worker => worker.status === "completed" && worker.result));
    }
  } finally {
    child.kill("SIGTERM");
    await Promise.race([waitForExit, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await new Promise(resolve => mockAi.close(resolve));
  }
});
