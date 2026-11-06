# Universal AI Studio — one-shot execution directive

## Mission
Turn the isolated Studio foundation into the smallest real, safe, end-to-end production workflow and use it to produce the first Roblox football-fans game deliverable. Optimize for a working result, not additional architecture documents.

## Definition of done
A single owner command submits a Roblox game brief. The Studio itself:
1. Creates a project-scoped plan through the Director model gateway.
2. Persists the plan and task breakdown.
3. Uses an owner approval gate where required.
4. Assigns tasks to dynamically registered Roblox specialists.
5. Executes tasks through durable Workers using the configured model gateway.
6. Saves every generated artifact to a project workspace/repository through a narrowly scoped artifact writer.
7. Runs independent QA against explicit acceptance criteria.
8. Produces a final report with artifact paths, test evidence, model snapshots, blockers, and honest distinction between static validation and Roblox Studio playtesting.

The first deliverable is a playable Roblox Studio project source package for the football-fans district: Luau scripts, map generator, UI assets/source, setup instructions, and a test checklist. Publishing to Roblox is out of scope.

## Execution order — do not expand scope
1. Inspect the current branch and all existing Studio modules/tests. Reuse working code; do not rewrite the legacy Office.
2. Run the isolated Studio test suite and syntax checks. Fix actual failures.
3. Complete the smallest missing runtime path: configured model gateway -> authenticated owner request -> Director plan -> owner approval -> dispatch -> Worker Pool -> artifact persistence -> independent QA -> final report.
4. Implement a safe artifact writer that can write only within the configured project workspace and approved working branch. Reject path traversal, absolute paths, binary payloads unless explicitly supported, oversized files, and writes outside the allowlist. Record checksums and provenance.
5. Add a Roblox product profile and seed team using dynamic specialist contracts. Roles are capabilities, not separate model accounts. Keep tool permissions deny-by-default.
6. Add a single documented command/API operation to bootstrap a Studio project and submit the initial game brief. Avoid requiring the owner to manually assemble multiple internal calls.
7. Add deterministic unit tests and isolated integration tests using fakes. Do not invoke paid models or external services in CI.
8. Where a real provider/database credential, owner identity, database migration, or external provisioning is missing, stop at that exact boundary, report the one required owner action, and keep all code ready for it.

## First Roblox brief
Create a social football-fans district experience in Roblox, approximately 1000 x 820 studs, with Arrival Plaza, Fan Street, Supporters' Square, Fan Shop, Café, Mini Pitch, Stadium Forecourt, and Main Stadium. Include five fictional fan crews (Blue, Orange, Red, Green, White), social gathering, scarves, shop interactions, crew formation/invites, shared cheering and banners. No real club logos, unlicensed assets, paid assets, gambling, or manipulative monetization. Prioritize mobile performance and server-authoritative game logic.

## Safety and governance
- Work only on branch studio-v1-foundation and within studio/ plus specifically required CI files.
- Never modify main, the legacy Office runtime, Neon, Render, production services, production secrets, or Roblox live experiences without separate explicit owner approval.
- Do not apply database migrations, provision services, enable auth providers, change billing, deploy, publish, or call paid model APIs without explicit approval.
- Never claim a task was autonomously completed unless the Studio runtime actually performed it and persisted execution/artifact/QA evidence.
- If a capability cannot be completed without external setup, implement and test the adapter boundary, then clearly name the single missing dependency.
- Prefer one coherent vertical slice over more abstractions. Delete no existing functionality.

## Final response requirements
Report exactly: what changed, what tests actually passed, what the Studio itself executed (if anything), links to commits/CI/artifacts, remaining blocker(s), and the next single action. Never describe authored tests as passing before CI confirms them.
