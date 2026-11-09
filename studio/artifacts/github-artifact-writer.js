import { createHash } from "node:crypto";

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}

function safeRepositoryPath(value, allowedPrefixes) {
  const path = required(value, "path");
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0") ||
      path.includes("%") || path.split("/").some(part => !part || part === "." || part === "..")) {
    throw Object.assign(new Error("Artifact path is not allowed"), { code: "ARTIFACT_PATH_REJECTED" });
  }
  if (!allowedPrefixes.some(prefix => path.startsWith(prefix))) {
    throw Object.assign(new Error("Artifact path is outside the configured workspace"), {
      code: "ARTIFACT_PATH_REJECTED",
    });
  }
  return path;
}

async function responseJson(response) {
  try { return await response.json(); } catch { return {}; }
}

/**
 * Narrow GitHub Contents API writer for Studio-generated text artifacts.
 *
 * Credentials and fetch are injected by the host. The writer can only touch
 * one explicitly configured branch and allowlisted workspace prefixes.
 */
export function createGithubArtifactWriter({
  owner,
  repo,
  branch,
  token,
  allowedPrefixes = ["studio/projects/"],
  maxBytes = 512 * 1024,
  requestTimeoutMs = 20_000,
  fetchImpl = globalThis.fetch,
}) {
  const repositoryOwner = required(owner, "owner");
  const repositoryName = required(repo, "repo");
  const targetBranch = required(branch, "branch");
  const credential = required(token, "token");
  if (!Array.isArray(allowedPrefixes) || !allowedPrefixes.length ||
      allowedPrefixes.some(prefix => typeof prefix !== "string" || !prefix.endsWith("/"))) {
    throw new TypeError("allowedPrefixes must be a non-empty array of directory prefixes");
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024) {
    throw new TypeError("maxBytes must be an integer between 1 and 2097152");
  }
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 120_000) {
    throw new TypeError("requestTimeoutMs must be an integer between 1000 and 120000");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");

  const apiBase = `https://api.github.com/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/contents`;

  async function request(url, options) {
    const controller = new AbortController();
    const externalSignal = options?.signal;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) controller.abort(externalSignal.reason);
    else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    let body;
    try {
      response = await fetchImpl(url, {
        ...options,
        signal: controller.signal,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${credential}`,
          "x-github-api-version": "2022-11-28",
          ...(options?.headers || {}),
        },
      });
      body = await responseJson(response);
    } catch {
      if (externalSignal?.aborted) {
        throw Object.assign(new Error("Artifact repository request was aborted"), {
          code: "ARTIFACT_REPOSITORY_ABORTED",
        });
      }
      if (controller.signal.aborted) {
        throw Object.assign(new Error("Artifact repository request timed out"), {
          code: "ARTIFACT_REPOSITORY_TIMEOUT",
        });
      }
      throw Object.assign(new Error("Artifact repository is unavailable"), {
        code: "ARTIFACT_REPOSITORY_UNAVAILABLE",
      });
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
    if (!response.ok) {
      if (response.status === 404 && options?.method !== "PUT") return { notFound: true };
      const code = response.status === 409 || response.status === 422
        ? "ARTIFACT_WRITE_CONFLICT"
        : response.status === 401 || response.status === 403
          ? "ARTIFACT_REPOSITORY_FORBIDDEN"
          : "ARTIFACT_REPOSITORY_ERROR";
      throw Object.assign(new Error("Artifact repository request failed"), {
        code, status: response.status,
      });
    }
    return { body };
  }

  return Object.freeze({
    async writeTextArtifact({ path, content, provenance, signal }) {
      const safePath = safeRepositoryPath(path, allowedPrefixes);
      if (typeof content !== "string" || !content.trim()) {
        throw new TypeError("Artifact content must be a non-empty UTF-8 string");
      }
      const bytes = Buffer.from(content, "utf8");
      if (bytes.byteLength > maxBytes) {
        throw Object.assign(new Error("Artifact exceeds the configured size limit"), {
          code: "ARTIFACT_TOO_LARGE",
        });
      }
      if (bytes.toString("utf8") !== content) {
        throw Object.assign(new Error("Artifact must be valid UTF-8 text"), {
          code: "ARTIFACT_INVALID_TEXT",
        });
      }
      if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
        throw new TypeError("Artifact provenance is required");
      }
      for (const key of ["projectId", "taskId", "executionId", "specialistId"]) {
        required(provenance[key], `provenance.${key}`);
      }

      const encodedPath = safePath.split("/").map(encodeURIComponent).join("/");
      const url = `${apiBase}/${encodedPath}`;
      const existing = await request(`${url}?ref=${encodeURIComponent(targetBranch)}`, { method: "GET", signal });
      const sha = existing.notFound ? undefined : existing.body?.sha;
      if (!existing.notFound && typeof sha !== "string") {
        throw Object.assign(new Error("Repository returned an invalid file record"), {
          code: "ARTIFACT_REPOSITORY_ERROR",
        });
      }

      const checksum = createHash("sha256").update(bytes).digest("hex");
      const response = await request(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: `studio: save artifact for task ${provenance.taskId}`,
          content: bytes.toString("base64"),
          branch: targetBranch,
          ...(sha ? { sha } : {}),
        }),
        signal,
      });

      // A successful Contents API write is not proof that the intended bytes
      // are now readable from the target branch. Read the file independently
      // and compare the exact UTF-8 bytes before reporting persistence success.
      const readBack = await request(
        `${url}?ref=${encodeURIComponent(targetBranch)}`,
        { method: "GET", signal },
      );
      const readBackBody = readBack.body;
      if (readBack.notFound || readBackBody?.encoding !== "base64" ||
          typeof readBackBody?.content !== "string") {
        throw Object.assign(new Error("Artifact repository read-back could not verify the saved file"), {
          code: "ARTIFACT_READBACK_FAILED",
        });
      }
      const persistedBytes = Buffer.from(readBackBody.content.replace(/\s/g, ""), "base64");
      const persistedChecksum = createHash("sha256").update(persistedBytes).digest("hex");
      const expectedBlobSha = response.body?.content?.sha;
      if (persistedChecksum !== checksum ||
          (typeof expectedBlobSha === "string" && readBackBody.sha !== expectedBlobSha)) {
        throw Object.assign(new Error("Artifact repository read-back did not match the submitted content"), {
          code: "ARTIFACT_READBACK_MISMATCH",
        });
      }

      return Object.freeze({
        path: safePath,
        branch: targetBranch,
        sha256: checksum,
        readBackSha256: persistedChecksum,
        readBackVerified: true,
        blobSha: readBackBody.sha || expectedBlobSha || null,
        commitSha: response.body?.commit?.sha || null,
        url: response.body?.html_url || response.body?.content?.html_url || null,
        bytes: bytes.byteLength,
        provenance: Object.freeze({ ...provenance }),
      });
    },
  });
}
