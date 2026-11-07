/**
 * Narrow GitHub workspace tools for autonomous Studio workers.
 * All operations are confined to an isolated branch and a dedicated prefix.
 * No shell, workflow, secret, environment, or production-branch access exists here.
 */
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
}

function safePath(value, allowedPrefix) {
  const path = required(value, "path");
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) {
    throw Object.assign(new Error("Workspace path rejected"), { code: "WORKSPACE_PATH_REJECTED" });
  }
  if (!path.startsWith(allowedPrefix) || /(^|\/)(\.env|secrets?|credentials?)(\/|$)/i.test(path) ||
      /(^|\/)(\.git|\.github\/workflows)(\/|$)/i.test(path)) {
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
  owner,
  repo,
  branch,
  token,
  allowedPrefix = "studio/agent-workspace/",
  fetchImpl = globalThis.fetch,
  maxFileBytes = 256 * 1024,
}) {
  const repositoryOwner = required(owner, "owner");
  const repositoryName = required(repo, "repo");
  const targetBranch = required(branch, "branch");
  const credential = required(token, "token");
  const prefix = required(allowedPrefix, "allowedPrefix");
  if (!prefix.endsWith("/")) throw new TypeError("allowedPrefix must end with /");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > 1024 * 1024) {
    throw new TypeError("maxFileBytes must be between 1 and 1048576");
  }

  const api = `https://api.github.com/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/contents`;
  async function request(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${credential}`,
          "x-github-api-version": "2022-11-28",
          ...(options.headers || {}),
        },
      });
    } catch {
      throw Object.assign(new Error("GitHub workspace is unavailable"), { code: "WORKSPACE_UNAVAILABLE" });
    }
    return parseResponse(response);
  }

  const definitions = Object.freeze([
    { type: "function", function: { name: "list_repo_directory", description: "List files and directories in an allowed workspace directory.", parameters: { type: "object", properties: { path: { type: "string", description: "Directory path under studio/agent-workspace/" } }, required: ["path"], additionalProperties: false } } },
    { type: "function", function: { name: "read_repo_file", description: "Read a UTF-8 source file from the isolated workspace branch.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } },
    { type: "function", function: { name: "write_repo_file", description: "Create or replace a UTF-8 source file in the isolated workspace branch.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string" } }, required: ["path", "content", "message"], additionalProperties: false } } },
  ]);

  async function execute(name, args = {}) {
    if (name === "list_repo_directory") {
      const path = safePath(args.path, prefix);
      const items = await request(`${api}/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(targetBranch)}`);
      if (!Array.isArray(items)) throw Object.assign(new Error("Expected a directory listing"), { code: "WORKSPACE_INVALID_RESPONSE" });
      return items.map(item => ({ name: item.name, path: item.path, type: item.type, size: item.size }));
    }
    if (name === "read_repo_file") {
      const path = safePath(args.path, prefix);
      const file = await request(`${api}/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(targetBranch)}`);
      if (file.type !== "file" || typeof file.content !== "string") {
        throw Object.assign(new Error("Workspace path is not a readable file"), { code: "WORKSPACE_INVALID_FILE" });
      }
      const content = Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
      if (Buffer.byteLength(content, "utf8") > maxFileBytes) throw Object.assign(new Error("Workspace file exceeds size limit"), { code: "WORKSPACE_FILE_TOO_LARGE" });
      return { path, content, sha: file.sha };
    }
    if (name === "write_repo_file") {
      const path = safePath(args.path, prefix);
      const content = args.content;
      const message = required(args.message, "message");
      if (typeof content !== "string" || !content.length) throw new TypeError("content must be a non-empty string");
      const bytes = Buffer.from(content, "utf8");
      if (bytes.byteLength > maxFileBytes) throw Object.assign(new Error("Workspace file exceeds size limit"), { code: "WORKSPACE_FILE_TOO_LARGE" });
      if (bytes.toString("utf8") !== content) throw new TypeError("content must be valid UTF-8 text");
      let existing = null;
      try {
        existing = await request(`${api}/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(targetBranch)}`);
      } catch (error) {
        if (error.code !== "WORKSPACE_NOT_FOUND") throw error;
      }
      const payload = {
        message: message.slice(0, 120),
        content: bytes.toString("base64"),
        branch: targetBranch,
        ...(existing?.sha ? { sha: existing.sha } : {}),
      };
      const saved = await request(`${api}/${path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { path, branch: targetBranch, commitSha: saved.commit?.sha || null, blobSha: saved.content?.sha || null, url: saved.content?.html_url || null };
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
