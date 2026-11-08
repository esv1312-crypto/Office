# Universal AI Studio — Master Notebook

> **Purpose:** This is the persistent source of truth for the studio's mission, architecture, decisions, current state, and next action. Update it after every meaningful action in the project and before handing work to another chat/session.
>
> **Working rule:** Read this notebook first, then inspect the live systems. Never assume an earlier status is still current. Record evidence, not intentions. Do not mark a capability complete until it has been demonstrated.

Last updated: 2026-11-08  
Primary repository: `esv1312-crypto/Office`  
Primary working branch: `studio-v1-foundation`

---

## 1. What we are building

We are building **Universal AI Studio**: a cloud-based, autonomous and extensible studio for creating digital products.

The studio must eventually be able to create and maintain many kinds of digital products, not only software in one narrow category:

- Mobile and web applications.
- Games, including Roblox experiences.
- Websites and online services.
- AI products, agents and automations.
- Other digital products as new disciplines and capabilities are added.

The studio is not meant to be a collection of fixed chatbots. It is an expandable organization: roles, specialists, skills, teams, departments and workspaces should be addable dynamically without rebuilding the core.

### The central user experience

The owner gives one goal to the Director. The studio should then understand the goal, investigate what is needed, form a suitable team, divide work, execute real tasks, test the work, repair failures, retest and return evidence and deliverables. The owner should not have to keep prompting every specialist to continue.

### Self-development is the current first product/project

**AI Office Self-Development** is the studio's internal improvement project. It is intended to make the studio inspect, diagnose, improve and verify its own platform. It is not the whole purpose of Universal AI Studio; it is the first proving ground for the autonomous workflow.

Organization: `Universal AI Studio`  
Organization ID: `67ae686f-fc54-40f0-988b-9b8f5a8a1dc9`  
Project: `AI Office Self-Development`  
Project ID: `d8a125e7-bacb-41a5-854a-cc34fe97e516`

---

## 2. Required autonomous workflow

The intended end-to-end cycle is:

`INTAKE → RECON → PLAN → DELEGATE → EXECUTE → VERIFY → FIX → RETEST → EVIDENCE`

1. **INTAKE:** understand the owner's goal and constraints.
2. **RECON:** inspect the actual code, data, product state and relevant tools.
3. **PLAN:** create a bounded, testable plan with acceptance criteria.
4. **DELEGATE:** select specialists by competency and assign tasks.
5. **EXECUTE:** agents perform real work using approved cloud tools.
6. **VERIFY:** independent QA checks source changes and behavior, not just an agent's claims.
7. **FIX:** return failed work for correction.
8. **RETEST:** run the checks again after changes.
9. **EVIDENCE:** provide commits, diffs, test results, artifacts and clear remaining risks.

A plan marked completed is not sufficient proof that useful work happened. A task must have grounded evidence. QA must inspect the actual persisted result.

---

## 3. Roles and organizational design

The office already has a foundation of specialist roles, including:

- Product Director.
- Solution Architect.
- Implementation Specialist.
- Quality Engineer.
- Roblox specialists and Roblox QA.

At least two active QA-capable specialists were present in the organization:
- Roblox QA Engineer — `b8300abd-93d3-48b6-891c-ad82c2479968`
- Quality Engineer — `d812b95b-5752-4f79-ac2c-73c873282325`

These are examples of the current roster, not a permanent limit. The architecture must support adding new specialists and disciplines.

---

## 4. Cloud architecture and infrastructure

The intended operating model is cloud-first. The main voice/conversation interface is for direction, decisions and coordination—not for storing project files or code.

| Layer | Current system | Known identifier / location |
|---|---|---|
| Source code and version history | GitHub | `https://github.com/esv1312-crypto/Office` |
| Primary code branch | GitHub | `studio-v1-foundation` |
| Agent isolated workspace branch | GitHub | `studio-ai-agent-workspace` |
| Agent workspace directory | GitHub | `studio/agent-workspace/` |
| Runtime / control plane | Render | service `ai-office-runtime` |
| Runtime URL | Render | `https://ai-office-runtime-8pir.onrender.com` |
| Runtime service ID | Render | `srv-davoj1s9v7es738jino0` |
| Render workspace ID | Render | `tea-d61lnoq4d50c73ac3hgg` |
| Database | Neon | project `curly-lake-89933498` |
| Neon branch | Neon | `br-lingering-sea-ba372y8i` |
| Database name | Neon | `ai_office_db` |
| Model gateway | OpenRouter | configured provider |
| Current model mode | OpenRouter | `openrouter/free` |

Old Render service retained for reference only:
- Name: `ai-office-runtime-2`
- ID: `srv-db19226gekts73coran0`
- URL: `https://ai-office-runtime-2.onrender.com`

Current Runtime service configuration last inspected:
- Repository: `esv1312-crypto/Office`
- Branch: `studio-v1-foundation`
- Start command: `node studio/server.js`
- Build command: `npm install`
- Health path: `/health/ready`
- Render plan: Free
- Region: Frankfurt

### Cloud and cost principles

- Keep agent execution, artifacts and project state in cloud infrastructure.
- Use GitHub for source code, versioning, agent workspace changes and reviewable deliverables.
- Use Neon for persistent structured state.
- Use Render for the runtime/control plane.
- Keep the coordination chat free of unnecessary files and code dumps.
- Prefer free models while validating workflows.
- Do not enable paid models until there is a real hard USD spend cap enforced before provider calls. Provider-reported usage/cost is accounting, not a hard spending limit.

---

## 5. Access, permissions and safety boundaries

### GitHub Runtime credential

On 2026-11-08, a new GitHub fine-grained personal access token was created by the owner and added in Render Environment to the new Runtime as:

- `GITHUB_TOKEN`

The token itself must never be copied into this notebook, chat, logs, commits or screenshots.

The intended repository permission setup was:
- Repository access restricted to `esv1312-crypto/Office`.
- Contents: Read and write.
- Pull requests: Read and write.
- Metadata: Read-only.
- Actions: Read-only.

**Important verification distinction:** Render's startup log confirms that the Runtime reports `artifactStore=github+postgres`. This confirms the GitHub-backed artifact store is selected by configuration. It does **not yet prove** that an agent can successfully read/write the isolated workspace, commit, create a PR, or complete the full workflow. Those must be tested explicitly.

The ChatGPT GitHub connector used to inspect or edit this repository is a separate integration from the Runtime's `GITHUB_TOKEN`. Do not confuse success through the ChatGPT connector with success through the AI Office Runtime.

### Agent workspace restrictions

Agent workspace tools were introduced with PR #67 and are intended to be scoped to:
- Directory: `studio/agent-workspace/`
- Branch: `studio-ai-agent-workspace`

Agents must not silently write to production source paths or the main branch. Prefer isolated workspace changes and reviewable pull requests.

### Production safety

- Do not run destructive SQL autonomously.
- Do not make direct production database inserts as a shortcut.
- Do not casually change the production branch or service configuration.
- Do not run blind `npm audit fix`; review vulnerabilities and dependency impact first.
- Do not expose credentials in chat or artifacts.
- Keep paid model mode disabled until a hard spend cap exists.

---

## 6. Important implementation history

The following milestones were recorded before this notebook was created:

- **PR #66:** paid OpenRouter model support merged; paid mode remains disabled.
- **PR #67:** GitHub tool runtime merged; workspace tools scoped to `studio/agent-workspace/` and `studio-ai-agent-workspace`.
- **PR #69:** context/tool efficiency limits merged (bounded tool calls, tool result sizes and prompt/output budgets).
- **PR #71:** fixed repeat execution of assigned tasks.
- **PR #76:** deterministic startup behavior.
- **PR #77:** deterministic fallback plan when the Director's model planner fails; creates six bounded audit tasks and records planner failure.
- **PR #78:** recovery/resume of existing self-development plans after restart; expired executions are recovered and workflow resumed.
- **PR #91:** case-insensitive specialist competency matching.
- **PR #92:** allow primary specialists to cover part of cross-functional tasks.
- **PR #93:** worker workspace paths self-scope explicitly; preserve rejection of explicit production paths and safe source reads.
- **PR #94:** attach exact product source read-backs to independent QA evidence; require persisted read-back after workspace writes.
- **PR #95:** grant persisted Roblox QA worker read-only access to its product workspace.

The latest Render deploy observed on 2026-11-08 was triggered by commit:
`66bb1cdd765de9dd2b5f871abe758aaa238f0480`
(PR #95: “Give Roblox QA worker read-only access to its product workspace”). Render reported the deploy as `live`.

---

## 7. Current state — 2026-11-08

### Runtime

The latest inspected Render service metadata showed:
- Service `ai-office-runtime` is not suspended.
- Latest deploy status: `live`.
- Startup log:
  `provider=openrouter; artifactStore=github+postgres; model=openrouter/free`
- Startup log also reported that the self-development startup trigger is enabled by organization configuration.

### Self-development workflow

The self-development project exists and has a persisted plan. Recent runtime logs show:
- Self-development plan `b45ca5c0-714f-42e8-9a70-c527dc5b4ab9` returned `needs_attention`.
- A product pilot execution later failed with `TASK_NOT_RUNNING`, and was recorded as blocked.
- Owner execution for plan `a7db94fe-01c6-4021-a21d-8cb3eeaf50e3` reported `completed` but with `assigned=0`, `executions=0`, `qa=0`. This is not evidence of meaningful autonomous work.
- A source-verification plan was reported as already completed with zero executions.
- Runtime logs showed recovery of two expired tasks.

**Conclusion:** the platform is deployed and the GitHub artifact store is selected, but the autonomous execution loop is not yet proven reliable. There is a real workflow/task-state issue to investigate. Do not describe the studio as fully autonomous yet.

### What is proven vs not proven

| Capability | Current evidence | Status |
|---|---|---|
| Runtime deployed on Render | Latest deploy reported `live` | Confirmed |
| Neon-backed state | Existing office database configured | Configured; health should be rechecked when needed |
| GitHub artifact backend selected | Startup log says `github+postgres` | Confirmed at configuration/startup level |
| Runtime agent can read source via its own tools | No successful isolated runtime test recorded yet | Not yet proven |
| Runtime agent can write and read back workspace files | PR #94 added evidence requirements, but latest successful runtime proof not recorded | Not yet proven |
| Runtime agent can commit and create PR | No verified Runtime-generated commit/PR recorded | Not yet proven |
| Autonomous task dispatch and execution | Logs show zero-assignment completion and `TASK_NOT_RUNNING` | Needs repair |
| Independent QA | QA infrastructure and specialists exist; latest pilot is `needs_attention` | Needs reliable end-to-end proof |
| Paid model with hard spend cap | Not implemented/enabled | Deliberately disabled |

---

## 8. Immediate next objective

Do not redesign the studio or start a new office. Continue the existing Self-Development project.

### First: prove the Runtime's actual GitHub hands

Run a tightly scoped, non-production test through the **AI Office Runtime's own agent/tool path**, not through the ChatGPT GitHub connector:

1. Ask an assigned worker to read a known harmless file from its allowed workspace/source scope.
2. Have it create a small test artifact under `studio/agent-workspace/` on `studio-ai-agent-workspace`.
3. Read the exact file back from GitHub.
4. Verify the resulting commit SHA and branch.
5. If safe and supported, have it prepare a PR; do not merge automatically.
6. Capture the tool result, commit SHA, read-back content, and QA result in the evidence record.
7. Remove the test artifact later only through a reviewed change if it is no longer needed.

If this test cannot be initiated through the existing Runtime interface, investigate the actual dispatch/tool wiring and the current task-state failure. Do not fake the test using a separate GitHub connector.

### Second: repair the execution lifecycle

Investigate:
- Why a product pilot returned `TASK_NOT_RUNNING`.
- Why owner execution can report `completed` with zero assigned tasks and zero executions.
- Whether task assignment, worker execution, leases/recovery and QA transitions are persisted consistently.
- Whether the current plan is stale or has no runnable tasks.
- Whether the model response/worker tool call is empty, invalid or failing.

Use persisted database state, runtime logs and code/tests as evidence. Fix the underlying state transition or dispatch issue, add regression tests, deploy, and re-run the same bounded acceptance test.

### Acceptance criteria for the first real self-improvement task

The task is only accepted when all of the following exist:
- A real worker assignment and execution record.
- Evidence of source inspection grounded in actual file content.
- A workspace file/code change written through Runtime tools.
- A successful read-back of the exact persisted content.
- A commit SHA on the isolated workspace branch.
- Relevant tests/checks run with recorded results.
- Independent QA review tied to the exact changed content.
- A reviewable PR or an explicit reason why PR creation is not yet available.

---

## 9. How to maintain this notebook

After every meaningful action, append a dated entry under **10. Activity log** and update **7. Current state** and **8. Immediate next objective** if they changed.

Each entry must include:
- What was attempted.
- Which system/branch/plan/task was involved.
- What actually happened.
- Evidence: commit SHA, PR, deploy ID, log excerpt, task ID or test result.
- What failed or remains uncertain.
- The exact next action.

At the start of every new chat/session:
1. Read this notebook.
2. Check the current GitHub branch and recent commits/PRs.
3. Check current Render service/deploy/logs.
4. Check the current Neon plan/task state when relevant.
5. Compare live state with this notebook and update stale facts.
6. Continue from the **Immediate next objective**, not from an old conversational guess.

Never write “done” merely because a request was accepted or a plan says completed. Use evidence-based statuses: **confirmed**, **configured but untested**, **in progress**, **blocked**, or **not proven**.

---

## 10. Activity log

### 2026-11-08 — Master notebook initialized

- **Action:** Created this persistent project notebook in the GitHub repository on branch `studio-operations-notebook`.
- **Purpose:** Preserve the full Universal AI Studio mission, architecture, decisions, implementation history, current verified state and exact continuation point across chats.
- **Context:** Owner created a new fine-grained GitHub token and added it to the new Render Runtime as `GITHUB_TOKEN`.
- **Runtime evidence:** Latest inspected startup log reports `artifactStore=github+postgres`, `provider=openrouter`, `model=openrouter/free`; latest observed deploy from PR #95 is `live`.
- **Important limitation:** Actual Runtime-agent workspace write/read-back/commit/PR has not yet been demonstrated. Recent pilot logs include `needs_attention` and `TASK_NOT_RUNNING`.
- **Next action:** Validate GitHub operations through the Runtime's own worker tool path, then investigate and repair task dispatch/state transitions. Keep paid models disabled.
- **Documentation PR:** Opened [PR #98](https://github.com/esv1312-crypto/Office/pull/98) from `studio-operations-notebook` into `studio-v1-foundation`. It is open and not merged. Initial notebook commit: `04a598ecfc582472fa4d32fd65415b223793613e`.



### 2026-11-08 — Runtime hands verified; first self-development sprint prepared

- **Live database check:** The six tasks in the original plan `AI Office Self-Development — Initial Audit and Roadmap` are persisted as completed and have accepted QA reviews. The audit phase is finished; it did not itself implement platform source changes.
- **Specialist roster:** 10 active specialists were found in `Universal AI Studio`, including Product Director, Solution Architect, Implementation Specialist, Quality Engineer, Roblox specialists and QA.
- **Runtime GitHub write proof:** The isolated branch `studio-ai-agent-workspace` has real worker-created Roblox source files under `studio/agent-workspace/roblox-fan-district/`. Its observed head commit is `4442f0c3209597ad72acdff7b810ac7f8cc89c6e` (“Create SpawnController client script”). The directory tree contains 13 Luau files across Server, StarterPlayerScripts and ReplicatedStorage. This confirms the Runtime can write to its isolated workspace branch; it is not merely configured.
- **Current product pilot:** The separate Roblox Fan District pilot plan `b45ca5c0-714f-42e8-9a70-c527dc5b4ab9` is still in progress. Four implementation tasks and one QA task were observed running. The Roblox QA task had 9 `revision_required` reviews and was on attempt 10; the reviews correctly state that Roblox Studio playtesting cannot be claimed from static source inspection alone. Several implementation attempts expired their worker leases and were recovered.
- **Important root cause found in launch code:** `studio/http/self-development-launch.js` selected the newest plan in the shared Self-Development project without filtering by plan title. Because the Roblox product pilot plan was newer than the completed platform audit, the self-development startup launch resumed the Roblox product plan as though it were the platform self-development plan. The original audit plan also produced a misleading completed/zero-work owner-execution result because it had no runnable tasks.
- **Current Runtime check at this point in the investigation:** a live fetch of `/health/ready` briefly returned HTTP 503; a later post-deploy check returned `ready` with database `connected`.
- **Notebook PR:** PR #98 was merged into `studio-v1-foundation` at commit `0e7f08a62e7bf1a0827515436458790383393e22`.
- **Code fix prepared:** Opened PR #99, `fix: launch the first self-development implementation sprint`, branch `fix/self-development-first-implementation-sprint`, head `37e51e5857b52e6334b4da511b538f1236c35357`. It makes the platform self-development launcher select its own named plan instead of the newest unrelated product plan; changes the next self-development assignment from another audit into a bounded source-grounded implementation sprint; grants the platform Quality Engineer read-only workspace tools; and adds regression tests. PR #99 was merged at commit `2870d09137c19c3276995b5db2123ce7ab991f41`.
- **CI status:** PR #99's corrected run passed all four required checks (unit, PostgreSQL integration, runtime smoke, and isolated tests).
- **Tool limitation:** Runtime workers currently have read/list/write/patch workspace tools but no shell execution and no PR-creation tool. The first self-development sprint therefore asks workers to prepare a reviewable patch and regression-test files in the isolated workspace, read them back, and obtain independent QA. Actual test execution and PR creation/merge remain owner/reviewer steps.
- **Next action at that point:** The first implementation sprint was created after deployment. Its task competencies needed another correction; see the newest activity entry below. Keep the Roblox pilot separate; do not confuse its progress with platform self-development. Keep paid models disabled.


### 2026-11-08 — First implementation sprint launched; competency mapping corrected

- **PR #99 merged:** The self-development launcher now selects the exact platform sprint by title rather than accidentally resuming the latest unrelated plan (the Roblox product pilot). The first implementation sprint brief replaces the completed audit-only brief. PR #99 CI passed all required checks.
- **Notebook committed:** PR #98 merged the master notebook into `studio-v1-foundation`; notebook is now available on the main working branch at `docs/UNIVERSAL_AI_STUDIO_MASTER_NOTEBOOK.md`.
- **First platform sprint created:** Plan `58d22e75-3b7c-4aaa-9d3b-c8a772613d60`, title `AI Office Self-Development — First Implementation Sprint`, status `approved`.
- **Initial assignment issue:** The Director generated natural-language competency labels that did not match the registered platform specialist skills. The architect and implementation tasks remained unassigned; the QA task was assigned to Roblox QA instead of the platform Quality Engineer. This was verified from persisted task payloads and assignment events, not inferred.
- **PR #100 merged:** Added canonical skill aliases to Solution Architect, Implementation Specialist and Quality Engineer; the self-development startup reconciles these skills into existing specialist records; the Director brief now requires exact canonical competency labels and explicitly routes platform QA to Quality Engineer. PR #100 CI passed four checks: unit tests, isolated tests, runtime smoke integration and PostgreSQL/restart integration.
- **Latest Render deployment:** `dep-dbo7lstg1s2s73ee3o40`, status `live`, commit `41d339af12f8e4e7409fdb2640abe0d00f597ab8`. Runtime startup log reports `artifactStore=github+postgres`, `provider=openrouter`, `model=openrouter/free`. Health endpoint returned `{"status":"ready","database":"connected"}`.
- **Existing specialist profiles reconciled:** Solution Architect now includes repository/source/root-cause analysis competencies; Implementation Specialist includes code-patching, test-development, regression-testing and source-modification competencies; Quality Engineer includes code-review, quality-assurance, test-coverage, safety and `platform.qa`. Quality Engineer has read-only GitHub workspace tools.
- **Current first-sprint task state after PR #100 deploy:**
  - `29657f71-6abe-420a-84c3-766fcadd6cb0` — “Investigate and Document Verified Root Cause”; running, assigned to Solution Architect.
  - `58535a3b-f2b9-4dfc-889a-540ce8e776fc` — “Prepare Minimal Code Patch and Regression Tests”; running, assigned to Implementation Specialist.
  - `4640e7ef-12da-4ad3-a514-eb9062cb282f` — “Independent Quality Engineer Review”; running, still assigned to Roblox QA Engineer from the original Director-generated plan. It has read-only workspace tools, but this is not the desired final reviewer assignment. Check its outcome; if necessary, fix the assignment through supported workflow/domain actions rather than direct SQL.
  - `307ba042-a33b-4f62-871a-86dd3ea80f1d` — conditional follow-up integration task; remains planned and unassigned.
- **Artifacts at last check:** Architect and Implementation Specialist each had one running execution but no persisted artifact yet. QA had a running execution attempt and no QA review yet. Do not claim patch creation until exact workspace files and read-backs exist.
- **Separate Roblox product pilot:** Plan `b45ca5c0-714f-42e8-9a70-c527dc5b4ab9` remains separate. Four implementation tasks and Roblox QA task continue to show repeated attempts; QA has repeatedly required evidence of actual Roblox Studio playtesting. Startup recovery has reported `TASK_NOT_RUNNING` for some executions. Do not conflate this product pilot with the platform self-development sprint.
- **Next action:** Monitor plan `58d22e75-3b7c-4aaa-9d3b-c8a772613d60` for source-grounded architecture evidence, isolated patch and regression-test files, exact read-backs, commit/blob IDs, and independent QA. Verify QA reviewer role; the current assigned reviewer is Roblox QA despite the platform QA competency fix. Then inspect the Roblox pilot separately. Keep paid models disabled.
