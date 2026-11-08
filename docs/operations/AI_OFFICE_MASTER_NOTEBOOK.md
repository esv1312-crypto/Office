# AI-ОФИС — главный рабочий блокнот

> Источник восстановления контекста. Обновлять после каждого существенного действия и перед завершением сессии. Сначала читать этот файл, затем сверять фактическое состояние GitHub, Neon и Render.  
> Снимок фактов: 2026-11-08, по доступным данным GitHub/Neon/Render. Секреты и значения ключей не сохраняются.

## 1. Главная цель проекта — НЕ Roblox-игра

Пользователь строит **универсальный AI-ОФИС, который должен научиться самостоятельно развивать и дописывать самого себя**.

Ожидаемый цикл:
1. Пользователь даёт директору цель или задачу.
2. Директор исследует актуальный код и состояние офиса.
3. Директор составляет план развития и разбивает его на задачи.
4. Подбирает сотрудников по компетенциям и назначает им задачи.
5. Сотрудники используют выбранные LLM и GitHub-инструменты, чтобы читать/изменять код офиса в разрешённой рабочей ветке.
6. Результаты сохраняются как проверяемые артефакты.
7. Независимый QA читает реальные изменения и проверяет критерии.
8. При замечаниях задача возвращается исполнителю; после исправления выполняется повторная проверка.
9. Только после доказательств и owner approval изменения могут попасть в production.

**Не путать с Roblox.** Roblox Football Fans District — отдельный продуктовый пилот/проект. Он не является текущей целью пользователя и не должен запускаться вместо self-development. Не создавать новые Roblox-планы, не продолжать Roblox-задачи, если пользователь отдельно не попросил.

## 2. Договорённость по моделям

- Основной желаемый маршрут: **DeepSeek V4.1 Flash через OpenRouter** для планирования/разработки.
- DeepSeek Pro — для сложных архитектурных задач/аудита, а не обязательно для каждого рутинного вызова.
- Расходы строго контролировать. В прошлых разговорах согласован первый ограниченный эксперимент с ориентиром **$1**, а не бесконтрольные платные запросы.
- Не отправлять огромный контекст без необходимости; передавать только релевантные файлы, ограниченные диапазоны строк и результаты инструментов.
- Не включать платные вызовы без действующего hard budget gate и понятного учёта расходов.

### Что обнаружено по DeepSeek / OpenRouter

- В активном Studio Render runtime модельный ключ настроен: сервер требует `STUDIO_MODEL_API_KEY` или `OPENROUTER_API_KEY` и успешно запускается; worker snapshots подтверждают реальные OpenRouter-вызовы.
- GitHub credential для workspace tools тоже фактически работает: live worker записал файл в GitHub workspace branch и прочитал его обратно; QA принял evidence.
- **Однако фактически используемая модель в активном Studio runtime на последнем снимке — `openrouter/free`, не DeepSeek.** Это подтверждается Render startup logs и Neon execution model snapshots.
- В `studio/server.js` на deployed branch есть конфигурационный gate `STUDIO_ALLOW_PAID_MODELS`; при включении paid default в коде — `deepseek/deepseek-v4.1-flash-1017`. Но наличие этого кода не означает, что gate включён.
- PR #66 (“Enable controlled paid OpenRouter models for Studio”) и PR #67 (“Add governed GitHub tool execution to Studio workers”) закрыты, но их feature branch `feat/openrouter-paid-autonomous-office` относительно deployed `studio-v1-foundation` diverged: 3 commits ahead / 43 behind. Нельзя вслепую мержить эту ветку.
- PR #48–#50 описывали отдельный **одноразовый read-only DeepSeek audit** в legacy `src/server.js`, с отключёнными инструментами и бюджетом $1. Это не автономная разработка офиса и не доказательство, что DeepSeek подключён к Studio workers.
- Текущий Studio runtime имеет token/tool budgets (например, bounded tool calls, prompt/output budgets, usage metadata), но **не считать их эквивалентом hard $1 spend cap**. До платного запуска нужно реализовать/проверить отдельное ограничение расходов для обычного Studio planner/worker/QA цикла.

## 3. Подтверждённые «руки» и доступы офиса

Live worker source-verification v6 подтвердил:
- `list_repo_directory`
- `read_repo_file`
- `write_repo_file`
- `patch_repo_file`

Фактические границы:
- исходный код читается из `studio-v1-foundation`;
- продуктовые/агентные записи создаются в `studio-ai-agent-workspace`;
- разрешённый write prefix: `studio/agent-workspace/`;
- исходники, секреты, GitHub Actions workflows и production paths не должны изменяться worker-инструментами;
- patch использует SHA guard; чтение ограничено диапазонами/размером; tool loop ограничен бюджетами.

Последняя проверка source/write/read-back:
- Plan: `4ab2653e-cede-4463-9664-2ada8338da5d` — **AI Office — Live Source Read/Write Verification v6**.
- Task: `c3b0e950-e702-49f0-bc3c-dbb732242bc6`.
- Execution: `e0fbeb58-64aa-4043-8a28-65a2bc8bb867`.
- Execution completed; QA verdict **accepted** at `2026-11-08T12:09:59Z`.
- Worker read `studio/server.js`, `studio/agents/github-workspace-tools.js`, `studio/agents/worker-runtime.js` from deployed source branch and recorded exact SHAs/ranges.
- Worker wrote `studio/agent-workspace/verification/post-pr81-source-audit-v6.md` to `studio-ai-agent-workspace`, commit `e57e96a50d9486f54c50afd4e9b16931c97ff6cf`, then read the file back; read-back SHA matched write SHA.
- QA confirmed the only write was the permitted evidence Markdown file; no production source, secrets, workflows, infrastructure, or production data were changed.

**Вывод:** GitHub “руки” не просто написаны — ограниченный live read/write/read-back реально сработал.

## 4. Реальный deployed runtime

Render workspace: `Стас's workspace`, ID `tea-d61lnoq4d50c73ac3hgg`.

Активный Studio service:
- Name: `ai-office-runtime`
- Service ID: `srv-davoj1s9v7es738jino0`
- URL: https://ai-office-runtime-8pir.onrender.com
- Repo: `esv1312-crypto/Office`
- Deployed branch: `studio-v1-foundation`
- Latest confirmed deploy: `dep-dbo6u5gu01pc73ee7k7g`
- Deployed commit: `66bb1cdd765de9dd2b5f871abe758aaa238f0480` (PR #95, Roblox QA read-only workspace access)
- Deploy completed successfully at `2026-11-08T12:46:54Z`.
- Render startup log at 12:46:45Z: provider `openrouter`, model `openrouter/free`, database `existing-office`, artifact store `github+postgres`.
- Self-development startup trigger was enabled by organization configuration.
- Do not confuse with older service `ai-office-runtime-2` on `main`; that is a separate old deployment.

At the last log snapshot, the newest application log was SIGTERM at `2026-11-08T13:01:54Z`; no later startup log was returned by that query. Recheck service health/logs at the next session before assuming current process state.

## 5. Neon — существующий AI Office

Neon project:
- Name: `ai-office`
- Project ID: `curly-lake-89933498`
- Branch: `main`
- Branch ID: `br-lingering-sea-ba372y8i`
- Region: `aws-eu-central-1`
- PostgreSQL 17.

Organization ID: `67ae686f-fc54-40f0-988b-9b8f5a8a1dc9`.

AI Office Self-Development project:
- Project ID: `d8a125e7-bacb-41a5-854a-cc34fe97e516`
- Product profile: `ai-office-platform`
- Status: active.

Persisted specialists include Product Director, Implementation Specialist, Quality Engineer, Solution Architect, and separate Roblox specialists. Relevant saved tool permissions:
- Implementation Specialist: list/read/write repository tools.
- Solution Architect: list/read only.
- Roblox QA Engineer: list/read only (separate Roblox product role).
- Product Director: no GitHub tools in its current persisted allow-list; Director delegates rather than directly editing files.
- Model profile on saved specialists is `gateway-default`, paid models require owner approval.

## 6. Self-development work already completed

Plan:
- ID: `a7db94fe-01c6-4021-a21d-8cb3eeaf50e3`
- Title: **AI Office Self-Development — Initial Audit and Roadmap**
- Status: approved; all six tasks completed.
- Important qualifier: the plan was created by `deterministic-self-development-template` because the planner did not return a valid persisted plan. It was a deterministic bootstrap, not a successful AI-generated plan.

Six completed tasks:
1. Prioritize the universal AI Office product roadmap — accepted.
2. Document model reliability and structured-output risks — accepted.
3. Audit the autonomous work lifecycle and failure recovery — accepted.
4. Map the current AI Office architecture and capability boundaries — eventually accepted after multiple revisions.
5. Define independent QA and evidence gates for self-improvement — accepted.
6. Audit GitHub execution readiness and permission boundaries — accepted.

These tasks generated persisted artifacts in Neon. The roadmap/audit phase is done. **The next correct task is not to repeat the audit; it is to convert the accepted roadmap into an implementation plan for the office to improve its own code.**

## 7. Critical misrouting discovered on 2026-11-08

The current deployed server has startup flows for:
- self-development launch;
- source verification;
- Roblox product pilot.

Render logs show that after the self-development roadmap had completed, startup continued launching the **Roblox product pilot**. It repeatedly resumed plan:
- Plan ID: `b45ca5c0-714f-42e8-9a70-c527dc5b4ab9`
- Title: `Roblox Fan District — First Playable Vertical Slice v1`
- It was incorrectly stored under the AI Office Self-Development project ID `d8a125e7-bacb-41a5-854a-cc34fe97e516`.
- Render logs repeatedly reported `status=needs_attention`.
- At 12:49:17Z the product pilot attempt reported `TASK_NOT_RUNNING` and blocked; it is not the user’s current objective.

The Roblox tasks and their stale executions are separate from the self-development mission. Do not resume or create more Roblox tasks unless the user explicitly requests that product.

**Required correction:** make the startup/owner workflow prioritize actual AI Office self-development and remove/disable automatic Roblox product-pilot startup for this self-development project. Do not delete existing Roblox records; preserve history.

## 8. Current model and execution evidence

The self-development audit and source-verification executions used `openrouter/free`. Example source-verification snapshot:
- 5 requests;
- 21,025 prompt tokens;
- 4,293 completion tokens;
- providerCost 0;
- 4 tool rounds / 8 tool calls;
- tool and token limits recorded in model snapshot.

This proves that OpenRouter and GitHub tools work, but **does not prove DeepSeek Flash/Pro has been selected or used by the live Studio runtime**.

## 9. Current stopping point and next steps

Do these in order; do not create a new organization, a new office, or duplicate audit tasks.

1. Recheck active Render service health and latest deploy/logs.
2. Inspect current deployed `studio/server.js` and the paid-model routing implementation against `feat/openrouter-paid-autonomous-office`; port only the necessary, reviewed changes onto current `studio-v1-foundation`. Do not merge the stale divergent feature branch wholesale.
3. Add a hard paid-spend budget for the normal Studio planner/worker/QA path. Initial approved experiment target is $1; reservations must be atomic and conservative if provider usage is missing. Enforce across the whole experiment, not per individual request only.
4. Configure DeepSeek V4.1 Flash through existing OpenRouter credential for a tightly bounded self-development run. Keep DeepSeek Pro for separately approved complex architecture work if Flash is insufficient. Never log or copy API key values.
5. Verify actual model selection from execution snapshots and actual provider-reported usage/cost. If model snapshots still say `openrouter/free`, DeepSeek is not active.
6. Create one new, owner-approved self-development implementation plan based on the already accepted roadmap. Scope: office code only, not Roblox; workers inspect source and improve Director/planning, task dispatch, model routing, worker tools, QA, cost governance, recovery and observability.
7. Have Director delegate to specialists; let workers write only in the isolated workspace branch; run independent QA; preserve CI evidence. No production deploy or main-branch writes without explicit approval.
8. After each step, update this notebook and the short handoff with commit SHAs, plan/task/execution IDs, model snapshots, QA verdicts and the exact next action.

## 10. Journal

### 2026-11-08 — previous self-development execution
- Created AI Office Self-Development project and initial roadmap plan.
- Six roadmap/audit tasks completed; QA accepted their outputs.
- Live source read/write verification v6 completed and QA accepted.
- Verified source reads from `studio-v1-foundation`, isolated workspace write to `studio-ai-agent-workspace`, exact read-back.
- Current Studio runtime uses OpenRouter; actual selected model was `openrouter/free`.
- Render latest confirmed deployed commit was #95 on `studio-v1-foundation`.
- Startup was also launching Roblox product pilot, which is not the user's requested self-development work.
- No paid model activation, Render environment change, database write, production deploy, or secret access was performed in this audit.

### 2026-11-08 — notebook correction
- Initial PR #96 was closed without merge because it was based on the wrong branch and incorrectly centered Roblox.
- This corrected notebook is based on the actual deployed Studio branch `studio-v1-foundation`.
- Next action: implement the hard spend cap and route the normal self-development workflow to DeepSeek Flash, then have the office build itself.

## 11. Rules that must never be forgotten

- The goal is **AI-ОФИС building AI-ОФИС**.
- Roblox is a separate product, not the current objective.
- Never repeat completed audit/source-verification tasks without new evidence that they need repeating.
- Never say a worker wrote code unless there is a GitHub commit and exact read-back evidence.
- Never say QA passed unless a persisted independent QA verdict says accepted.
- Never claim DeepSeek is active unless the live execution model snapshot identifies DeepSeek.
- Never enable paid models without the hard budget gate.
- Never expose API keys, GitHub tokens, database URLs or secret values in chat or notebook.
