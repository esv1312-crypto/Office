/**
 * Provider-neutral Worker Runtime for Universal AI Studio.
 *
 * This module executes one already-assigned task through an injected model
 * gateway. It has no dependency on the legacy Office runtime, HTTP, or a
 * concrete database/provider SDK.
 *
 * Required store contract:
 * - startExecution({ taskId, specialistId, workerId, at })
 *   Atomically verifies task.status === "assigned" and the assignment matches,
 *   transitions it to "running", and creates a durable execution record.
 * - completeExecution({ executionId, output, modelSnapshot, artifact, at })
 *   Atomically stores the output/artifact and transitions the task to "qa".
 * - failExecution({ executionId, reason, at })
 *   Durably records a model execution failure and transitions the task to
 *   "failed". It must be idempotent for a given execution.
 *
 * Persistence and concurrency guarantees belong to the injected store.
 */

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}

function runtimeToolEvidenceSection(value) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const allowedNames = new Set(["list_repo_directory", "read_repo_file", "write_repo_file", "patch_repo_file"]);
  const records = value.filter(item =>
    item && typeof item === "object" && allowedNames.has(item.name) &&
    (item.status === "ok" || item.status === "error")
  ).map(item => {
    const record = { name: item.name, status: item.status };
    for (const key of ["path", "branch", "sha", "blobSha", "commitSha", "error"]) {
      if (typeof item[key] === "string") record[key] = item[key];
    }
    if (typeof item.contentKind === "string") record.contentKind = item.contentKind;
    if (typeof item.content === "string" && Buffer.byteLength(item.content, "utf8") <= 8192) {
      record.content = item.content;
    }
    if (item.contentTruncated === true) {
      record.contentTruncated = true;
      if (Number.isInteger(item.contentBytes)) record.contentBytes = item.contentBytes;
    }
    if (item.range && typeof item.range === "object" &&
        [item.range.startLine, item.range.endLine, item.range.totalLines].every(Number.isInteger)) {
      record.range = {
        startLine: item.range.startLine,
        endLine: item.range.endLine,
        totalLines: item.range.totalLines,
      };
    }
    return record;
  });
  if (!records.length) return "";
  return "\n\n## Runtime-verified tool evidence\n\n\x60\x60\x60json\n" +
    JSON.stringify(records, null, 2) + "\n\x60\x60\x60";
}

function safeModelSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Model gateway must return a modelSnapshot object");
  }
  return value;
}

function safePathSegment(value, field) {
  const segment = requiredString(value, field);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(segment)) {
    throw Object.assign(new Error(`${field} cannot be used in an artifact path`), {
      code: "ARTIFACT_PATH_REJECTED",
    });
  }
  return segment;
}

function defaultArtifactPath({ task }) {
  const project = safePathSegment(task.projectId, "task.projectId");
  const taskId = safePathSegment(task.id, "task.id");
  return `studio/projects/${project}/artifacts/${taskId}.md`;
}

export function createWorkerRuntime({
  store,
  modelGateway,
  artifactWriter = null,
  artifactPathForTask = defaultArtifactPath,
  now = () => new Date().toISOString(),
  leaseMs = 300_000,
  heartbeatIntervalMs = 20_000,
  modelTimeoutMs = 180_000,
}) {
  if (!store ||
      typeof store.startExecution !== "function" ||
      typeof store.completeExecution !== "function" ||
      typeof store.failExecution !== "function") {
    throw new TypeError("Worker Runtime requires the durable execution store contract");
  }
  if (!modelGateway || typeof modelGateway.generate !== "function") {
    throw new TypeError("modelGateway.generate is required");
  }
  if (artifactWriter !== null && typeof artifactWriter?.writeTextArtifact !== "function") {
    throw new TypeError("artifactWriter.writeTextArtifact is required when an artifact writer is configured");
  }
  if (typeof artifactPathForTask !== "function") throw new TypeError("artifactPathForTask must be a function");
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000) throw new TypeError("leaseMs must be an integer of at least 1000");
  if (!Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 100 || heartbeatIntervalMs >= leaseMs) {
    throw new TypeError("heartbeatIntervalMs must be at least 100 and shorter than leaseMs");
  }
  if (!Number.isInteger(modelTimeoutMs) || modelTimeoutMs < 1_000 || modelTimeoutMs > 600_000) {
    throw new TypeError("modelTimeoutMs must be between 1000 and 600000");
  }

  return Object.freeze({
    async heartbeat({ executionId, fencingToken, leaseToken, leaseMs }) {
      if (typeof store.heartbeatExecution !== "function") throw new Error("Execution store does not support lease heartbeats");
      return store.heartbeatExecution({ executionId, fencingToken, leaseToken, leaseMs, at: now() });
    },

    async execute({ taskId, specialist, workerId }) {
      const id = requiredString(taskId, "taskId");
      const worker = requiredString(workerId, "workerId");
      if (!specialist || typeof specialist !== "object") {
        throw new TypeError("specialist is required");
      }
      const specialistId = requiredString(specialist.id, "specialist.id");
      requiredString(specialist.role, "specialist.role");
      requiredString(specialist.instructions, "specialist.instructions");

      const started = await store.startExecution({
        taskId: id,
        specialistId,
        workerId: worker,
        at: now(),
        leaseMs,
      });
      if (!started || !started.executionId || !started.task ||
          !Number.isInteger(started.execution?.fencingToken) || !started.execution?.leaseToken) {
        throw new Error("Execution store returned an invalid start result");
      }
      if (started.task.status !== "running" ||
          started.task.assigneeSpecialistId !== specialistId) {
        throw new Error("Execution store did not return the claimed running task");
      }

      let generated;
      let leaseError = null;
      let heartbeatInFlight = null;
      let heartbeatStopped = false;
      let firstHeartbeatLogged = false;
      const abortController = new AbortController();
      console.info("[studio-worker] execution started", {
        executionId: started.executionId, taskId: id, specialistId, attempt: started.execution.attempt,
        heartbeatEnabled: typeof store.heartbeatExecution === "function",
      });
      const renewLease = async () => {
        if (heartbeatInFlight || leaseError) return heartbeatInFlight;
        heartbeatInFlight = store.heartbeatExecution({
          executionId: started.executionId,
          fencingToken: started.execution.fencingToken,
          leaseToken: started.execution.leaseToken,
          leaseMs,
          at: now(),
        }).then(result => {
          if (!firstHeartbeatLogged) {
            firstHeartbeatLogged = true;
            console.info("[studio-worker] lease heartbeat confirmed", {
              executionId: started.executionId,
              leaseExpiresAt: result?.leaseExpiresAt || null,
            });
          }
          return result;
        }).catch(error => {
          leaseError = error;
          console.warn("[studio-worker] lease heartbeat failed", {
            executionId: started.executionId,
            code: error?.code || "HEARTBEAT_FAILED",
          });
          abortController.abort(error);
        }).finally(() => { heartbeatInFlight = null; });
        return heartbeatInFlight;
      };
      const heartbeatTimer = typeof store.heartbeatExecution === "function"
        ? setInterval(() => { void renewLease(); }, heartbeatIntervalMs)
        : null;
      const stopHeartbeat = async () => {
        if (heartbeatStopped) return;
        heartbeatStopped = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (heartbeatInFlight) await heartbeatInFlight;
      };
      let modelTimeoutTimer;
      try {
        // Confirm lease ownership immediately; do not leave the first provider call
        // running on a lease that has never been renewed by this worker.
        await renewLease();
        if (leaseError) throw leaseError;
        console.info("[studio-worker] model generation started", { executionId: started.executionId, taskId: id });
        const deadline = new Promise((_, reject) => {
          modelTimeoutTimer = setTimeout(() => {
            const error = Object.assign(new Error("Worker model execution exceeded its deadline"), {
              code: "MODEL_EXECUTION_TIMEOUT",
            });
            console.warn("[studio-worker] model deadline reached", { executionId: started.executionId });
            abortController.abort(error);
            reject(error);
          }, modelTimeoutMs);
        });
        const generation = Promise.resolve().then(() => modelGateway.generate({
          task: started.task,
          specialist: {
            id: specialistId,
            role: specialist.role,
            instructions: specialist.instructions,
            competencies: specialist.competencies || [],
            allowedTools: Array.isArray(specialist.allowedTools) ? specialist.allowedTools : [],
            modelProfile: specialist.modelProfile || null,
          },
          execution: started.execution,
          signal: abortController.signal,
        }));
        generated = await Promise.race([generation, deadline]);
        clearTimeout(modelTimeoutTimer);
        console.info("[studio-worker] model generation completed", {
          executionId: started.executionId,
          toolCalls: Array.isArray(generated?.toolEvidence) ? generated.toolEvidence.length : 0,
        });
        if (leaseError) throw leaseError;
        if (!generated || typeof generated.text !== "string" || !generated.text.trim()) {
          throw Object.assign(new Error("Model gateway returned an empty result"), {
            code: "EMPTY_MODEL_OUTPUT",
          });
        }
        safeModelSnapshot(generated.modelSnapshot);
      } catch (error) {
        if (modelTimeoutTimer) clearTimeout(modelTimeoutTimer);
        await stopHeartbeat();
        if (leaseError || error?.code === "EXECUTION_LEASE_LOST") {
          const lost = leaseError || error;
          return {
            executionId: started.executionId,
            taskId: id,
            status: "lease_lost",
            errorCode: lost.code || "EXECUTION_LEASE_LOST",
            error: String(lost.message || lost),
          };
        }
        const reason = String(error?.message || error).slice(0, 1000);
        await store.failExecution({
          executionId: started.executionId,
          reason,
          fencingToken: started.execution.fencingToken,
          leaseToken: started.execution.leaseToken,
          at: now(),
        });
        return {
          executionId: started.executionId,
          taskId: id,
          status: "failed",
          errorCode: error?.code || "MODEL_EXECUTION_FAILED",
          error: reason,
        };
      }

      const output = generated.text.trim() + runtimeToolEvidenceSection(generated.toolEvidence);
      let externalArtifact = null;
      if (artifactWriter && started.task.externalArtifact !== false) {
        try {
          const path = artifactPathForTask({
            task: started.task,
            specialistId,
            executionId: started.executionId,
          });
          console.info("[studio-worker] artifact persistence started", { executionId: started.executionId, path });
          externalArtifact = await artifactWriter.writeTextArtifact({
            path,
            content: output,
            provenance: {
              projectId: started.task.projectId,
              taskId: id,
              executionId: started.executionId,
              specialistId,
            },
            signal: abortController.signal,
          });
          console.info("[studio-worker] artifact persistence completed", {
            executionId: started.executionId,
            commitSha: externalArtifact?.commitSha || null,
          });
        } catch (error) {
          if (leaseError || error?.code === "ARTIFACT_REPOSITORY_ABORTED" ||
              error?.code === "EXECUTION_LEASE_LOST") {
            await stopHeartbeat();
            const lost = leaseError || error;
            return {
              executionId: started.executionId,
              taskId: id,
              status: "lease_lost",
              errorCode: lost.code || "EXECUTION_LEASE_LOST",
              error: String(lost.message || lost),
            };
          }
          const reason = "Artifact repository write failed";
          try {
            await store.failExecution({
              executionId: started.executionId,
              reason,
              fencingToken: started.execution.fencingToken,
              leaseToken: started.execution.leaseToken,
              at: now(),
            });
          } finally {
            await stopHeartbeat();
          }
          return {
            executionId: started.executionId,
            taskId: id,
            status: "failed",
            errorCode: error?.code || "ARTIFACT_WRITE_FAILED",
            error: reason,
          };
        }
      }

      if (leaseError) {
        await stopHeartbeat();
        return {
          executionId: started.executionId,
          taskId: id,
          status: "lease_lost",
          errorCode: leaseError.code || "EXECUTION_LEASE_LOST",
          error: String(leaseError.message || leaseError),
        };
      }

      const artifact = {
        type: "text",
        name: `${started.task.title} — результат работы`,
        content: output,
        createdByWorkerId: worker,
        specialistId,
        ...(externalArtifact ? { external: externalArtifact } : {}),
      };

      // Keep persistence outside the model-error catch. If durable completion
      // fails, leave recovery to the store/lease reconciler rather than
      // incorrectly marking a successfully generated result as model-failed.
      let completed;
      try {
        completed = await store.completeExecution({
          executionId: started.executionId,
          output,
          modelSnapshot: generated.modelSnapshot,
          artifact,
          fencingToken: started.execution.fencingToken,
          leaseToken: started.execution.leaseToken,
          at: now(),
        });
      } finally {
        await stopHeartbeat();
      }

      if (!completed || completed.task?.status !== "qa" || !completed.artifactId) {
        throw new Error("Execution store did not confirm durable artifact and QA hand-off");
      }

      return {
        executionId: started.executionId,
        taskId: id,
        status: "qa",
        artifactId: completed.artifactId,
        output,
        modelSnapshot: generated.modelSnapshot,
        externalArtifact,
      };
    },
  });
}
