/**
 * Thin client for the existing AI-OFFICE runtime.
 *
 * This is an integration boundary, not a second task engine. The legacy
 * runtime remains responsible for planning, specialist execution, tools,
 * persistence, recovery, and independent verification.
 *
 * Important: submitTask deliberately does not retry POST requests. The
 * current runtime API has no idempotency key, so an automatic retry could
 * create duplicate tasks.
 */

export class OfficeRuntimeError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = "OfficeRuntimeError";
    this.status = status;
    this.code = code;
  }
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}

export function createOfficeRuntimeClient({
  baseUrl,
  auditToken,
  fetchImpl = globalThis.fetch,
}) {
  const normalizedBaseUrl = requiredString(baseUrl, "baseUrl").replace(/\/+$/, "");
  const token = requiredString(auditToken, "auditToken");

  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  async function request(path, { method = "GET", body = undefined, authenticated = true } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authenticated) headers["x-ai-office-audit-token"] = token;

    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw new OfficeRuntimeError(
        `AI-OFFICE runtime request failed: ${error?.message || String(error)}`,
        { code: "RUNTIME_UNREACHABLE" },
      );
    }

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      throw new OfficeRuntimeError("AI-OFFICE runtime returned invalid JSON", {
        status: response.status,
        code: "INVALID_RUNTIME_RESPONSE",
      });
    }

    if (!response.ok || data?.ok === false) {
      throw new OfficeRuntimeError(
        String(data?.error || `AI-OFFICE runtime returned HTTP ${response.status}`),
        {
          status: response.status,
          code: data?.code || "RUNTIME_REQUEST_REJECTED",
        },
      );
    }

    return data;
  }

  return Object.freeze({
    async health() {
      return request("/health", { authenticated: false });
    },

    async submitTask({
      task,
      employeeId = "chief",
      parentTaskId = null,
      kind = "root",
    }) {
      const taskText = requiredString(task, "task");
      const employee = requiredString(employeeId, "employeeId");
      return request("/api/tasks", {
        method: "POST",
        body: {
          task: taskText,
          employeeId: employee,
          parentTaskId,
          kind,
        },
      });
    },

    async getTask(taskId) {
      const id = requiredString(taskId, "taskId");
      return request(`/api/tasks/${encodeURIComponent(id)}`);
    },

    async getState() {
      return request("/api/state");
    },
  });
}
