/**
 * Narrow GitHub workspace tools for autonomous Studio workers.
 * Operations are confined to an isolated branch and dedicated source prefix.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(field + " is required");
  return value.trim();
}

function safePath(value, allowedPrefix) {
  const path = required(value, "path");
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  if (normalized.startsWith("/") || normalized.includes("\\") ||
      normalized.split("/").some(part => !part || part === "." || part === "..")) {
    throw Object.assign(new Error("Workspace path rejected"), { code: "WORKSPACE_PATH_REJECTED" });
  }
  if (!(normalized === allowedPrefix.slice(0, -1) || normalized.startsWith(allowedPrefix)) ||
      /(^|\/)(\.env|secrets?|credentials?)(\/|$)/i.test(normalized) ||
      /(^|\/)(\.git|\.github\/workflows)(\/|$)/i.test(normalized)) {
    throw Object.assign(new Error("Workspace path is outside the permitted source area"), { code: "WORKSPACE_PATH_REJECTED" });
  }
  return normalized;
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
  fetchImpl = globalThis.fetch,
  maxFileBytes = 256 * 1024,
  maxReadLines = 500,
}) {
  const repositoryOwner = required(owner, "owner");
  const repositoryName = required(repo, "repo");
  const targetBranch = required(branch, "branch");
  const credential = required(token, "token");
  const prefix = required(allowedPrefix, "allowedPrefix");
  if (!prefix.endsWith("/")) throw new TypeError("allowedPrefix must end with /");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > 1024 * 1024) throw new TypeError("maxFileBytes must be between 1 and 1048576");
  if (!Number.isInteger(maxReadLines) || maxReadLines < 1 || maxReadLines > 2000) throw new TypeError("maxReadLines must be between 1 and 2000");

  const api = "https://api.github.com/repos/" + encodeURIComponent(repositoryOwner) + "/" + encodeURIComponent(repositoryName) + "/contents";
  async function request(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        headers: {
          accept: "application/vnd.github+json",
          authorization: "Bearer " + credential,
          "x-github-api-version": "2022-11-28",
          ...(options.headers || {}),
        },
      });
    } catch {
      throw Object.assign(new Error("GitHub workspace is unavailable"), { code: "WORKSPACE_UNAVAILABLE" });
    }
    return parseResponse(response);
  }

  function encodedPath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }
  async function fetchFile(path) {
    const file = await request(api + "/" + encodedPath(path) + "?ref=" + encodeURIComponent(targetBranch));
    if (file.type !== "file" || typeof file.content !== "string") {
      throw Object.assign(new Error("Workspace path is not a readable file"), { code: "WORKSPACE_INVALID_FILE" });
    }
    const content = Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
    if (Buffer.byteLength(content, "utf8") > maxFileBytes) throw Object.assign(new Error("Workspace file exceeds size limit"), { code: "WORKSPACE_FILE_TOO_LARGE" });
    return { content, sha: file.sha };
  }
  async function saveFile(path, content, message, sha) {
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
    });
    return { path, branch: targetBranch, commitSha: saved.commit?.sha || null, blobSha: saved.content?.sha || null, url: saved.content?.html_url || null };
  }

  const definitions = Object.freeze([
    { type: "function", function: { name: "list_repo_directory", description: "List files and directories in an allowed workspace directory.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } },
    { type: "function", function: { name: "read_repo_file", description: "Read a UTF-8 file, optionally returning only a bounded inclusive line range. Prefer narrow ranges over whole-file reads.", parameters: { type: "object", properties: { path: { type: "string" }, start_line: { type: "integer", minimum: 1 }, end_line: { type: "integer", minimum: 1 } }, required: ["path"], additionalProperties: false } } },
    { type: "function", function: { name: "write_repo_file", description: "Create or replace a UTF-8 source file in the isolated workspace branch. Use patch_repo_file for small edits to existing files.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string" } }, required: ["path", "content", "message"], additionalProperties: false } } },
    { type: "function", function: { name: "patch_repo_file", description: "Replace only an inclusive line range (or insert at a line) in an existing file. Supply the blob SHA from the latest read to prevent overwriting concurrent changes.", parameters: { type: "object", properties: { path: { type: "string" }, start_line: { type: "integer", minimum: 1 }, end_line: { type: "integer", minimum: 0 }, replacement: { type: "string" }, expected_sha: { type: "string" }, message: { type: "string" } }, required: ["path", "start_line", "end_line", "replacement", "expected_sha", "message"], additionalProperties: false } } },
  ]);

  async function execute(name, args = {}) {
    if (name === "list_repo_directory") {
      const path = safePath(args.path, prefix);
      const items = await request(api + "/" + encodedPath(path) + "?ref=" + encodeURIComponent(targetBranch));
      if (!Array.isArray(items)) throw Object.assign(new Error("Expected a directory listing"), { code: "WORKSPACE_INVALID_RESPONSE" });
      return items.map(item => ({ name: item.name, path: item.path, type: item.type, size: item.size }));
    }
    if (name === "read_repo_file") {
      const path = safePath(args.path, prefix);
      const file = await fetchFile(path);
      const lines = file.content.split("\n");
      const start = args.start_line === undefined ? 1 : args.start_line;
      const end = args.end_line === undefined ? lines.length : args.end_line;
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start) throw Object.assign(new Error("Invalid inclusive line range"), { code: "WORKSPACE_INVALID_RANGE" });
      const boundedEnd = Math.min(end, start + maxReadLines - 1, lines.length);
      const selected = lines.slice(start - 1, boundedEnd);
      return {
        path, content: selected.join("\n"), sha: file.sha,
        range: { startLine: start, endLine: boundedEnd, totalLines: lines.length },
        truncated: boundedEnd < Math.min(end, lines.length),
      };
    }
    if (name === "write_repo_file") {
      const path = safePath(args.path, prefix);
      if (typeof args.content !== "string" || !args.content.length) throw new TypeError("content must be a non-empty string");
      let existing = null;
      try { existing = await fetchFile(path); }
      catch (error) { if (error.code !== "WORKSPACE_NOT_FOUND") throw error; }
      return saveFile(path, args.content, args.message, existing?.sha);
    }
    if (name === "patch_repo_file") {
      const path = safePath(args.path, prefix);
      const start = args.start_line;
      const end = args.end_line;
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < 0 || end < start - 1) throw Object.assign(new Error("Invalid patch line range"), { code: "WORKSPACE_INVALID_RANGE" });
      if (typeof args.replacement !== "string") throw new TypeError("replacement must be a string");
      const current = await fetchFile(path);
      if (current.sha !== args.expected_sha) throw Object.assign(new Error("File changed since it was read; fetch the latest version before patching"), { code: "WORKSPACE_WRITE_CONFLICT" });
      const lines = current.content.split("\n");
      if (start > lines.length + 1 || end > lines.length) throw Object.assign(new Error("Patch range exceeds file length"), { code: "WORKSPACE_INVALID_RANGE" });
      const replacement = args.replacement.length ? args.replacement.split("\n") : [];
      const next = [...lines.slice(0, start - 1), ...replacement, ...lines.slice(end)];
      return saveFile(path, next.join("\n"), args.message, current.sha);
    }
    throw Object.assign(new Error("Tool is not permitted"), { code: "WORKSPACE_TOOL_NOT_ALLOWED" });
  }

  return Object.freeze({
    definitions,
    allowedToolNames: Object.freeze(definitions.map(item => item.function.name)),
    async execute({ name, arguments: rawArguments }) {
      let args;
      try { args = typeof rawArguments === "string" ? JSON.parse(rawArguments) : rawArguments; }
      catch { throw Object.assign(new Error("Tool arguments are invalid JSON"), { code: "WORKSPACE_INVALID_ARGUMENTS" }); }
      if (!args || typeof args !== "object" || Array.isArray(args)) throw Object.assign(new Error("Tool arguments must be an object"), { code: "WORKSPACE_INVALID_ARGUMENTS" });
      return execute(name, args);
    },
  });
}
