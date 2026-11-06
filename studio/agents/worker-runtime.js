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

function safeModelSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Model gateway must return a modelSnapshot object");
  }
  return value;
}

export function createWorkerRuntime({
  store,
  modelGateway,
  now = () => new Date().toISOString(),
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
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
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
      try {
        generated = await modelGateway.generate({
          task: started.task,
          specialist: {
            id: specialistId,
            role: specialist.role,
            instructions: specialist.instructions,
            modelProfile: specialist.modelProfile || null,
          },
          execution: started.execution,
        });
        if (!generated || typeof generated.text !== "string" || !generated.text.trim()) {
          throw Object.assign(new Error("Model gateway returned an empty result"), {
            code: "EMPTY_MODEL_OUTPUT",
          });
        }
        safeModelSnapshot(generated.modelSnapshot);
      } catch (error) {
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

      const output = generated.text.trim();
      const artifact = {
        type: "text",
        name: `${started.task.title} — результат работы`,
        content: output,
        createdByWorkerId: worker,
        specialistId,
      };

      // Keep persistence outside the model-error catch. If durable completion
      // fails, leave recovery to the store/lease reconciler rather than
      // incorrectly marking a successfully generated result as model-failed.
      const completed = await store.completeExecution({
        executionId: started.executionId,
        output,
        modelSnapshot: generated.modelSnapshot,
        artifact,
        fencingToken: started.execution.fencingToken,
        leaseToken: started.execution.leaseToken,
        at: now(),
      });

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
      };
    },
  });
}
