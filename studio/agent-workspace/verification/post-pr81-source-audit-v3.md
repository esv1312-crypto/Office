# Source Code Audit Verification

## Evidence Rows

### 1. studio/server.js (lines 160-180)
- **Branch**: studio-v1-foundation
- **SHA**: 2b9633372cb2f51a1997db6e4b456bee959e2d0b
- **Total Lines**: 409
- **Inclusive Range**: 160-180
- **Source Facts**: The file defines `githubWorkspaceTools` creation with `branch: "studio-ai-agent-workspace"` and `readBranch: "studio-v1-foundation"`. It also creates a `controlPlane` with the same readBranch.

### 2. studio/agents/github-workspace-tools.js (lines 50-70)
- **Branch**: studio-v1-foundation
- **SHA**: f9aa1a08875233de6b47dbca23380cba39b4bf9c
- **Total Lines**: 190
- **Inclusive Range**: 50-70
- **Source Facts**: This file exports `createGithubWorkspaceTools` which accepts `readBranch` (defaults to the source branch) and `targetBranch`. It validates that `allowedPrefix` ends with "/".

### 3. studio/agents/worker-runtime.js (lines 135-150)
- **Branch**: studio-v1-foundation
- **SHA**: fbec2914dc587a5641c76a6184a444739dd80790
- **Total Lines**: 291
- **Inclusive Range**: 135-150
- **Source Facts**: This file contains worker runtime logic including heartbeat management, lease handling, and error handling for execution tasks.

## Write Operation Result

- **Branch**: studio-ai-agent-workspace
- **Commit SHA**: 2b9633372cb2f51a1997db6e4b456bee959e2d0b
- **Blob SHA**: 2b9633372cb2f51a1997db6e4b456bee959e2d0b

## Read Back Verification

The evidence file was read back successfully from studio-ai-agent-workspace (lines 1-200).
