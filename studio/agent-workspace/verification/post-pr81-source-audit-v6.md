# Post-PR81 Source Audit v6

## Source File Evidence

| Path | Branch | SHA | Total Lines | Inspected Range |
|------|--------|-----|-------------|-----------------|
| studio/server.js | studio-v1-foundation | 7409c1cedda898401e6c72a9e2395e02b850defc | 415 | 160-180 |
| studio/agents/github-workspace-tools.js | studio-v1-foundation | f9aa1a08875233de6b47dbca23380cba39b4bf9c | 190 | 50-70 |
| studio/agents/github-workspace-tools.js | studio-v1-foundation | f9aa1a08875233de6b47dbca23380cba39b4bf9c | 190 | 128-170 |
| studio/agents/worker-runtime.js | studio-v1-foundation | 2e71e991d59dacd8d75614f93374d0f56c8af785 | 316 | 180-188 |
| studio/agents/worker-runtime.js | studio-v1-foundation | 2e71e991d59dacd8d75614f93374d0f56c8af785 | 316 | 238-245 |

## Facts Visible in Inspected Ranges

### studio/server.js (lines 160-180)
- Configures `createGithubWorkspaceTools` with `branch: "studio-ai-agent-workspace"` and `readBranch: "studio-v1-foundation"`.
- The artifact writer (`createGithubArtifactWriter`) is configured with `branch: "studio-v1-foundation"` and `allowedPrefixes: ["studio/projects/"]`.
- The GitHub workspace tools are configured with `allowedPrefix: "studio/agent-workspace/"`.

### studio/agents/github-workspace-tools.js (lines 50-70)
- `createGithubWorkspaceTools` accepts `branch` (target branch) and `readBranch` (source branch, defaulting to `branch`).
- `targetBranch` is required from `branch`; `sourceBranch` is required from `readBranch`.
- `allowedPrefix` defaults to `"studio/agent-workspace/"`.

### studio/agents/github-workspace-tools.js (lines 128-170)
- `list_repo_directory`: default read ref is `sourceBranch`; explicit `args.branch` overrides but must be one of `[sourceBranch, targetBranch]`.
- `read_repo_file`: default read ref is `sourceBranch`; explicit `args.branch` overrides but must be one of `[sourceBranch, targetBranch]`.
- `write_repo_file`: uses `safePath(args.path, prefix)` and calls `saveFile` — writes go to the workspace branch.
- `patch_repo_file`: uses `safePath(args.path, prefix)` and fetches current content before patching — patches go to the workspace branch.

### studio/agents/worker-runtime.js (lines 180-188)
- The specialist object passed to model generation includes `allowedTools: Array.isArray(specialist.allowedTools) ? specialist.allowedTools : []`.

### studio/agents/worker-runtime.js (lines 238-245)
- `externalArtifact` is initialized to `null`.
- The artifact writer block is guarded by `if (artifactWriter && started.task.externalArtifact !== false)` — when `externalArtifact` is `false`, artifact writing is skipped.

## Branch Summary
- Source reads are performed from `studio-v1-foundation`.
- Isolated workspace writes go to `studio-ai-agent-workspace`.
- Default reads route to `readBranch` (`studio-v1-foundation`); explicit workspace read-back targets `studio-ai-agent-workspace`; writes and patches target the workspace branch.