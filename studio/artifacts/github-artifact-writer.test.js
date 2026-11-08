import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGithubArtifactWriter } from "./github-artifact-writer.js";

const provenance = {
  projectId: "project-1",
  taskId: "task-1",
  executionId: "execution-1",
  specialistId: "specialist-1",
};

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("writes a new text artifact to the configured branch and returns provenance/checksum", async () => {
  const calls = [];
  const writer = createGithubArtifactWriter({
    owner: "example", repo: "office", branch: "studio-v1-foundation",
    token: "test-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "GET") return response(404);
      return response(201, {
        content: { sha: "blob-sha", html_url: "https://github.com/example/office/blob/studio-v1-foundation/studio/projects/demo/artifacts/task-1.md" },
        commit: { sha: "commit-sha" },
      });
    },
  });
  const content = "# Result\n\nCreated by a worker.";
  const result = await writer.writeTextArtifact({
    path: "studio/projects/demo/artifacts/task-1.md", content, provenance,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "GET");
  assert.match(calls[0].url, /ref=studio-v1-foundation$/);
  assert.equal(calls[1].options.method, "PUT");
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.branch, "studio-v1-foundation");
  assert.equal(Buffer.from(payload.content, "base64").toString("utf8"), content);
  assert.equal(result.sha256, createHash("sha256").update(content).digest("hex"));
  assert.equal(result.commitSha, "commit-sha");
  assert.equal(result.path, "studio/projects/demo/artifacts/task-1.md");
  assert.equal(result.provenance.taskId, "task-1");
});

test("updates an existing file using its current blob SHA", async () => {
  let putPayload;
  const writer = createGithubArtifactWriter({
    owner: "example", repo: "office", branch: "studio-v1-foundation", token: "test-token",
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") return response(200, { sha: "existing-blob" });
      putPayload = JSON.parse(options.body);
      return response(200, { content: { sha: "new-blob" }, commit: { sha: "new-commit" } });
    },
  });
  await writer.writeTextArtifact({
    path: "studio/projects/demo/artifacts/task.md", content: "updated", provenance,
  });
  assert.equal(putPayload.sha, "existing-blob");
});

test("rejects traversal, absolute paths, and paths outside the workspace before network access", async () => {
  let calls = 0;
  const writer = createGithubArtifactWriter({
    owner: "example", repo: "office", branch: "studio-v1-foundation", token: "test-token",
    fetchImpl: async () => { calls += 1; return response(404); },
  });
  for (const path of [
    "../outside.md",
    "studio/projects/../../outside.md",
    "/studio/projects/demo/file.md",
    "studio\\projects\\demo\\file.md",
    "other/file.md",
  ]) {
    await assert.rejects(
      writer.writeTextArtifact({ path, content: "x", provenance }),
      error => error.code === "ARTIFACT_PATH_REJECTED",
    );
  }
  assert.equal(calls, 0);
});

test("rejects oversized and empty artifacts before network access", async () => {
  let calls = 0;
  const writer = createGithubArtifactWriter({
    owner: "example", repo: "office", branch: "studio-v1-foundation", token: "test-token",
    maxBytes: 3,
    fetchImpl: async () => { calls += 1; return response(404); },
  });
  await assert.rejects(
    writer.writeTextArtifact({ path: "studio/projects/demo/a.md", content: "four", provenance }),
    error => error.code === "ARTIFACT_TOO_LARGE",
  );
  await assert.rejects(
    writer.writeTextArtifact({ path: "studio/projects/demo/a.md", content: " ", provenance }),
  );
  assert.equal(calls, 0);
});

test("does not expose repository credentials or raw provider errors", async () => {
  const writer = createGithubArtifactWriter({
    owner: "example", repo: "office", branch: "studio-v1-foundation", token: "secret-value",
    fetchImpl: async () => { throw new Error("request failed with secret-value"); },
  });
  await assert.rejects(
    writer.writeTextArtifact({ path: "studio/projects/demo/a.md", content: "x", provenance }),
    error => error.code === "ARTIFACT_REPOSITORY_UNAVAILABLE" && !error.message.includes("secret-value"),
  );
});


test("aborts a stalled GitHub request at the configured timeout", async () => {
  const writer = createGithubArtifactWriter({
    owner: "example", repo: "office", branch: "studio-v1-foundation", token: "test-token",
    requestTimeoutMs: 1_000,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    }),
  });
  await assert.rejects(
    writer.writeTextArtifact({ path: "studio/projects/demo/a.md", content: "x", provenance }),
    error => error.code === "ARTIFACT_REPOSITORY_TIMEOUT",
  );
});
