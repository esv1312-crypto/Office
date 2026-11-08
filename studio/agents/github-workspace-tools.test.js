import test from "node:test";
import assert from "node:assert/strict";
import { createGithubWorkspaceTools } from "./github-workspace-tools.js";

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createTools(fetchImpl, options = {}) {
  return createGithubWorkspaceTools({
    owner: "example", repo: "office", branch: "studio-ai-agent-workspace", token: "test",
    fetchImpl, ...options,
  });
}

test("exposes bounded workspace tools including range reads and patch writes", () => {
  const tools = createTools(async () => response(404));
  assert.deepEqual(tools.allowedToolNames, [
    "list_repo_directory", "read_repo_file", "write_repo_file", "patch_repo_file",
  ]);
});

test("reads only a requested inclusive line range and returns SHA metadata", async () => {
  const source = "one\ntwo\nthree\nfour\nfive";
  const tools = createTools(async () => response(200, {
    type: "file", content: Buffer.from(source).toString("base64"), sha: "blob-sha",
  }));
  const result = await tools.execute({ name: "read_repo_file", arguments: {
    path: "studio/agent-workspace/demo.js", start_line: 2, end_line: 3,
  } });
  assert.equal(result.content, "two\nthree");
  assert.deepEqual(result.range, { startLine: 2, endLine: 3, totalLines: 5 });
  assert.equal(result.sha, "blob-sha");
});

test("bounds range reads to maxReadLines", async () => {
  const source = Array.from({ length: 20 }, (_, i) => "line-" + (i + 1)).join("\n");
  const tools = createTools(async () => response(200, {
    type: "file", content: Buffer.from(source).toString("base64"), sha: "blob-sha",
  }), { maxReadLines: 4 });
  const result = await tools.execute({ name: "read_repo_file", arguments: {
    path: "studio/agent-workspace/demo.js", start_line: 2, end_line: 20,
  } });
  assert.equal(result.content.split("\n").length, 4);
  assert.equal(result.truncated, true);
});

test("patches only the requested lines and uses optimistic SHA concurrency", async () => {
  const calls = [];
  const source = "alpha\nbeta\ngamma\ndelta";
  const tools = createTools(async (_url, options) => {
    calls.push(options);
    if (options.method === "PUT") return response(200, {
      content: { sha: "new-blob", html_url: "https://github.com/example/office" },
      commit: { sha: "commit-sha" },
    });
    return response(200, { type: "file", content: Buffer.from(source).toString("base64"), sha: "old-blob" });
  });
  const result = await tools.execute({ name: "patch_repo_file", arguments: {
    path: "studio/agent-workspace/demo.js", start_line: 2, end_line: 3,
    replacement: "BETA\nGAMMA", expected_sha: "old-blob", message: "Update two lines",
  } });
  assert.equal(result.commitSha, "commit-sha");
  const payload = JSON.parse(calls.at(-1).body);
  assert.equal(Buffer.from(payload.content, "base64").toString(), "alpha\nBETA\nGAMMA\ndelta");
  assert.equal(payload.sha, "old-blob");
});

test("rejects stale patch SHA before writing", async () => {
  let writes = 0;
  const tools = createTools(async (_url, options) => {
    if (options.method === "PUT") writes += 1;
    return response(200, { type: "file", content: Buffer.from("fresh").toString("base64"), sha: "fresh-sha" });
  });
  await assert.rejects(tools.execute({ name: "patch_repo_file", arguments: {
    path: "studio/agent-workspace/demo.js", start_line: 1, end_line: 1,
    replacement: "stale", expected_sha: "old-sha", message: "Should not write",
  } }), error => error.code === "WORKSPACE_WRITE_CONFLICT");
  assert.equal(writes, 0);
});

test("allows read-only source inspection outside the write workspace", async () => {
  const source = "export const answer = 42;";
  const calls = [];
  const tools = createTools(async url => {
    calls.push(url);
    return response(200, { type: "file", content: Buffer.from(source).toString("base64"), sha: "source-sha" });
  });
  const result = await tools.execute({ name: "read_repo_file", arguments: { path: "studio/server.js" } });
  assert.equal(result.content, source);
  assert.ok(calls[0].includes("/contents/studio/server.js?"));
});

test("keeps repository reads away from secrets, project data, workflows, and traversal", async () => {
  let calls = 0;
  const tools = createTools(async () => { calls += 1; return response(404); });
  for (const path of [
    "../outside.js", "studio/agent-workspace/../../outside.js",
    ".env", "studio/.env", "studio/secrets/token.txt", "studio/credentials/key.json",
    ".github/workflows/deploy.yml", "studio/projects/private.md",
    "/studio/server.js", "studio\\\\server.js",
  ]) {
    await assert.rejects(tools.execute({ name: "read_repo_file", arguments: { path } }),
      error => error.code === "WORKSPACE_PATH_REJECTED");
  }
  for (const name of ["write_repo_file", "patch_repo_file"]) {
    await assert.rejects(tools.execute({ name, arguments: {
      path: "studio/server.js", content: "x", message: "no",
      start_line: 1, end_line: 1, replacement: "x", expected_sha: "sha",
    } }), error => error.code === "WORKSPACE_PATH_REJECTED");
  }
  assert.equal(calls, 0);
});
