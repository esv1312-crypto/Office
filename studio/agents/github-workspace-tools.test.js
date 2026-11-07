import test from "node:test";
import assert from "node:assert/strict";
import { createGithubWorkspaceTools } from "./github-workspace-tools.js";

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("exposes only the three governed GitHub workspace tools", () => {
  const tools = createGithubWorkspaceTools({
    owner: "example", repo: "office", branch: "studio-ai-agent-workspace", token: "test",
    fetchImpl: async () => response(404),
  });
  assert.deepEqual(tools.allowedToolNames, ["list_repo_directory", "read_repo_file", "write_repo_file"]);
  assert.equal(tools.definitions.length, 3);
});

test("lists a workspace directory on the isolated branch", async () => {
  const calls = [];
  const tools = createGithubWorkspaceTools({
    owner: "example", repo: "office", branch: "studio-ai-agent-workspace", token: "test",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, [{ name: "index.js", path: "studio/agent-workspace/index.js", type: "file", size: 10 }]);
    },
  });
  const result = await tools.execute({ name: "list_repo_directory", arguments: { path: "studio/agent-workspace/" } });
  assert.equal(result[0].name, "index.js");
  assert.match(calls[0].url, /ref=studio-ai-agent-workspace$/);
});

test("reads a UTF-8 file from the isolated branch", async () => {
  const source = "export const answer = 42;";
  const tools = createGithubWorkspaceTools({
    owner: "example", repo: "office", branch: "studio-ai-agent-workspace", token: "test",
    fetchImpl: async () => response(200, {
      type: "file", content: Buffer.from(source).toString("base64"), sha: "blob-sha",
    }),
  });
  const result = await tools.execute({ name: "read_repo_file", arguments: { path: "studio/agent-workspace/index.js" } });
  assert.equal(result.content, source);
  assert.equal(result.sha, "blob-sha");
});

test("creates a new file and updates existing files using the existing blob SHA", async () => {
  const calls = [];
  const tools = createGithubWorkspaceTools({
    owner: "example", repo: "office", branch: "studio-ai-agent-workspace", token: "test",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "PUT") return response(201, { content: { sha: "new-blob", html_url: "https://github.com/example/office" }, commit: { sha: "commit-sha" } });
      return response(404);
    },
  });
  const created = await tools.execute({ name: "write_repo_file", arguments: {
    path: "studio/agent-workspace/new.js", content: "export default 1;", message: "Add file",
  } });
  assert.equal(created.commitSha, "commit-sha");
  assert.equal(JSON.parse(calls[1].options.body).branch, "studio-ai-agent-workspace");
  assert.equal(Buffer.from(JSON.parse(calls[1].options.body).content, "base64").toString(), "export default 1;");

  calls.length = 0;
  const updating = createGithubWorkspaceTools({
    owner: "example", repo: "office", branch: "studio-ai-agent-workspace", token: "test",
    fetchImpl: async (_url, options) => {
      calls.push(options);
      if (options.method === "PUT") return response(200, { content: { sha: "updated" }, commit: { sha: "commit-2" } });
      return response(200, { sha: "old-blob" });
    },
  });
  await updating.execute({ name: "write_repo_file", arguments: {
    path: "studio/agent-workspace/new.js", content: "export default 2;", message: "Update file",
  } });
  assert.equal(JSON.parse(calls[1].body).sha, "old-blob");
});

test("rejects traversal, secrets, workflows, and paths outside the workspace before network access", async () => {
  let calls = 0;
  const tools = createGithubWorkspaceTools({
    owner: "example", repo: "office", branch: "studio-ai-agent-workspace", token: "test",
    fetchImpl: async () => { calls += 1; return response(404); },
  });
  for (const path of [
    "../outside.js",
    "studio/agent-workspace/../../outside.js",
    "studio/agent-workspace/.env",
    "studio/agent-workspace/secrets/token.txt",
    "studio/agent-workspace/.github/workflows/deploy.yml",
    "studio/projects/private.md",
    "/studio/agent-workspace/file.js",
    "studio\\agent-workspace\\file.js",
  ]) {
    await assert.rejects(
      tools.execute({ name: "read_repo_file", arguments: { path } }),
      error => error.code === "WORKSPACE_PATH_REJECTED",
    );
  }
  assert.equal(calls, 0);
});

test("rejects unregistered tools and malformed arguments", async () => {
  const tools = createGithubWorkspaceTools({
    owner: "example", repo: "office", branch: "studio-ai-agent-workspace", token: "test",
    fetchImpl: async () => response(404),
  });
  await assert.rejects(tools.execute({ name: "run_shell", arguments: {} }), error => error.code === "WORKSPACE_TOOL_NOT_ALLOWED");
  await assert.rejects(tools.execute({ name: "read_repo_file", arguments: "{" }), error => error.code === "WORKSPACE_INVALID_ARGUMENTS");
});
