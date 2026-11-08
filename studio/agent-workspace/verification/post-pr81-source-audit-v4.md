# Source Audit Evidence — post-pr81-source-audit-v4

| Path | Branch | SHA | totalLines | Inspected Range (inclusive) | Visible Facts |
|------|--------|-----|------------|-----------------------------|--------------|
| studio/server.js | studio-v1-foundation | 2b9633372cb2f51a1997db6e4b456bee959e2d0b | 409 | 160–180 | Configures `branch: "studio-ai-agent-workspace"` and `readBranch: "studio-v1-foundation"` for githubWorkspaceTools (lines 160–180) |
| studio/agents/github-workspace-tools.js | studio-v1-foundation | f9aa1a08875233de6b47dbca23380cba39b4bf9c | 190 | 50–70 | Function `createGithubWorkspaceTools` parameters: `readBranch = branch` (default), `allowedPrefix = "studio/agent-workspace/"`; explicit read-back calls use `readBranch: "studio-v1-foundation"` |
| studio/agents/github-workspace-tools.js | studio-v1-foundation | f9aa1a08875233de6b47dbca23380cba39b4bf9c | 190 | 128–170 | `execute` function routes `list_repo_directory`, `read_repo_file`, `write_repo_file`, `patch_repo_file`; reads use `readRef` from `[sourceBranch, targetBranch]`; writes go to `targetBranch` (`studio-ai-agent-workspace`) via `saveFile` with `branch: targetBranch` |
| studio/agents/worker-runtime.js | studio-v1-foundation | ef7ee812d35e13d1ae9b0911363ab57fd8074150 | 298 | 165–175 | `modelGateway.generate({ task, specialist: { id, role, instructions, competencies, allowedTools, modelProfile } })` — passes `specialist.allowedTools` to the model gateway |
| studio/agents/worker-runtime.js | studio-v1-foundation | ef7ee812d35e13d1ae9b0911363ab57fd8074150 | 298 | 215–225 | Honors `externalArtifact=false` at line 215: `if (artifactWriter && started.task.externalArtifact !== false)` — writes artifact only when `externalArtifact` is not explicitly `false` |

## Branch vs Isolated Workspace-Write Branch

- **studio/server.js** (studio-v1-foundation): Sets `branch: "studio-ai-agent-workspace"` (the isolated workspace branch) and `readBranch: "studio-v1-foundation"` (the source-of-truth branch) when creating `githubWorkspaceTools`. This means reads default to `studio-v1-foundation`, while writes (via GitHub API) target `studio-ai-agent-workspace`.

- **studio/agents/github-workspace-tools.js** (studio-v1-foundation): The `readBranch` parameter defaults to the `branch` argument passed to `createGithubWorkspaceTools`, which is `studio-ai-agent-workspace`. However, explicit reads (e.g., via `execute` function) respect the `readRef` check against `[sourceBranch, targetBranch]`, where `sourceBranch` is the `readBranch` value (`studio-v1-foundation`). Writes are confined to `targetBranch` (`studio-ai-agent-workspace`) via the `safePath` guard and `saveFile` call with `branch: targetBranch`.

- **studio/agents/worker-runtime.js** (studio-v1-foundation): The `modelGateway.generate` call passes `specialist.allowedTools` (restricted to `["list_repo_directory", "read_repo_file", "write_repo_file"]` for the implementation specialist). The runtime checks `started.task.externalArtifact !== false` before writing; when `externalArtifact` is not `false`, it delegates to `artifactWriter.writeTextArtifact`, which persists to the isolated workspace branch.

## Key Facts from Inspected Ranges

- Server.js lines 160–180 explicitly set `branch: "studio-ai-agent-workspace"` and `readBranch: "studio-v1-foundation"` for the GitHub workspace tools constructor, confirming the branch-directing configuration.
- github-workspace-tools.js lines 50–70 show the function signature where `readBranch = branch` means the read branch is derived from the caller-provided `branch` parameter, and the constructor call in server.js passes `readBranch: "studio-v1-foundation"`.
- github-workspace-tools.js lines 128–170 show that `list_repo_directory` and `read_repo_file` use `readRef` determined by whether `args.branch` is undefined (defaults to `sourceBranch`) or explicitly set; the branch must be one of `[sourceBranch, targetBranch]`. The `write_repo_file` operation uses `safePath` to validate the path ends with `allowedPrefix` (`studio/agent-workspace/`) and saves to `targetBranch`.
- worker-runtime.js lines 165–175 show the `modelGateway.generate` invocation that includes `specialist.allowedTools`, which the runtime uses to filter which tools the model may call.
- worker-runtime.js lines 215–225 show the `externalArtifact` guard: artifact writing is skipped when `started.task.externalArtifact === false`, honoring the task-level external artifact flag.