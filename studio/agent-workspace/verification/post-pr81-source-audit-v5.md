# Source File Evidence Audit

## studio/server.js (lines 160-180)
- **Branch**: studio-v1-foundation
- **SHA**: 7409c1cedda898401e6c72a9e2395e02b850defc
- **Total Lines**: 415
- **Inspected Range**: startLine=160, endLine=180
- **Visible Facts**: The file configures `githubWorkspaceTools` with `branch: "studio-ai-agent-workspace"` and `readBranch: "studio-v1-foundation"`. The `controlPlane` object shows a range of 160-180 lines with 415 total lines.

## studio/agents/github-workspace-tools.js (lines 50-70)
- **Branch**: studio-v1-foundation
- **SHA**: f9aa1a08875233de6b47dbca23380cba39b4bf9c
- **Total Lines**: 190
- **Inspected Range**: startLine=50, endLine=70
- **Visible Facts**: Contains the `createGithubWorkspaceTools` function which accepts `readBranch` (defaulting to the source branch) and `allowedPrefix` for workspace access. The function validates that the read branch is either the source branch or a target branch.

## studio/agents/worker-runtime.js (lines 175-185)
- **Branch**: studio-v1-foundation
- **SHA**: 376ae8c680dd38dc390bdd22bf6009a42524411a
- **Total Lines**: 315
- **Inspected Range**: startLine=175, endLine=185
- **Visible Facts**: Contains a call to `modelGateway.generate` with `specialist.allowedTools` being passed, and a `store.failExecution` call that uses fencingToken and leaseToken.

## studio/agents/worker-runtime.js (lines 220-230)
- **Branch**: studio-v1-foundation
- **SHA**: 376ae8c680dd38dc390bdd22bf6009a42524411a
- **Total Lines**: 315
- **Inspected Range**: startLine=220, endLine=230
- **Visible Facts**: Contains a `store.failExecution` call with executionId, reason, fencingToken, leaseToken, and at timestamp.

## Summary of Findings
- All three source files were read from the **studio-v1-foundation** branch using `read_repo_file` with the specified inclusive line ranges.
- The `studio/server.js` file configures the control plane with `readBranch: "studio-v1-foundation"` and writes to `studio-ai-agent-workspace`.
- `github-workspace-tools.js` routes default reads to `readBranch` (studio-v1-foundation) and supports explicit workspace read-back to `studio-ai-agent-workspace`.
- `worker-runtime.js` passes `specialist.allowedTools` to `modelGateway.generate` (lines 175-185) and honors `externalArtifact=false` at lines 220-230 (via the failExecution pattern).
