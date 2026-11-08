/**
 * Narrow GitHub workspace tools for autonomous Studio workers.
 * Operations are confined to an isolated branch and dedicated source prefix.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(field + " is required");
  return value.trim();
}

function normalizedPath(value) {
  const path = required(value, "path");
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  if (normalized.startsWith("/") || normalized.includes("\\") ||
      normalized.split("/").some(part => !part || part === "." || part === "..")) {
    throw Object.assign(new Error("Workspace path rejected"), { code: "WORKSPACE_PATH_REJECTED" });
  }
  return normalized;
}

function safeReadPath(value) {
  const normalized = normalizedPath(value);
  if (/(^|\/)(\.env|secrets?|credentials?)(\/|$)/i.test(normalized) ||
      /(^|\/)(\.git|\.github\/workflows|projects)(\/|$)/i.test(normalized)) {
    throw Object.assign(new Error("Repository path is excluded from read access"), { code: "WORKSPACE_PATH_REJECTED" });
  }
  return normalized;
}

function safePath(value, allowedPrefix) {
  const normalized = normalizedPath(value);
  if (!(normalized === allowedPrefix.slice(0, -1) || normalized.startsWith(allowedPrefix)) ||
      /(^|\/)(\.env|secrets?|credentials?)(\/|$)/i.test(normalized) ||
      /(^|\/)(\.git|\.github\/workflows)(\/|$)/i.test(normalized)) {
    throw Object.assign(new Error("Workspace path is outside the permitted write area"), { code: "WORKSPACE_PATH_REJECTED" });
  }
  return normalized;
}

function safeWorkspacePath(value, allowedPrefix) {
  const candidate = required(value, "path");
  const normalized = normalizedPath(candidate);
  if (normalized.startsWith("studio/") &&
      normalized !== allowedPrefix.slice(0, -1) &&
      !normalized.startsWith(allowedPrefix)) {
    throw Object.assign(new Error("Repository-root paths are not permitted for workspace writes"), { code: "WORKSPACE_PATH_REJECTED" });
  }
  const scoped = normalized === allowedPrefix.slice(0, -1) || normalized.startsWith(allowedPrefix)
    ? normalized
    : allowedPrefix + normalized;
  return safePath(scoped, allowedPrefix);
}

function safeWorkspaceOrReadPath(value, allowedPrefix) {
  const normalized = normalizedPath(value);
  if (normalized.startsWith("studio/") &&
      normalized !== allowedPrefix.slice(0, -1) &&
      !normalized.startsWith(allowedPrefix)) {
    return safeReadPath(normalized);
  }
  return safeWorkspacePath(normalized, allowedPrefix);
}

async function parseResponse(response) {
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const code = response.status === 404 ? "WORKSPACE_NOT_FOUND"
      : response.status === 409 || response.status === 422 ? "WORKSPACE_WRITE_CONFLICT"
      : response.status === 401 || response.status === 403 ? "WORKSPACE_FORBIDDEN"
      : "WORKSPACE_GITHUB_ERROR";
    throw Object.assign(new Error("GitHub workspace request failed"), { code, status: response.status });
  }
  return body;
}

export function createGithubWorkspaceTools({
  owner, repo, branch, token,
  allowedPrefix = "studio/agent-workspace/",
  readBranch = branch,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 20_000,
  maxFileBytes = 256 * 1024,
  maxReadLines = 500,
}) {
  const repositoryOwner = required(owner, "owner");
  const repositoryName = required(repo, "repo");
  const targetBranch = required(branch, "branch");
  const sourceBranch = required(readBranch, "readBranch");
  const credential = required(token, "token");
  const prefix = required(allowedPrefix, "allowedPrefix");
  if (!prefix.endsWith("/")) throw new TypeError("allowedPrefix must end with /");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 120_000) throw new TypeError("requestTimeoutMs must be between 1000 and 120000");
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > 1024 * 1024) throw new TypeError("maxFileBytes must be between 1 and 1048576");
  if (!Number.isInteger(maxReadLines) || maxReadLines < 1 || maxReadLines > 2000) throw new TypeError("maxReadLines must be between 1 and 2000");

  const api = "https://api.github.com/repos/" + encodeURIComponent(repositoryOwner) + "/" + encodeURIComponent(repositoryName) + "/contents";
  async function request(url, options = {}) {
    const controller = new AbortController();
    const externalSignal = options.signal;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) controller.abort(externalSignal.reason);
    else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: controller.signal,
        headers: {
          accept: "application/vnd.github+json",
          authorization: "Bearer " + credential,
          "x-github-api-version": "2022-11-28",
          ...(options.headers || {}),
        },
      });
      return await parseResponse(response);
    } catch (error) {
      if (error?.code && error.code !== "WORKSPACE_UNAVAILABLE") throw error;
      if (externalSignal?.aborted) {
        throw Object.assign(new Error("GitHub workspace request was aborted"), { code: "WORKSPACE_ABORTED" });
      }
      if (controller.signal.aborted) {
        throw Object.assign(new Error("GitHub workspace request timed out"), { code: "WORKSPACE_TIMEOUT" });
      }
      throw Object.assign(new Error("GitHub workspace is unavailable"), { code: "WORKSPACE_UNAVAILABLE" });
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }

  function encodedPath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }
  async function fetchFile(path, ref = targetBranch, signal) {
    const file = await request(api + "/" + encodedPath(path) + "?ref=" + encodeURIComponent(ref), { signal });
    if (file.type !== "file" || typeof file.content !== "string") {
      throw Object.assign(new Error("Workspace path is not a readable file"), { code: "WORKSPACE_INVALID_FILE" });
    }
    const content = Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
    if (Buffer.byteLength(content, "utf8") > maxFileBytes) throw Object.assign(new Error("Workspace file exceeds size limit"), { code: "WORKSPACE_FILE_TOO_LARGE" });
    return { content, sha: file.sha };
  }
  async function saveFile(path, content, message, sha, signal) {
    const bytes = Buffer.from(content, "utf8");
    if (bytes.byteLength > maxFileBytes) throw Object.assign(new Error("Workspace file exceeds size limit"), { code: "WORKSPACE_FILE_TOO_LARGE" });
    if (bytes.toString("utf8") !== content) throw new TypeError("content must be valid UTF-8 text");
    const payload = {
      message: required(message, "message").slice(0, 120),
      content: bytes.toString("base64"),
      branch: targetBranch,
      ...(sha ? { sha } : {}),
    };
    const saved = await request(api + "/" + encodedPath(path), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    return { path, branch: targetBranch, commitSha: saved.commit?.sha || null, blobSha: saved.content?.sha || null, url: saved.content?.html_url || null };
  }

  const definitions = Object.freeze([
    { type: "function", function: { name: "list_repo_directory", description: "List files and directories. Defaults to the isolated workspace branch. Use path '.' to list the workspace root, or a path relative to studio/agent-workspace/ (for example 'roblox-fan-district'). To list source code, explicitly set branch to the source branch and use a full repository path.", parameters: { type: "object", properties: { path: { type: "string" }, branch: { type: "string", enum: [sourceBranch, targetBranch] } }, required: ["path"], additionalProperties: false } } },
    { type: "function", function: { name: "read_repo_file", description: "Read a UTF-8 file. Defaults to the source branch and requires a full repository path. When branch is the isolated workspace branch, a path relative to studio/agent-workspace/ is automatically scoped into that workspace. Optionally return a bounded inclusive line range.", parameters: { type: "object", properties: { path: { type: "string" }, start_line: { type: "integer", minimum: 1 }, end_line: { type: "integer", minimum: 1 }, branch: { type: "string", enum: [sourceBranch, targetBranch] } }, required: ["path"], additionalProperties: false } } },
    { type: "function", function: { name: "write_repo_file", description: "Create or replace a UTF-8 source file in the isolated workspace branch. The path may be relative to studio/agent-workspace/ (for example 'roblox-fan-district/Server/Points.server.lua') or may include the full prefix. Relative paths are automatically scoped to studio/agent-workspace/. Never use absolute paths or '..'. After every successful write, call read_repo_file with the exact returned path and branch to verify the persisted content before claiming completion. Use patch_repo_file for small edits to existing files.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string" } }, required: ["path", "content", "message"], additionalProperties: false } } },
    { type: "function", function: { name: "patch_repo_file", description: "Replace only an inclusive line range (or insert at a line) in an existing workspace file. The path may be relative to studio/agent-workspace/ or may include the full prefix. Relative paths are automatically scoped to studio/agent-workspace/. Supply the blob SHA from the latest read to prevent overwriting concurrent changes.", parameters: { type: "object", properties: { path: { type: "string" }, start_line: { type: "integer", minimum: 1 }, end_line: { type: "integer", minimum: 0 }, replacement: { type: "string" }, expected_sha: { type: "string" }, message: { type: "string" } }, required: ["path", "start_line", "end_line", "replacement", "expected_sha", "message"], additionalProperties: false } } },
  ]);

  async function execute(name, args = {}, signal) {
    if (name === "list_repo_directory") {
      const readRef = args.branch === undefined ? targetBranch : required(args.branch, "branch");
      if (![sourceBranch, targetBranch].includes(readRef)) throw Object.assign(new Error("Repository read branch is not permitted"), { code: "WORKSPACE_BRANCH_REJECTED" });
      const rawPath = typeof args.path === "string" ? args.path.trim() : "";
      const path = readRef === targetBranch
        ? (rawPath === "" || rawPath === "." ? prefix.slice(0, -1) : safeWorkspaceOrReadPath(rawPath, prefix))
        : safeReadPath(rawPath);
      const items = await request(api + "/" + encodedPath(path) + "?ref=" + encodeURIComponent(readRef), { signal });
      if (!Array.isArray(items)) throw Object.assign(new Error("Expected a directory listing"), { code: "WORKSPACE_INVALID_RESPONSE" });
      return items.map(item => ({ name: item.name, path: item.path, type: item.type, size: item.size }));
    }
    if (name === "read_repo_file") {
      const readRef = args.branch === undefined ? sourceBranch : required(args.branch, "branch");
      if (![sourceBranch, targetBranch].includes(readRef)) throw Object.assign(new Error("Repository read branch is not permitted"), { code: "WORKSPACE_BRANCH_REJECTED" });
      const path = readRef === targetBranch
        ? safeWorkspaceOrReadPath(args.path, prefix)
        : safeReadPath(args.path);
      const file = await fetchFile(path, readRef, signal);
      const lines = file.content.split("\n");
      const start = args.start_line === undefined ? 1 : args.start_line;
      const end = args.end_line === undefined ? lines.length : args.end_line;
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start) throw Object.assign(new Error("Invalid inclusive line range"), { code: "WORKSPACE_INVALID_RANGE" });
      const boundedEnd = Math.min(end, start + maxReadLines - 1, lines.length);
      const selected = lines.slice(start - 1, boundedEnd);
      return {
        path, branch: readRef, content: selected.join("\n"), sha: file.sha,
        range: { startLine: start, endLine: boundedEnd, totalLines: lines.length },
        truncated: boundedEnd < Math.min(end, lines.length),
      };
    }
    if (name === "write_repo_file") {
      const path = safeWorkspacePath(args.path, prefix);
      if (typeof args.content !== "string" || !args.content.length) throw new TypeError("content must be a non-empty string");
      let existing = null;
      try { existing = await fetchFile(path, targetBranch, signal); }
      catch (error) { if (error.code !== "WORKSPACE_NOT_FOUND") throw error; }
      return saveFile(path, args.content, args.message, existing?.sha, signal);
    }
    if (name === "patch_repo_file") {
      const path = safeWorkspacePath(args.path, prefix);
      const start = args.start_line;
      const end = args.end_line;
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < 0 || end < start - 1) throw Object.assign(new Error("Invalid patch line range"), { code: "WORKSPACE_INVALID_RANGE" });
      if (typeof args.replacement !== "string") throw new TypeError("replacement must be a string");
      const current = await fetchFile(path, targetBranch, signal);
      if (current.sha !== args.expected_sha) throw Object.assign(new Error("File changed since it was read; fetch the latest version before patching"), { code: "WORKSPACE_WRITE_CONFLICT" });
      const lines = current.content.split("\n");
      if (start > lines.length + 1 || end > lines.length) throw Object.assign(new Error("Patch range exceeds file length"), { code: "WORKSPACE_INVALID_RANGE" });
      const replacement = args.replacement.length ? args.replacement.split("\n") : [];
      const next = [...lines.slice(0, start - 1), ...replacement, ...lines.slice(end)];
      return saveFile(path, next.join("\n"), args.message, current.sha, signal);
    }
    throw Object.assign(new Error("Tool is not permitted"), { code: "WORKSPACE_TOOL_NOT_ALLOWED" });
  }

  return Object.freeze({
    definitions,
    allowedToolNames: Object.freeze(definitions.map(item => item.function.name)),
    async execute({ name, arguments: rawArguments, signal }) {
      let args;
      try { args = typeof rawArguments === "string" ? JSON.parse(rawArguments) : rawArguments; }
      catch { throw Object.assign(new Error("Tool arguments are invalid JSON"), { code: "WORKSPACE_INVALID_ARGUMENTS" }); }
      if (!args || typeof args !== "object" || Array.isArray(args)) throw Object.assign(new Error("Tool arguments must be an object"), { code: "WORKSPACE_INVALID_ARGUMENTS" });
      return execute(name, args, signal);
    },
  });
}
